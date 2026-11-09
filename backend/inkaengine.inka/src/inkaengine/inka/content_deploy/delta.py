"""Content delta: classify AND apply a plone.exportimport tree against a
live site, in-process.

    BASE = layout_prev   (the tree behind the content currently live)
    DISK = layout        (the tree to deploy)
    LIVE = the site, serialized in-process (never written anywhere)

Only the items that differ between BASE and DISK are candidates; only those
are serialized from LIVE, and only the changed ones are imported (a subset
bundle through plone.exportimport's own ContentImporter — apply.py).
The clobber gates are apply_changeset's: a live editor edit refuses to be
overwritten.

Called from a zconsole script (RelStorage lets zconsole open the database
while Zope serves), never through HTTP: the public API carries no endpoint
that rewrites site content. The caller owns what happens after a commit
(advancing the base, storing it) — that is where a particular site's
specifics belong, not here. stored_base.py is one such caller.
"""

from __future__ import annotations

from .apply import apply_changeset
from .apply import apply_site_settings
from .base_from_live import base_holds_items
from .base_from_live import BaseExists
from .base_from_live import live_content_rels
from .base_from_live import write_base
from .classify import classify
from .classify import CompareRules
from .classify import cleaned_for_compare as cleaned
from .classify import content_key
from .classify import layout_redirects
from .classify import load_exportimport_tree
from .classify import NO_RULES
from .classify import refresh_from_disk
from collections.abc import Callable
from pathlib import Path
from types import MappingProxyType
from plone.exportimport import settings as ei_settings
from plone.exportimport import types as ei_types
from plone.exportimport.exporters.content import ContentExporter
from plone.exportimport.interfaces import IExportImportRequestMarker
from plone.exportimport.utils import request_provides
from plone.exportimport.utils.content import blocks as pei_blocks
from plone.restapi.interfaces import IPloneRestapiLayer
from typing import Any
from zope.interface import directlyProvidedBy
from zope.interface import directlyProvides

import json
import logging
import shutil
import tempfile
import time


logger = logging.getLogger(__name__)


class DeltaRefused(Exception):
    """The delta will not run, for a reason the caller must act on."""


def serialize_live_candidates(
    site, request, base, disk, extra=(), rules: CompareRules = NO_RULES
) -> dict[str, dict]:
    """LIVE truth for the rels the plan can touch, base for the rest.

    Serializing all ~1000 objects per request blew straight past any sane
    request budget; only the CANDIDATES need live truth — rels where base and
    disk differ (updates), rels leaving (deletes) or arriving (creates), and
    both ends of a move. For everything else live==base is assumed, which
    keeps the clobber gate exact where an apply would actually write and
    skips it where it wouldn't. `extra`: rels to read from live as well (the
    pages a delta is asked to refresh).
    """

    # Reached at the PLAIN url (no ++api++ traversal): mark the request with
    # the layer the serializer adapters are registered for, exactly as
    # plone.exportimport's CLI bootstrap does.
    if not IPloneRestapiLayer.providedBy(request):
        directlyProvides(request, IPloneRestapiLayer, *directlyProvidedBy(request))

    candidates = set(base) ^ set(disk)
    for rel in set(base) & set(disk):
        if content_key(base[rel], rules) != content_key(disk[rel], rules):
            candidates.add(rel)
    candidates.update(extra)
    # NEVER serialize the site root: the exporter keeps `items` for it
    # (export format), so serializing it summarizes EVERY child - the
    # whole-site preview-scale storm, >10 minutes of ghostscript. The root's
    # delta still applies; it just skips the live-edit clobber check (root
    # "content" is the homepage blocks - acceptable, and an editor edit there
    # still blocks the apply via Gate 2's edited-since-tid check).
    candidates.discard("plone_site_root")
    live = dict(base)
    exporter = _make_exporter(site)
    # The exportimport BLOB serializer (Files/Images) reads the metadata
    # object and a blob output path off the REQUEST — export_site primes
    # both before serializing, so this does too. The blobs land in a
    # throwaway tempdir (only the JSON matters for the compare; blob_path
    # strings are UID-derived and deterministic either way).

    blob_scratch = tempfile.mkdtemp(prefix="content-delta-blobs-")
    request[ei_settings.EXPORT_CONTENT_METADATA_KEY] = exporter.metadata
    request[ei_settings.EXPORT_PATH_KEY] = blob_scratch
    logger.info("content-delta: %d candidates to serialize", len(candidates))
    for rel in candidates:
        obj = site
        found = True
        if rel != "plone_site_root":
            for part in rel.split("/"):
                obj = obj.get(part) if obj is not None else None
                if obj is None:
                    found = False
                    break
        if not found:
            live.pop(rel, None)
            continue
        t = time.monotonic()
        live[rel] = _serialize_one(obj, request, exporter)
        logger.info("content-delta: serialized %s (%.1fs)", rel, time.monotonic() - t)
    shutil.rmtree(blob_scratch, ignore_errors=True)
    return live


