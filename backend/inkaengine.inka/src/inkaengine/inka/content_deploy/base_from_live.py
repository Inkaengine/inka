"""Build the delta's BASE from what the site actually holds.

The content delta serialises only the CANDIDATES — the rels where BASE and
DISK differ, plus arrivals, departures and both ends of a move. Everything else
is assumed live==base, which is what keeps a delta a matter of seconds:

    candidates = set(base) ^ set(disk)

So the BASE decides the cost. An EMPTY base makes every rel a candidate and
turns the delta into a whole-site serialisation — the thing that blew straight
past any sane request budget, while starving the public site, because this is
one shared vCPU.

After a full import the base is simply the layout that was imported
(cp -a layout layout-prev). This is for the other case: a site whose content
matches no layout on disk — a partial import, an interrupted one — where the
honest base is "the layout, minus the items that never made it". Candidates
then come out as the missing items plus whatever genuinely changed.

Stdlib only, and no site object: the catalog read that produces `live` belongs
to the caller. That keeps the part with all the rules in it testable without a
Plone site, and it is the reason this is a module rather than a script — a
script would need zconsole, and zconsole cannot open a storage the running
instance has locked.
"""

from __future__ import annotations

from pathlib import Path

import json
import shutil


class BaseExists(Exception):
    """The base already records a state, and rebuilding it would lose that.

    A real base is the only record of what was last applied. Rebuilding it
    from the live site declares every un-applied divergence already applied —
    silently, and in the direction that loses work.
    """


def base_holds_items(layout_prev: Path) -> bool:
    """Whether `layout_prev` is a base at all.

    An EMPTY base is not a base. The directory merely existing used to be the
    whole test, so the stub a failed run leaves behind passed it — and an empty
    base makes set(base) ^ set(disk) the entire site, which is the whole-site
    serialisation the delta exists to avoid. That has to be refused where "no
    base at all" is refused, rather than discovered from how long it takes.
    """
    return any(Path(layout_prev).glob("content/*/data.json"))


def _rel_of(data: dict) -> str:
    """The layout's spelling of an item's path, as load_exportimport_tree reads it."""
    return (data.get("@id") or "").strip("/")


def write_base(live: set[str], layout: Path, layout_prev: Path) -> dict:
    """Write `layout_prev` as `layout` minus the items not in `live`.

    `live` is site-relative paths with no leading slash ("news/one"), which is
    how both a catalog brain path (minus the site prefix) and a layout @id
    reduce.

    Returns what it did, so the caller can say it out loud: a base built from
    the wrong site would otherwise look exactly like a base built from the
    right one.
    """
    layout = Path(layout)
    layout_prev = Path(layout_prev)
    content = layout / "content"
    if not content.is_dir():
        raise FileNotFoundError(f"no {content} — write the layout first")

    existing = layout_prev / "content"
    if existing.is_dir() and any(existing.glob("*/data.json")):
        raise BaseExists(
            f"{layout_prev} already holds a base. That is the record of what was "
            "last applied; rebuilding it from the live site would declare every "
            "un-applied difference already applied. Remove it deliberately if "
            "that is what you mean."
        )

    if layout_prev.exists():
        shutil.rmtree(layout_prev)
    (layout_prev / "content").mkdir(parents=True)

    kept = 0
    candidates: list[str] = []
    for item in sorted(content.iterdir()):
        data_file = item / "data.json"
        # content/__metadata__.json is a file, not an item. Skipping it here is
        # also what leaves it out of the base — see below.
        if not data_file.is_file():
            continue
        data = json.loads(data_file.read_text())
        rel = _rel_of(data)
        # The site root has no path of its own, so it can never appear in a
        # catalog result. It is always present.
        if rel in live or not rel or item.name == "plone_site_root":
            shutil.copytree(item, layout_prev / "content" / item.name)
            kept += 1
        else:
            candidates.append(data.get("@id") or item.name)

    # No sidecars, and no content/__metadata__.json, on purpose. The delta
    # reads a base with load_exportimport_tree(), which globs `*/data.json` and
    # reads nothing else. Copying redirects.json and a _data_files_ manifest
    # would only make this tree LOOK like an importable layout while the
    # manifest disagreed with the items present — and a manifest that disagrees
    # with the tree is how 90 of 150 objects vanished silently once. This is a
    # BASE: the classifier's picture of what is live, not something to import.
    return {
        "kept": kept,
        "skipped": len(candidates),
        "candidates": candidates,
        "live": len(live),
    }


def live_content_rels(site) -> set[str]:
    """Every content path the site holds, spelled the way the layout spells it.

    unrestrictedSearchResults: a base has to describe what is THERE, not what
    the requesting user may see. A permission-filtered search would leave
    private items out of the base and the delta would then treat each of them
    as an arrival to create.
    """
    prefix = "/".join(site.getPhysicalPath())
    rels = set()
    for brain in site.portal_catalog.unrestrictedSearchResults(path=prefix):
        rel = brain.getPath()[len(prefix) :].strip("/")
        if rel:
            rels.add(rel)
    return rels
