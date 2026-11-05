"""Pure (no-Plone) helpers for the incremental content apply.

The classifier (classify.py) computes a change-set of rel-paths; this module
turns the create/update slice of that change-set into a minimal
plone.exportimport distribution dir (just the changed items + a subset
``__metadata__.json``) that ContentImporter can upsert. Kept free of Plone
imports so it is unit-testable on a plain Python. See
docs/deploy-and-secure.md ("Deploy a site's content").
"""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any

import json
import shutil


def review_state_action(desired: str | None, current: str | None) -> str | None:
    """Target workflow state to transition an upserted item to, or None to skip.

    Pure decision (Plone-free, unit-tested). Skip when the item declares no
    review_state, has no workflow (current is None), or is already in the
    desired state; otherwise return the state to transition to.
    """
    if not desired:
        return None
    if current is None:
        return None
    if current == desired:
        return None
    return desired


@dataclass
class ChangeSet:
    creates: list[str] = field(default_factory=list)
    updates: list[str] = field(default_factory=list)
    deletes: list[str] = field(default_factory=list)
    moves: list[dict[str, str]] = field(default_factory=list)  # {src,dst,uid}
    redirects: list[tuple[str, str]] = field(default_factory=list)  # (old_path,new)
    # rel-paths whose LIVE editor edit applying this change-set would overwrite
    # (the classifier's 3-way clobber list). The apply engine REFUSES to commit
    # while this is non-empty — see apply_changes.apply_changeset. Loading it here
    # (it used to be dropped) is what makes the gate un-bypassable.
    warnings: list[str] = field(default_factory=list)
    # The live ZODB transaction id this change-set was classified against, so the
    # engine can refuse a STALE change-set (live edited since the export the
    # warnings were computed from). None on legacy change-sets.
    base_tid: str | None = None

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> ChangeSet:
        return cls(
            creates=list(data.get("creates", [])),
            updates=list(data.get("updates", [])),
            deletes=list(data.get("deletes", [])),
            moves=[dict(m) for m in data.get("moves", [])],
            redirects=[tuple(r) for r in data.get("redirects", [])],
            warnings=list(data.get("warnings", [])),
            base_tid=data.get("base_tid"),
        )

    def upsert_rels(self) -> list[str]:
        """Items whose content must be (re)imported: creates + updates. (Moves
        are handled by relocating the live object, not re-importing.)"""
        seen: dict[str, None] = {}
        for rel in [*self.creates, *self.updates]:
            seen[rel] = None
        return list(seen)


def data_sort_key(rel_data_json: str) -> tuple:
    """Order _data_files_ so the site root and parents come before children
    (plone.exportimport imports in order; a child can't be placed before its
    container exists). Matches convert-export-to-local.py's ordering."""
    is_root = rel_data_json == "plone_site_root/data.json"
    return (0 if is_root else 1, rel_data_json.count("/"), rel_data_json)


# The metadata plone.exportimport's ContentImporter applies through
# metadata_setters(), reading the metadata of the tree it is handed.
#
# RELATIONS IS NOT HERE, deliberately: re-restoring them is minutes of work
# (413 relations plus link integrity over the whole graph) and a delta rarely
# changes them, so they stay behind ?relations=1.
SUBSET_SETTERS = ("ordering", "default_page", "local_roles", "local_permissions")


def _parent_path(data_json: Path) -> str:
    """The folder an item sits in, from its data.json `@id` ("" = site root)."""
    return json.loads(data_json.read_text())["@id"].rsplit("/", 1)[0]


def subset_metadata_setters(
    dist_content_dir: Path,
    kept_dirs: set[str],
    kept_uids: set[str],
    whole: bool = False,
) -> dict:
    """The setter metadata for just the items this subset ships.

    The subset used to carry `_data_files_` and nothing else, so the importer
    read no `ordering` and no `default_page` and applied neither. Two visible
    consequences, both found by comparing a converted site against its source:

      * the top-level nav came out in insertion order, not the source's;
      * the page `default_page` names as the SITE'S HOME PAGE stayed an
        ordinary sibling and appeared in the nav under the site's title.

    `local_roles` and `local_permissions` were being dropped by the same line,
    silently, which is the same bug with a quieter symptom.

    FILTERED to the subset, because this metadata is applied wholesale: passing
    an entry for an item the subset does not ship would ask the importer to
    reposition or re-permission content this change-set never touched.

    `default_page` is keyed by CONTAINER, not by the page, so it needs the
    other rule: keep it when its TARGET is here. The site root is almost never
    in a delta, and that entry is precisely the one that matters.
    """
    meta_path = Path(dist_content_dir) / "__metadata__.json"
    if not meta_path.is_file():
        return {}
    source = json.loads(meta_path.read_text())

    out: dict = {}
    for name in SUBSET_SETTERS:
        data = source.get(name)
        if not isinstance(data, dict):
            continue
        # WHOLE, for state that is wrong on items which are not changing. The
        # filtered form fixes items inside a change-set; it cannot correct a
        # site's navigation when its pages were created correctly and
        # only their metadata is wrong — so they never become candidates and
        # their `ordering` and `default_page` never ride along.
        #
        # Safe to apply beyond the subset because the setters resolve an object
        # by UID globally (object_from_uid_or_path falls back to
        # object_from_uid), and SITE_ROOT_UID = "plone_site_root" is
        # special-cased to the portal — which is the one entry that matters,
        # since the site's home page is named by its CONTAINER.
        #
        # Opt-in, because applying the whole table on every delta would
        # reposition and re-permission content the change-set never mentions.
        if whole:
            out[name] = data
            continue
        if name == "default_page":
            kept = {
                key: value
                for key, value in data.items()
                if key in kept_dirs
                or (
                    isinstance(value, dict)
                    and value.get("default_page_uuid") in kept_uids
                )
            }
        elif name == "ordering":
            # A position is the export's absolute index, and our folders hold
            # items the export does not (templates, rebuilt pages), so one item
            # placed alone lands elsewhere RELATIVE to siblings left where they
            # were — a page shipped without its earlier siblings went first
            # in the nav. Every sibling of a shipped
            # item is placed with it; the importer sorts by position, so the
            # folder's relative order is the export's.
            parent_of = {
                key: _parent_path(dist_content_dir / key / "data.json") for key in data
            }
            folders = {parent_of[key] for key in kept_dirs if key in parent_of}
            kept = {
                key: value for key, value in data.items() if parent_of[key] in folders
            }
        else:
            kept = {key: value for key, value in data.items() if key in kept_dirs}
        if kept:
            out[name] = kept
    return out


