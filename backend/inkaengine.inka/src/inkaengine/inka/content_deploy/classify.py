"""The 3-way content-delta classifier.

Given three content trees:

  BASE  - the content as it was last applied
  DISK  - the content to deploy                 (what live should become)
  LIVE  - the current site, serialized the way the exporter writes it

classify, per item, the action the incremental apply WOULD take, plus a WARN
list where applying DISK would overwrite an editor edit made on LIVE. Pure and
read-only: it computes the plan and writes nothing. See
docs/deploy-and-secure.md ("Deploy a site's content") for the model.
"""

from __future__ import annotations

from .changeset import item_data_files
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from types import MappingProxyType
from typing import Any
from typing import Mapping

import enum
import json


# Fields that do NOT constitute a meaningful content change, so two data.jsons
# differing only here compare equal. Timestamps/version/history are volatile;
# the rest are derived fields the exporter emits and the importer ignores.
VOLATILE: frozenset[str] = frozenset({
    # volatile metadata. created and effective are volatile too: a converted
    # tree can store naive local datetimes while the live site serializes
    # tz-aware UTC, so they never compare equal and every page false-flagged
    # as a live editor edit (71 clobbers on a site nobody edited). Date
    # corrections don't sync through the delta as a result.
    "created",
    "effective",
    # language: the layout stores "##DEFAULT##" while the live exporter
    # resolves it (usually "en") — absent-vs-resolved never compares equal,
    # so every translated page warned. allow_discussion: None == False
    # (discussion off). Volatile for the COMPARE only — imports still apply
    # the disk values.
    "language",
    "allow_discussion",
    "modified",
    "modification_date",
    "expires",
    "version",
    "version_id",
    "workflow_history",
    "lock",
    "working_copy",
    "working_copy_of",
    "cmf_uid",
    # creators: the export records none at all and the import stamps whoever
    # ran it ("admin"), so a value can never meet an unset — chrome
    # pages warned as live editor edits on every deploy over this alone.
    # Provenance, not content; the import still applies the disk value.
    "creators",
    # derived / exportimport-internal
    "breadcrumbs",
    "navigation",
    "navroot",
    "contextnavigation",
    "next_item",
    "previous_item",
    "contentinfo",
    "siteinfo",
    "types",
    "actions",
    "@components",
    "resolved_uids",
    "items_total",
    "is_folderish",
    "type_title",
    "workflow",
    # derived from @id, which carries the path (and so any move); the live
    # exporter leaves it out while a hand-written layout may not.
    "parent",
    # per-object system flags a live export carries but hand-maintained git does
    # not: enabling versioning on an object bumps `versioning_enabled`, which must
    # NOT register as a content divergence (else every deploy of that object is
    # falsely refused as a clobber). `exportimport.*` plumbing is handled by the
    # prefix filter in content_key() below.
    "versioning_enabled",
    # Editorial bookkeeping the IMPORTER writes, not content anyone authored.
    # ContentImporter stamps creators/contributors from the importing user and
    # leaves changeNote/rights/subjects at their defaults, so a freshly applied
    # object diverges from the layout tree in exactly these fields — and the
    # NEXT apply then reads that divergence as "an editor changed this page".
    # templates/site-footer warned on every run for precisely this, which spends
    # the one clobber override on a page nobody touched. A real change to any of
    # them is not content: it is provenance, and the conversion does not carry it.
    "changeNote",
    "contributors",
    "rights",
    "subjects",
})


class Action(enum.Enum):
    NOOP = "noop"
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    MOVE = "move"
    LEAVE = "leave"  # disk unchanged but live has an editor edit — don't touch


@dataclass
class Move:
    src: str
    dst: str
    uid: str


