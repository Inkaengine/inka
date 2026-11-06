"""Deploy a layout to a site that keeps its own base.

The delta classifies BASE -> DISK against LIVE, and the base decides what it
costs (base_from_live.py). A site deployed from a layout in its own image has
nowhere outside itself to keep that base: the machine that runs the release is
thrown away, and the image holds only the new layout. So the site keeps it, as
the data.json of every item it was last deployed from, written in the SAME
transaction as the apply. A committed deploy advances it; a dry run, a refusal
or a failure leaves it as it was — the base can never describe content the
site does not hold.

A site with no base is refused. Either its first deploy is a full import, after
which the caller records the layout it imported with record_base, or, for a site
that already holds content and that nobody edits, the deploy starts from what
the site holds (seed_from_live).
"""

from __future__ import annotations

from .base_from_live import live_content_rels
from .changeset import item_data_files
from .delta import DeltaRefused
from .delta import run_delta
from .delta import serialize_live_candidates
from BTrees.OOBTree import OOBTree
from pathlib import Path
from persistent.mapping import PersistentMapping
from typing import Any
from zope.annotation.interfaces import IAnnotations

import json
import shutil
import tempfile
import transaction


ANNOTATION_KEY = "inkaengine.inka.content_deploy.base"


def has_base(site) -> bool:
    return ANNOTATION_KEY in IAnnotations(site)


def record_base(site, layout: Path) -> int:
    """Record `layout` as what the site now holds; returns how many items.

    Writes, never commits: the caller's transaction is the one that put the
    content there. Only items whose data.json changed are rewritten, so a
    deploy that changes three pages stores three.
    """
    content = Path(layout) / "content"
    texts = {
        data_file.parent.relative_to(content).as_posix(): data_file.read_text()
        for data_file in item_data_files(content)
    }
    if not texts:
        raise ValueError(f"{content} holds no items: nothing to record as the base")
    annotations = IAnnotations(site)
    if ANNOTATION_KEY not in annotations:
        annotations[ANNOTATION_KEY] = PersistentMapping(items=OOBTree())
    stored = annotations[ANNOTATION_KEY]
    items = stored["items"]
    for dirname in [d for d in items if d not in texts]:
        del items[dirname]
    for dirname, text in texts.items():
        if items.get(dirname) != text:
            items[dirname] = text
    redirects = Path(layout) / "redirects.json"
    redirects_text = redirects.read_text() if redirects.exists() else None
    if stored.get("redirects") != redirects_text:
        stored["redirects"] = redirects_text
    return len(texts)


def _seed_from_live(site, request) -> int:
    """Take what the site holds now as its base; returns how many items.

    Writes, never commits, like record_base. An item is then an update only
    where the site really differs from the layout, and a change on the site is
    indistinguishable from what the last deploy put there.
    """
    live = serialize_live_candidates(
        site, request, {}, {}, extra=sorted(live_content_rels(site))
    )
    IAnnotations(site)[ANNOTATION_KEY] = PersistentMapping(
        items=OOBTree({rel: json.dumps(data) for rel, data in live.items()}),
        redirects=None,
    )
    return len(live)


def _write_base(site, where: Path) -> None:
    """The stored base as a layout tree, for run_delta to read."""
    stored = IAnnotations(site)[ANNOTATION_KEY]
    for dirname, text in stored["items"].items():
        item = where / "content" / dirname
        item.mkdir(parents=True, exist_ok=True)
        (item / "data.json").write_text(text)
    if stored.get("redirects") is not None:
        (where / "redirects.json").write_text(stored["redirects"])


def deploy_content(
    site,
    request,
    layout: Path,
    *,
    commit: bool,
    ignored_fields: frozenset[str] = frozenset(),
    seed_from_live: bool = False,
) -> dict[str, Any]:
    """Apply what `layout` changed since the last deploy, in one transaction,
    and advance the stored base with it.

    `commit=False` is a dry run: every step runs and nothing persists.
    Refused (nothing written) when the site has no base, and by the apply's
    own gates when an editor changed a page this would overwrite.

    seed_from_live: a site with no base starts from what it holds, so a site
    already imported in full moves to deploying in place without being deleted
    once more. The layout then wins everywhere, as a full import would: an
    editor's change is overwritten, and content the layout lacks is deleted. So
    this is for a site nobody edits. A site that has a base keeps it.
    """
    seeded = None
    if seed_from_live and not has_base(site):
        seeded = _seed_from_live(site, request)
    if not has_base(site):
        raise DeltaRefused(
            "no base recorded on the site: import the layout in full, then "
            "record_base(site, layout) in the same transaction"
        )
    base_dir = Path(tempfile.mkdtemp(prefix="content-deploy-base-"))
    try:
        _write_base(site, base_dir)
        recorded = record_base(site, layout)
        report = run_delta(
            site,
            request,
            Path(layout),
            base_dir,
            commit=commit,
            with_relations=True,
            ignored_fields=ignored_fields,
        )
    finally:
        shutil.rmtree(base_dir)
    if not report["apply"]["committed"]:
        # A dry run has already aborted; a refusal returns with the new base
        # still pending, and must not leave it for anyone to commit.
        transaction.abort()
    report["base_recorded"] = recorded if report["apply"]["committed"] else 0
    if seeded is not None:
        report["seeded_from_live"] = seeded
    return report