def build_subset_dir(
    changeset: ChangeSet,
    dist_content_dir: Path,
    out_dir: Path,
    dir_for=None,
    whole_metadata: bool = False,
) -> dict[str, list[str]]:
    """Copy the create/update items out of the baked distribution into a
    minimal importable dir at ``out_dir/content`` and write a subset
    ``__metadata__.json``. Returns the metadata that was written.

    Parents already live on the site are NOT included — the importer only needs
    the changed items; it navigates to existing containers by path.

    ``dir_for(rel)`` maps a change-set rel-path to the item's DIRECTORY name
    under ``dist_content_dir`` — identity by default (path-keyed trees), or an
    @id→UID-dirname index for UID-keyed trees (plone.exportimport's own
    export). plone.exportimport keys items by their data.json ``@id``, never
    the dirname, so the subset imports the same either way.
    """
    resolve = dir_for or (lambda rel: rel)
    content_out = out_dir / "content"
    content_out.mkdir(parents=True, exist_ok=True)

    entries: list[tuple[str, str]] = []  # (rel for ordering, dirname on disk)
    blob_files: list[str] = []
    kept_uids: set[str] = set()
    for rel in changeset.upsert_rels():
        dirname = resolve(rel)
        src_dir = dist_content_dir / dirname
        data_json = src_dir / "data.json"
        if not data_json.is_file():
            raise FileNotFoundError(
                f"change-set item {rel!r} has no data.json at {data_json}"
            )
        uid = json.loads(data_json.read_text()).get("UID")
        if uid:
            kept_uids.add(uid)
        dst_dir = content_out / dirname
        if dst_dir.exists():
            shutil.rmtree(dst_dir)
        shutil.copytree(src_dir, dst_dir)
        entries.append((rel, dirname))
        # blob sidecars (image/<filename>, file/<filename>, ...) for this item
        for f in sorted(src_dir.rglob("*")):
            if f.is_file() and f.name != "data.json":
                blob_files.append(f"{f.relative_to(dist_content_dir).as_posix()}")

    # Parents before children BY CONTENT PATH (the rel), whatever the dirnames.
    entries.sort(key=lambda pair: data_sort_key(f"{pair[0]}/data.json"))
    data_files = [f"{dirname}/data.json" for _, dirname in entries]
    blob_files.sort()
    metadata = {
        "__version__": "1.0.0",
        "_blob_files_": blob_files,
        "_data_files_": data_files,
    }
    metadata.update(
        subset_metadata_setters(
            dist_content_dir,
            {dirname for _, dirname in entries},
            kept_uids,
            whole=whole_metadata,
        )
    )
    (content_out / "__metadata__.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return metadata


def split_id(rel: str) -> tuple[str, str]:
    """('services/build') -> ('services', 'build');  ('build') -> ('', 'build')."""
    parent, _, name = rel.rpartition("/")
    return parent, name


def load_relations(relations_path: Path) -> list[dict[str, str]]:
    """Read+validate the distribution's ``relations.json`` (sibling of the
    content/ dir). Returns [] if absent (a distribution with no relations).

    plone.exportimport keeps relations OUT of per-object data.json (intids differ
    per environment), so preview_image_link (a teaser -> a shared
    image) rides here as {from_uuid, to_uuid, from_attribute}.
    The incremental apply resolves the UUIDs on the live site — see
    apply_changes.apply_relations. Fail loudly on a malformed entry rather than
    silently skipping a relation that would then never apply.
    """
    if not relations_path.is_file():
        return []
    data = json.loads(relations_path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(
            f"{relations_path} must be a JSON list, got {type(data).__name__}"
        )
    required = ("from_uuid", "to_uuid", "from_attribute")
    for i, rel in enumerate(data):
        if not isinstance(rel, dict):
            raise ValueError(f"{relations_path}[{i}] is not an object: {rel!r}")
        missing = [k for k in required if not rel.get(k)]
        if missing:
            raise ValueError(f"{relations_path}[{i}] missing/empty {missing}: {rel!r}")
    return data