def default_views_of(site) -> dict[str, str]:
    """Each content type's default view, from the site's type settings: an
    item on it has no view of its own (classify.CompareRules)."""
    return {fti.getId(): fti.default_view for fti in site.portal_types.listTypeInfo()}


def _serialize_one(obj, request, exporter) -> dict:
    """EXACTLY the exporter's serialization — the same code that produced the
    layout trees this compares against. The raw restapi ISerializeToJson was
    wrong twice over: its output shape drifts from the export format (child
    listings, expansions — spurious candidate diffs), and resolving linked
    UIDs to summaries computes image_scales, which regenerates PDF previews
    for every linked file — a request-killing ghostscript storm."""

    with request_provides(request, IExportImportRequestMarker):
        data = exporter.serialize(obj)
    return json.loads(json.dumps(data, default=str))


_PATCHED = False


def _patch_exportimport_tolerance():
    """The SAME tolerance patches the export scripts carry (each one an
    upstream plone.exportimport finding): _fix_grid_block KeyErrors on any
    block whose @type is 'grid' without a legacy `columns` list — which is
    every one of OUR grid blocks (blocks/blocks_layout containers) — and
    _fix_image_paths assumes dict-shaped images. Export what is there."""
    global _PATCHED
    if _PATCHED:
        return

    orig_fix_image_paths = pei_blocks._fix_image_paths
    orig_fix_grid_block = pei_blocks._fix_grid_block

    def tolerant_fix_image_paths(info):
        if not isinstance(info, dict):
            return info
        return orig_fix_image_paths(info)

    def tolerant_fix_grid_block(block):
        if not isinstance(block.get("columns"), list):
            return block
        return orig_fix_grid_block(block)

    pei_blocks._fix_image_paths = tolerant_fix_image_paths
    pei_blocks._fix_grid_block = tolerant_fix_grid_block
    for key, value in list(getattr(pei_blocks, "BLOCKS_HANDLERS", {}).items()):
        if value is orig_fix_grid_block:
            pei_blocks.BLOCKS_HANDLERS[key] = tolerant_fix_grid_block
    _PATCHED = True


def _make_exporter(site):

    _patch_exportimport_tolerance()
    exporter = ContentExporter(site)
    exporter.metadata = ei_types.ExportImportMetadata()
    exporter.obj_hooks = []
    exporter.data_hooks = []
    return exporter


def _clobber_diff_fields(
    warnings, live, base, rules: CompareRules
) -> dict[str, list[str]]:
    """For each warned rel, the fields whose cleaned DUMPS differ between LIVE
    and BASE. Dumps, not values: content_key compares canonical JSON, so two
    values that are == in Python but serialize apart (1 vs 1.0, True vs 1)
    still diverge there — a value-level compare here reported "no differing
    fields" for exactly those warnings."""

    def dumped(v):
        return json.dumps(v, sort_keys=True, ensure_ascii=False)

    diff_fields: dict[str, list[str]] = {}
    for rel in warnings[:10]:
        lv = cleaned(live.get(rel, {}), rules)
        bv = cleaned(base.get(rel, {}), rules)
        fields = sorted(
            k for k in set(lv) | set(bv) if dumped(lv.get(k)) != dumped(bv.get(k))
        )
        diff_fields[rel] = fields[:12]
    return diff_fields