@dataclass
class Plan:
    creates: list[str] = field(default_factory=list)
    updates: list[str] = field(default_factory=list)
    deletes: list[str] = field(default_factory=list)
    moves: list[Move] = field(default_factory=list)
    leaves: list[str] = field(default_factory=list)
    noops: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    redirects: list[tuple[str, str]] = field(default_factory=list)
    # live ZODB tid this plan was classified against (stamped into the change-set
    # as base_tid so the apply engine can reject a stale change-set — Gate 2).
    base_tid: str | None = None
    _action: dict[str, Action] = field(default_factory=dict)

    def actions_for(self, rel: str) -> Action:
        return self._action.get(rel, Action.NOOP)

    def to_changeset(self) -> dict:
        """Serialize to the change-set the apply endpoint consumes."""
        return {
            "creates": list(self.creates),
            "updates": list(self.updates),
            "deletes": list(self.deletes),
            "moves": [{"src": m.src, "dst": m.dst, "uid": m.uid} for m in self.moves],
            "redirects": [list(r) for r in self.redirects],
            "warnings": list(self.warnings),
            "base_tid": self.base_tid,
        }


@dataclass(frozen=True)
class CompareRules:
    """What a site leaves out when the delta compares two copies of an item.

    `ignored_fields`: the site's own fields it cannot round-trip. The import
    can't set what no schema declares and the live export can't emit it, so
    every touched page would warn forever. A capability gap is not an editor
    edit; the tree keeps the data.

    `default_views`: each content type's default view, as the site's type
    settings give it (delta.default_views_of). An item on it has no view of its
    own, whichever way a copy spells that."""

    ignored_fields: frozenset[str] = frozenset()
    default_views: Mapping[str, str] = field(
        default_factory=lambda: MappingProxyType({})
    )


NO_RULES = CompareRules()


def cleaned_for_compare(
    data: dict[str, Any], rules: CompareRules = NO_RULES
) -> dict[str, Any]:
    """The fields that PARTICIPATE in the delta compare — the single filter
    content_key and the clobber-debug field diff share, so debug can never
    name a field the compare ignores (or miss one it does use).

    v is not None: a field serialized as null and a field absent are the same
    unset state — the live exporter emits nulls (e.g. nav_title) that the
    layout trees omit, and keeping them made every such page a false clobber.
    A REAL clearing still registers: value -> null drops the key on one side
    only. "##DEFAULT##" is exportimport's site-default sentinel = unset.

    An EMPTY value is the same unset state for the same reason: the live
    serializer writes "" / [] / {} where the layout leaves the field out.
    Chrome pages warned as live editor edits on every deploy over exactly
    this — changeNote, rights, contributors, creators, subjects. A real
    clearing still registers here too: the filled side keeps the key.

    `rules`: what this site leaves out of the compare (CompareRules)."""
    cleaned = {
        k: v
        for k, v in data.items()
        if v is not None
        and v != "##DEFAULT##"
        and v != ""
        and v != []
        and v != {}
        and k not in VOLATILE
        and k not in rules.ignored_fields
        and not k.startswith("exportimport.")
    }
    # A page with NO blocks: the live serializer says blocks {} (dropped as
    # empty just above) and blocks_layout {"items": []} — not empty itself, a
    # dict holding an empty list — while the export omits both. Same page.
    # The rule lives HERE, in the shared filter: put it in content_key alone
    # and the clobber debug names blocks_layout on a page the compare treats
    # as identical, which is exactly what this docstring promises it cannot.
    if not cleaned.get("blocks") and not (cleaned.get("blocks_layout") or {}).get(
        "items"
    ):
        cleaned.pop("blocks", None)
        cleaned.pop("blocks_layout", None)
    # An item on its type's default view is the same unset state: Plone sets
    # `layout: document_view` when it creates a page, and a converted tree
    # leaves the key out, so every page a delta CREATED warned as a live edit
    # the first time a later delta updated it (72 pages and two layout
    # templates on one conversion). A site's own types count the same: an
    # item whose type changes in place keeps no layout of its own. Another
    # view is an editor's choice and still counts.
    layout = cleaned.get("layout")
    if layout is not None and layout == rules.default_views.get(cleaned.get("@type")):
        cleaned.pop("layout")
    # A file's `blob_path` is where an export put its bytes: `<uid>/file/x` from
    # the exporter, `videos/x/file/x` in a layout whose folders are named by
    # path. Every such file warned as a live edit. Its name, type and size are
    # the file; where it was exported to is not.
    for key, value in list(cleaned.items()):
        if isinstance(value, dict) and "blob_path" in value:
            cleaned[key] = {k: v for k, v in value.items() if k != "blob_path"}
    return cleaned