def run_delta(
    site,
    request,
    layout: Path,
    layout_prev: Path,
    *,
    commit: bool,
    ignore_clobber_warnings: bool = False,
    with_relations: bool = False,
    whole_metadata: bool = False,
    base_from_live: bool = False,
    refresh: list[str] = (),
    debug: bool = False,
    review_changeset: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    ignored_fields: frozenset[str] = frozenset(),
) -> dict[str, Any]:
    """Classify layout_prev -> layout against `site`, then apply (a dry run,
    aborted, unless `commit`). Returns the report; report["apply"]["committed"]
    says whether anything landed.

    base_from_live: build the BASE from the catalog first, for a site whose
    content matches no layout on disk (an interrupted import). There is no
    snapshot to copy there, and running without a base is worse than not
    running: every rel becomes a candidate and the delta becomes the whole-site
    serialisation this exists to avoid.

    refresh: site paths ("/complaints/make-a-complaint") to take from the
    layout wherever live differs, even where base says live holds an editor's
    edit (classify_delta.refresh_from_disk). Each must be in the layout and on
    the site.

    ignore_clobber_warnings: the first commit after a full import, when the
    BASE never reflected live truth; the caller decides when that is allowed.

    review_changeset: the caller's own look at the change-set before anything
    is applied. What it returns goes in report["review"]; it refuses by
    raising DeltaRefused.

    ignored_fields: fields this site cannot round-trip, left out of every
    compare (classify.cleaned_for_compare).
    """
    if not layout.exists():
        raise DeltaRefused(f"no {layout} — write the layout first")
    report: dict[str, Any] = {}
    if base_from_live:
        t_base = time.monotonic()
        try:
            report["base_from_live"] = write_base(
                live_content_rels(site), layout, layout_prev
            )
        except (BaseExists, FileNotFoundError) as exc:
            raise DeltaRefused(str(exc)) from exc
        report["base_from_live"]["seconds"] = round(time.monotonic() - t_base, 1)
        logger.info("content-delta: base built from live %r", report["base_from_live"])

    # An EMPTY base is not a base: set(base) ^ set(disk) would be the entire
    # site — the whole-site serialisation this exists to avoid, starving the
    # public site for as long as it runs. Refused, not discovered from timing.
    if not base_holds_items(layout_prev):
        raise DeltaRefused(
            f"no BASE at {layout_prev} (missing, or holding no items). If the "
            "CURRENT layout is what's live (a full import just ran from it): "
            "cp -a layout layout-prev. If it is NOT (an interrupted import), "
            "build it from the catalog (base_from_live). Running with an empty "
            "base would serialize the whole site."
        )

    t0 = time.monotonic()
    disk, disk_dirs = load_exportimport_tree(layout / "content")
    base, _ = load_exportimport_tree(layout_prev / "content")
    logger.info(
        "content-delta: loaded disk=%d base=%d (%.1fs)",
        len(disk),
        len(base),
        time.monotonic() - t0,
    )
    # The layout's site settings go on BEFORE anything is serialised.
    # `plone.available_languages` is the vocabulary each page's language is
    # validated against, and a list that lacks the pages' own language makes
    # every live page unserialisable (ConstraintNotSatisfied). Set here, a site
    # in that state repairs itself on the next run; a dry run's abort takes the
    # change back with everything else.
    early_settings: dict[str, Any] = {}
    apply_site_settings(layout / "content", early_settings)
    logger.info("content-delta: site settings %s", early_settings["site_settings"])
    t1 = time.monotonic()
    refresh_rels = [path.strip("/") for path in refresh]
    rules = CompareRules(
        ignored_fields=ignored_fields,
        default_views=MappingProxyType(default_views_of(site)),
    )
    live = serialize_live_candidates(
        site, request, base, disk, extra=refresh_rels, rules=rules
    )
    logger.info(
        "content-delta: live candidates serialized (%.1fs)", time.monotonic() - t1
    )

    plan = classify(base, disk, live, rules)
    try:
        refresh_from_disk(plan, refresh_rels, disk, live, rules)
    except ValueError as exc:
        raise DeltaRefused(str(exc)) from exc
    # The layout's own redirects: classify only makes redirects for the moves
    # and deletes it finds. A base built from live has no redirects.json, and
    # then every one is new; apply_redirects keeps any live already has.
    base_redirects_file = layout_prev / "redirects.json"
    plan.redirects += layout_redirects(
        json.loads((layout / "redirects.json").read_text()),
        json.loads(base_redirects_file.read_text())
        if base_redirects_file.exists()
        else {},
        "/".join(site.getPhysicalPath()),
    )
    logger.info(
        "content-delta: classified creates=%d updates=%d deletes=%d moves=%d "
        "warnings=%d",
        len(plan.creates),
        len(plan.updates),
        len(plan.deletes),
        len(plan.moves),
        len(plan.warnings),
    )
    # In-process there is no classify→apply gap: live was serialized on THIS
    # connection, so its storage's last transaction IS the baseline.
    plan.base_tid = site._p_jar.db().storage.lastTransaction().hex()
    changeset = plan.to_changeset()

    report["plan"] = {k: v for k, v in changeset.items() if k != "warnings"}
    report["clobber_warnings"] = changeset["warnings"]
    # For every clobber warning, the fields whose cleaned values differ between
    # LIVE and BASE — false clobbers come from serialization-shape drift, and
    # the field names give it away.
    if debug and plan.warnings:
        report["debug"] = {
            "clobber_diff_fields": _clobber_diff_fields(
                plan.warnings, live, base, rules
            )
        }
    if review_changeset is not None:
        report["review"] = review_changeset(changeset)
    t2 = time.monotonic()
    report["apply"] = apply_changeset(
        site,
        changeset,
        layout / "content",
        dry_run=not commit,
        dir_for=disk_dirs.__getitem__,
        with_relations=with_relations,
        whole_metadata=whole_metadata,
        ignore_clobber_warnings=ignore_clobber_warnings,
    )
    logger.info("content-delta: applied (%.1fs)", time.monotonic() - t2)
    return report