def content_key(
    data: dict[str, Any], rules: CompareRules = NO_RULES
) -> str:
    """Canonical JSON of the meaningful content (volatile fields removed)."""
    cleaned = cleaned_for_compare(data, rules)
    # Author-date fields (created/effective) ARE synced, but the live export and
    # hand-maintained git serialize them with different sub-minute precision / tz
    # (e.g. "2023-07-12T21:29:00+00:00" vs "2023-07-12T21:29:42"). A 42-second
    # difference is serialization noise, not a content edit — normalize to minute
    # precision so it can't register as a divergence (and falsely clobber a deploy).
    for _dk in ("effective", "created"):
        _v = cleaned.get(_dk)
        if isinstance(_v, str) and len(_v) >= 16 and _v[10:11] == "T":
            cleaned[_dk] = _v[:16]
    return json.dumps(cleaned, sort_keys=True, ensure_ascii=False)


def rel_to_path(rel: str) -> str:
    return "/" + rel


def parent_path(rel: str) -> str:
    head, _, _ = rel.rpartition("/")
    return "/" + head if head else "/"


def _uid_index(tree: dict[str, dict]) -> dict[str, str]:
    return {d["UID"]: rel for rel, d in tree.items() if d.get("UID")}


def load_exportimport_tree(content_dir):
    """Load a plone.exportimport content dir into the classifier's shape:
    ({rel: data}, {rel: dirname}). The rel-path comes from each item's @id
    (an export's dirname is a UID and carries no hierarchy; a layout's may be
    a path, at any depth); pass the second mapping as ``dir_for`` to
    build_subset_dir/apply_changeset. The site root becomes 'plone_site_root'.
    """
    content_dir = Path(content_dir)
    tree: dict[str, dict] = {}
    dirs: dict[str, str] = {}
    for data_file in item_data_files(content_dir):
        data = json.loads(data_file.read_text())
        at_id = data.get("@id") or ""
        if data.get("@type") == "Plone Site" or at_id in ("/", "/Plone"):
            rel = "plone_site_root"
        else:
            rel = at_id.lstrip("/")
        if not rel:
            continue
        tree[rel] = data
        dirs[rel] = data_file.parent.relative_to(content_dir).as_posix()
    return tree, dirs


def layout_redirects(
    disk_raw: dict[str, str], base_raw: dict[str, str], site_path: str
) -> list[tuple[str, str]]:
    """The layout's redirects.json entries the base did not already carry, as
    site-relative (old, new) pairs for the change-set — apply_redirects adds
    the physical prefix back, and keeps any redirect live already has.

    `site_path` is the site's physical path; the conversion writes every entry
    under it (normalise_redirects). One that is not is a form nobody has
    looked at, and fails rather than being stored where nothing looks it up.
    """

    def relative(path: str) -> str:
        if path == site_path:
            return "/"
        if path.startswith(site_path + "/"):
            return path[len(site_path) :]
        raise ValueError(f"redirect outside the site {site_path}: {path}")

    return [
        (relative(old), relative(new))
        for old, new in disk_raw.items()
        if base_raw.get(old) != new
    ]


# What a move itself changes: the item's path. Left out when asking whether a
# moved item's CONTENT changed too.
_PATH_FIELDS = ("@id", "id", "parent")


def _moved_key(data: dict[str, Any], rules: CompareRules) -> str:
    return content_key(
        {k: v for k, v in data.items() if k not in _PATH_FIELDS}, rules
    )


def classify(  # noqa: C901
    base: dict[str, dict],
    disk: dict[str, dict],
    live: dict[str, dict],
    rules: CompareRules = NO_RULES,
) -> Plan:
    """Classify base->disk changes, annotated against live. See the table in
    docs/deploy-and-secure.md ("Deploy a site's content"). `rules`: see
    cleaned_for_compare."""
    plan = Plan()

    # Moves first: same UID at a different path in base vs disk. A moved item is
    # neither a delete (of the old path) nor a create (of the new path).
    base_by_uid = _uid_index(base)
    disk_by_uid = _uid_index(disk)
    move_src: dict[str, str] = {}  # old rel -> new rel
    move_dst: dict[str, str] = {}  # new rel -> old rel
    for uid, rel_new in disk_by_uid.items():
        rel_old = base_by_uid.get(uid)
        if rel_old is not None and rel_old != rel_new:
            move_src[rel_old] = rel_new
            move_dst[rel_new] = rel_old
            plan.moves.append(Move(src=rel_old, dst=rel_new, uid=uid))
            plan.redirects.append((rel_to_path(rel_old), rel_to_path(rel_new)))
            plan._action[rel_old] = Action.MOVE

    for rel in sorted(set(base) | set(disk)):
        if rel in move_src:
            continue  # old path of a move — already classified MOVE
        in_base, in_disk = rel in base, rel in disk

        if in_disk and not in_base:
            if rel in move_dst:
                # New path of a move. The move carries the item, not a change
                # to its content: one made in the same delta is an update of
                # the new path (applied after the item is moved there). Live is
                # still at the old path. Skipped, the change was lost and the
                # base advanced past it, so every later delta took the stale
                # page for an editor's edit.
                old = move_dst[rel]
                kb = _moved_key(base[old], rules)
                kd = _moved_key(disk[rel], rules)
                if kb != kd:
                    plan.updates.append(rel)
                    plan._action[rel] = Action.UPDATE
                    kl = _moved_key(live[old], rules) if old in live else None
                    if kl is not None and kl != kb and kl != kd:
                        plan.warnings.append(rel)
                continue
            plan.creates.append(rel)
            plan._action[rel] = Action.CREATE
            continue

        if in_base and not in_disk:
            plan.deletes.append(rel)
            plan._action[rel] = Action.DELETE
            plan.redirects.append((rel_to_path(rel), parent_path(rel)))
            continue

        # present in both base and disk
        kb = content_key(base[rel], rules)
        kd = content_key(disk[rel], rules)
        kl = content_key(live[rel], rules) if rel in live else None
        live_diverged = kl is not None and kl != kb

        if kb == kd:
            # disk didn't change this item
            if live_diverged:
                plan.leaves.append(rel)
                plan._action[rel] = Action.LEAVE
            else:
                plan.noops.append(rel)
                plan._action[rel] = Action.NOOP
            continue

        # disk changed this item -> apply (disk wins)
        plan.updates.append(rel)
        plan._action[rel] = Action.UPDATE
        # Warn only if applying disk would actually change live AWAY from an
        # editor edit. If disk == live (e.g. the edit was already merged into
        # disk), the apply is a no-op — no clobber, no warning.
        if live_diverged and kl != kd:
            plan.warnings.append(rel)

    return plan


def refresh_from_disk(
    plan: Plan,
    rels: list[str],
    disk: dict,
    live: dict,
    rules: CompareRules = NO_RULES,
) -> None:
    """Take each of `rels` from disk wherever live differs, whatever base says.

    The classification leaves a live page that differs from an unchanged base
    alone (LEAVE: an editor's edit) and never warns about it. A page asked for
    by name is the person's decision that live is wrong: it becomes an update,
    and no clobber warning, since overwriting live is the point.
    """
    for rel in rels:
        if rel not in disk:
            raise ValueError(f"refresh {rel!r}: the layout has no such page")
        if rel not in live:
            raise ValueError(f"refresh {rel!r}: not on the site")
        if content_key(live[rel], rules) == content_key(
            disk[rel], rules
        ):
            continue
        for bucket in (plan.leaves, plan.noops, plan.warnings):
            if rel in bucket:
                bucket.remove(rel)
        if rel not in plan.updates:
            plan.updates.append(rel)
        plan._action[rel] = Action.UPDATE


def load_tree(content_dir: Path) -> dict[str, dict]:
    """Walk a distribution content dir -> {rel_path: data.json}.

    Skips plone.app.iterate working copies (objects with a `working_copy_of`
    relation): they're drafts of a checked-out baseline, not deployable content.
    The live export emits them as real objects, so without this the classifier
    would see each draft as a new object to create/sync — leaking work-in-progress
    into git/prod. (The reverse `working_copy` field on the baseline is already in
    VOLATILE, so a checkout doesn't false-delta the baseline itself.)
    """
    out: dict[str, dict] = {}
    for data_file in content_dir.rglob("data.json"):
        data = json.loads(data_file.read_text())
        if data.get("working_copy_of"):
            continue
        rel = data_file.parent.relative_to(content_dir).as_posix()
        out[rel] = data
    return out
