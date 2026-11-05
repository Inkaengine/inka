"""In-process incremental content apply for the live Plone site.

``apply_changeset(site, changeset, dist_content_dir, dry_run)`` applies ONLY the
changed items (the classifier's plan), leaving everything else — including live
editor edits on untouched pages — alone:

  create / update -> subset plone.exportimport ContentImporter (upsert by path)
  move            -> plone.api.content.move (preserves UID + version history)
  delete          -> plone.api.content.delete
  redirect        -> IRedirectionStorage (physical-path prefixed)

``dry_run=True`` runs every step then ``transaction.abort()`` — the real Plone
code paths execute against real data but nothing is persisted, so it is safe to
run against a live Data.fs snapshot. See docs/deploy-and-secure.md ("Deploy a
site's content").
"""

from __future__ import annotations

from .changeset import build_subset_dir
from .changeset import ChangeSet
from .changeset import load_relations
from .changeset import review_state_action
from .changeset import split_id
from pathlib import Path
from plone import api
from plone.app.redirector.interfaces import IRedirectionStorage
from plone.exportimport.importers.content import ContentImporter
from Products.CMFCore.utils import getToolByName
from Products.CMFPlone.relationhelper import restore_relations
from typing import Any
from zope.component import getUtility
from zope.component.hooks import site as site_hook

import json
import tempfile
import transaction


def _physical(site, path: str) -> str:
    """portal-relative '/services/x' -> physical '/Plone/services/x'."""
    portal_path = "/".join(site.getPhysicalPath())
    return f"{portal_path}{path}"


def _traverse(site, rel: str):
    """Object at content rel-path 'services/x', or None if any segment missing."""
    obj = site
    for part in rel.split("/"):
        if obj is None:
            return None
        obj = obj.get(part)
    return obj


def apply_upserts(
    site,
    cs: ChangeSet,
    dist_content_dir: Path,
    report: dict[str, Any],
    dir_for=None,
    whole_metadata: bool = False,
) -> None:
    rels = cs.upsert_rels()
    # The whole metadata is for state that is wrong on items which are NOT
    # changing, so an empty change-set is its main case, not a reason to skip
    # it: the importer then ships no items and applies only the setters.
    if not rels and not whole_metadata:
        report["upsert"] = {"items": [], "importer": "nothing to upsert"}
        return
    tmp = Path(tempfile.mkdtemp(prefix="apply-subset-"))
    build_subset_dir(
        cs, Path(dist_content_dir), tmp, dir_for=dir_for, whole_metadata=whole_metadata
    )
    # ContentImporter.import_data(base) reads base/content/__metadata__.json and
    # upserts each listed item by path (construct = update-in-place if the path
    # exists, else create) — see plone/exportimport/importers/content.py.
    importer = ContentImporter(site)
    # NEVER let the importer commit mid-run: apply_changeset's final
    # abort/commit is the ONLY transaction boundary, and a dry-run on the LIVE
    # site must be fully abortable. plone.exportimport commits internally by
    # default (intermediate_commits) — with it on, "dry run" wrote to live.
    importer.intermediate_commits = False
    msg = importer.import_data(tmp)
    report["upsert"] = {"items": rels, "importer": msg}


def apply_review_states(
    site, cs: ChangeSet, dist_content_dir: Path, report: dict[str, Any], dir_for=None
) -> None:
    """Transition upserted items to the review_state declared in their data.json.

    ContentImporter restores workflow state from `workflow_history`, but the
    deploy strips that as a volatile field — so a publish/retract (review_state
    change) would otherwise never apply (e.g. /search stayed private -> 404).
    Apply it explicitly: for each upserted item whose live state differs from its
    declared review_state, transition to the declared state. Items with no
    workflow (get_state -> None) or already in the target state are skipped.
    """
    done: list[str] = []
    for rel in cs.upsert_rels():
        resolve = dir_for or (lambda r: r)
        data_file = Path(dist_content_dir) / resolve(rel) / "data.json"
        if not data_file.exists():
            continue
        desired = json.loads(data_file.read_text()).get("review_state")
        if not desired:
            continue
        obj = _traverse(site, rel)
        if obj is None:
            continue
        current = api.content.get_state(obj=obj, default=None)
        target = review_state_action(desired, current)
        if target is None:
            continue
        # Fails loudly if there's no transition path to the target state.
        api.content.transition(obj=obj, to_state=target)
        done.append(f"{rel}: {current} -> {target}")
    report["review_state"] = done


def apply_site_settings(dist_content_dir, report: dict[str, Any]) -> None:
    """Set the site's registry records from the layout's site-settings.json.

    Content alone does not carry the site-wide settings it depends on: a
    language selector lists the site's ``plone.available_languages``, which
    lives in the registry, not in any data.json. The layout carries the records
    the site keeps next to relations.json, in the order they must be set —
    combined codes like "en-au" are only valid languages once
    ``plone.use_combined_language_codes`` is on.

    Re-applied every run, like relations: cheap, and the file is the source of
    truth. A value the registry rejects raises (set_registry_record validates).
    The report gives each record's value before and after, so a dry run shows
    what would change.
    """
    settings_file = Path(dist_content_dir).parent / "site-settings.json"
    if not settings_file.exists():
        report["site_settings"] = "no site-settings.json"
        return
    settings = json.loads(settings_file.read_text())
    changes: dict[str, Any] = {}
    for name, value in settings.items():
        before = api.portal.get_registry_record(name)
        if before != value:
            api.portal.set_registry_record(name, value)
            changes[name] = {"before": before, "after": value}
    report["site_settings"] = changes or "unchanged"


# The registration tool reads `username` from the properties too.
_MEMBER_KEYS_NOT_PROPERTIES = ("password", "roles", "groups", "login_name")


def apply_principals(dist_content_dir, report: dict[str, Any]) -> None:
    """Add the source site's groups and members from the layout's
    principals.json (plone.exportimport's), so its editors log in to the
    converted site with the passwords they have.

    A member's password is its HASH ({SSHA}...): PAS stores an already-encrypted
    value as it is, so the original password still authenticates. A group or
    member already on the site is left alone — its password may have been
    reset here. Memberships are added from both sides (a group's principals,
    a member's groups); one naming a principal or group the export does not
    have is skipped and counted (memberships_skipped, by kind).

    Unlike plone.exportimport's importer, nothing is skipped quietly: a member
    without an email, or one the registration tool refuses, fails the run.
    The report — and every error — is counts only: it goes to a CI log, so
    never a name, an address or a hash.
    """
    principals_file = Path(dist_content_dir).parent / "principals.json"
    if not principals_file.exists():
        report["principals"] = "no principals.json"
        return
    data = json.loads(principals_file.read_text())
    with api.env.adopt_roles(["Manager"]):
        groups_added = _add_groups(data["groups"])
        users_added, users_already_here = _add_members(data["members"])
        memberships_added, memberships_skipped = _add_memberships(data)
    report["principals"] = {
        "groups_added": groups_added,
        "users_added": users_added,
        "users_already_here": users_already_here,
        "memberships_added": memberships_added,
        "memberships_skipped": memberships_skipped,
    }


def _add_groups(groups: list[dict[str, Any]]) -> int:
    added = 0
    for group in groups:
        if api.group.get(groupname=group["groupid"]) is None:
            api.group.create(
                groupname=group["groupid"],
                title=group["title"],
                description=group["description"],
                roles=group["roles"],
            )
            added += 1
    return added


def _add_members(members: list[dict[str, Any]]) -> tuple[int, int]:
    registration = api.portal.get_tool("portal_registration")
    acl_users = api.portal.get_tool("acl_users")
    added = already_here = 0
    for member in members:
        username = member["username"]
        if api.user.get(username=username) is not None:
            already_here += 1
            continue
        properties = {
            k: v for k, v in member.items() if k not in _MEMBER_KEYS_NOT_PROPERTIES
        }
        # Roles are granted after, not passed here: addMember allows only
        # roles the CALLER holds (_limitGrantedRoles), and the zconsole
        # system user holds none of the site's.
        registration.addMember(username, member["password"], [], [], properties)
        roles = [r for r in member["roles"] if r != "Authenticated"]
        if roles:
            api.user.grant_roles(username=username, roles=roles)
        # A site that logs in by email has a login name apart from the id.
        if member.get("login_name"):
            acl_users.updateLoginName(username, member["login_name"])
        added += 1
    return added, already_here


def _membership_kind(principal: str) -> str:
    """What a principal the export has no account for looks like — for the
    report, which never names one."""
    if principal == "admin":
        return "admin"
    if "@" in principal:
        return "email-like"
    return "other"


def _add_memberships(data: dict[str, Any]) -> tuple[int, dict[str, int]]:
    """Memberships from both sides. One naming a principal or group the
    export does not have is skipped and counted by kind: an export's groups
    can list principals it has no account for (a user of the old server's
    root user folder, one deleted while still in a group), and there is no
    one to make a member of."""
    portal_groups = api.portal.get_tool("portal_groups")
    exported_groups = {g["groupid"] for g in data["groups"]}
    exported_users = {m["username"] for m in data["members"]}
    memberships = {(g["groupid"], p) for g in data["groups"] for p in g["principals"]}
    memberships |= {
        (g, m["username"]) for m in data["members"] for g in m.get("groups", [])
    }
    added = 0
    skipped: dict[str, int] = {}
    for groupid, principal in sorted(memberships):
        if groupid not in exported_groups:
            kind = "group not in the export"
        elif principal not in exported_users and principal not in exported_groups:
            kind = _membership_kind(principal)
        else:
            kind = None
        if kind:
            skipped[kind] = skipped.get(kind, 0) + 1
            continue
        group = api.group.get(groupname=groupid)
        if principal in group.getGroupMemberIds():
            continue
        portal_groups.addPrincipalToGroup(principal, groupid)
        added += 1
    return added, skipped


def apply_relations(site, dist_content_dir, report: dict[str, Any]) -> None:
    """Set relation fields (preview_image_link) from the distribution's
    relations.json.

    plone.exportimport keeps relations OUT of per-object data.json and imports
    them in a SEPARATE RelationsImporter step — which the incremental apply
    (ContentImporter only) never runs. So without this, a page's
    preview_image_link (teaser -> a shared image, which plone.volto prefers
    over the leadimage AND aggregates into the summary `image_scales` the
    listing renders from) would never take effect on the live site.

    Uses Plone's canonical ``restore_relations`` — the same helper
    plone.exportimport's RelationsImporter runs — which for a behavior RelationChoice
    (preview_image_link lives on the IPreviewLink behavior) does the piece a plain
    setattr/ObjectModifiedEvent misses: ``update_behavior_relations`` to wire the
    relation catalog for marker-interface behaviors. It's non-purging for a
    single-value RelationChoice, so other relations are untouched. We then reindex
    each item's image_scales (RelationsImporter reindexes too) so the summary the
    listing renders from carries the linked logo's scales.

    Fails loudly on a missing object. The report echoes the resulting
    ``image_scales`` keys per item so a dry-run PROVES ``preview_image_link`` got
    aggregated before we commit.
    """
    relations = load_relations(Path(dist_content_dir).parent / "relations.json")
    if not relations:
        report["relations"] = "no relations.json"
        return
    # Fail loudly BEFORE touching anything if a listed object is missing (restore
    # only logs+skips, which would silently drop a relation).
    for rel in relations:
        if (
            api.content.get(UID=rel["from_uuid"]) is None
            or api.content.get(UID=rel["to_uuid"]) is None
        ):
            raise LookupError(f"relations.json references a missing object: {rel!r}")

    restore_relations(all_relations=relations)

    # restore_relations wires the RELATION catalog but not the portal_catalog
    # image_scales metadata the listing summary renders from — reindex like the
    # RelationsImporter does (both ends).
    catalog = getToolByName(site, "portal_catalog")
    scales_keys: dict[str, Any] = {}
    for rel in relations:
        from_obj = api.content.get(UID=rel["from_uuid"])
        api.content.get(UID=rel["to_uuid"]).reindexObject()
        from_obj.reindexObject(
            idxs=["image_scales", "image_field", "hasPreviewImage"],
            update_metadata=True,
        )
        brains = catalog(UID=rel["from_uuid"])
        sc = getattr(brains[0], "image_scales", None) if brains else None
        scales_keys[from_obj.getId()] = (
            sorted(sc.keys()) if isinstance(sc, dict) else sc
        )
    report["relations"] = {"restored": len(relations), "image_scales_keys": scales_keys}


def apply_moves(
    site, cs: ChangeSet, report: dict[str, Any], early: bool = False
) -> None:
    """Move each item to its new path. `early`: before the upserts, so an item
    that moved AND changed is updated where it now is (the importer upserts by
    path: at the new path before the move it would create a second object with
    the same UID). The early pass leaves a move into a container the upserts
    have yet to create to the late pass; one of those that must also be updated
    is refused, never imported twice."""
    done: list[str] = []
    updated = set(cs.updates)
    for m in cs.moves:
        src = _traverse(site, m["src"])
        if src is None:
            continue  # already at destination — idempotent
        parent_rel, new_id = split_id(m["dst"])
        target = _traverse(site, parent_rel) if parent_rel else site
        if target is None and early:
            if m["dst"] in updated:
                raise LookupError(
                    f"{m['src']!r} moves into {parent_rel!r}, which this delta "
                    "creates, and changes: apply the move first (a delta without "
                    "the change), then this one"
                )
            continue
        if target is None:
            raise LookupError(f"move target parent missing for {m['dst']!r}")
        # A rename stays where it is in its folder: plone.api.content.move only
        # renames in place when `source.aq_parent is target`, and the target
        # traversed here is never that same wrapper, so a rename became a cut
        # and paste to the folder's end (/pdf-files' 21st item went last and
        # off the listing's first page).
        if target.getPhysicalPath() == src.aq_parent.getPhysicalPath():
            api.content.rename(obj=src, new_id=new_id)
        else:
            # plone.api.content.move keeps the object (UID + version history)
            # and handles cross-container moves (manage_renameObject would not).
            api.content.move(source=src, target=target, id=new_id)
        done.append(f"{m['src']} -> {m['dst']}")
    report["move_early" if early else "move"] = done


def apply_deletes(site, cs: ChangeSet, report: dict[str, Any]) -> None:
    done: list[str] = []
    for rel in cs.deletes:
        obj = _traverse(site, rel)
        if obj is None:
            continue  # already gone — idempotent
        api.content.delete(obj=obj, check_linkintegrity=False)
        done.append(rel)
    report["delete"] = done


def apply_redirects(site, cs: ChangeSet, report: dict[str, Any]) -> None:
    storage = getUtility(IRedirectionStorage)
    done: list[str] = []
    kept: list[str] = []
    for old, new in cs.redirects:
        old_p = _physical(site, old)
        # Respect an existing (curated) redirect — e.g. a redirects.json entry
        # points a consolidated page at its canonical target. Don't clobber
        # that with the auto delete->parent default.
        if storage.has_path(old_p):
            kept.append(old)
            continue
        storage.add(old_p, _physical(site, new))
        done.append(f"{old} -> {new}")
    report["redirect"] = done
    if kept:
        report["redirect_kept_existing"] = kept


def _live_tid_hex(site) -> str:
    """Hex of the live storage's last committed transaction id."""
    return site._p_jar.db().storage.lastTransaction().hex()


def _editor_edits_since(site, base_tid_hex: str) -> list[dict[str, Any]]:
    """Editor content writes committed since ``base_tid_hex`` (newest first).

    Walks the ZODB undo log and keeps only REST content writes (PATCH/POST/DELETE
    on a content path). Excludes locks, logins, searches and the release setup
    scripts (not REST writes), so a routine
    redeploy/boot never false-trips the freshness gate — only a human editor
    saving content does.
    """
    import base64

    try:
        base = bytes.fromhex(base_tid_hex)
    except (ValueError, TypeError):
        # Unparseable base_tid — caller treats an empty result as "can't verify",
        # but the gate also refuses a missing/garbage base_tid outright.
        return []
    edits: list[dict[str, Any]] = []
    for t in site._p_jar.db().undoInfo(0, 500):  # newest first
        if base64.b64decode(t["id"]) <= base:
            break  # reached the classified baseline; everything older is merged
        desc = t.get("description") or ""
        if not any(
            m in desc
            for m in (
                "PATCH_application_json",
                "POST_application_json",
                "DELETE_application_json",
            )
        ):
            continue
        if any(s in desc for s in ("@lock", "@login", "@search", "@querystring")):
            continue
        edits.append({"time": t.get("time"), "user": t.get("user_name"), "what": desc})
    return edits


def apply_changeset(
    site,
    changeset,
    dist_content_dir,
    dry_run: bool = True,
    dir_for=None,
    with_relations: bool = True,
    ignore_clobber_warnings: bool = False,
    whole_metadata: bool = False,
) -> dict[str, Any]:
    """``dir_for(rel)`` maps a change-set rel-path to the item's directory name
    under ``dist_content_dir`` — identity for path-keyed trees, an @id→dirname
    index for UID-keyed exportimport trees."""
    cs: ChangeSet = (
        changeset
        if isinstance(changeset, ChangeSet)
        else ChangeSet.from_json(changeset)
    )
    report: dict[str, Any] = {"dry_run": dry_run, "warnings": list(cs.warnings)}

    # ====================================================================
    # COMMIT GATES — the un-bypassable safety. Enforced HERE (the engine),
    # not just in a deploy script, so no caller can skip them. A live
    # homepage edit was once wiped because an apply ran past the deploy
    # script's clobber check. Never remove these.
    # ====================================================================
    if not dry_run:
        # Gate 1: the change-set would overwrite a live editor edit (the
        # classifier's 3-way clobber list). Merge it into the distribution first.
        # ignore_clobber_warnings is the caller's ONE-TIME first-sync override
        # (the first commit after a full import, where BASE never reflected
        # live truth); Gate 2 below still runs regardless.
        if cs.warnings and ignore_clobber_warnings:
            report["clobber_overridden"] = list(cs.warnings)
        elif cs.warnings:
            report["error"] = (
                f"refusing to commit: {len(cs.warnings)} item(s) have live editor "
                "edits this change-set would overwrite — merge them first"
            )
            report["must_merge"] = list(cs.warnings)
            report["committed"] = False
            return report
        # Gate 2 (REQUIRED — the authoritative, payload-independent clobber check).
        # The change-set MUST carry base_tid: the live tid it was classified
        # against. The engine then RE-DERIVES the check from the live
        # ZODB undo log itself — it does NOT trust the change-set's `warnings` —
        # and refuses if any editor content write landed since base_tid. So a
        # forged `warnings: []` is useless: a real live edit since classify is
        # detected here regardless. No tid -> no upload (the missing-tid lenient
        # path was a hole; it's closed). A forged base_tid would still need a
        # signed tid to defeat this — a separate, lower-priority hardening.
        if not cs.base_tid:
            report["error"] = (
                "refusing to commit: change-set has no base_tid. The apply REQUIRES "
                "the live transaction id it was classified against to verify "
                "nothing was edited since. Classify it again."
            )
            report["committed"] = False
            return report
        try:
            bytes.fromhex(cs.base_tid)
        except (ValueError, TypeError):
            report["error"] = (
                f"refusing to commit: base_tid {cs.base_tid!r} is not a valid "
                "transaction id."
            )
            report["committed"] = False
            return report
        edits_since = _editor_edits_since(site, cs.base_tid)
        if edits_since:
            report["error"] = (
                "refusing to commit: live changed since this change-set was built "
                f"({len(edits_since)} editor content edit(s)) — re-pull and reclassify"
            )
            report["edits_since_base"] = edits_since
            report["committed"] = False
            return report

    with site_hook(site):
        # The source's accounts first, so the content's sharing names
        # principals that exist. Every run, like the site settings: what is
        # already here is left alone.
        apply_principals(dist_content_dir, report)
        # Order: moves into containers that exist; upserts (parents-before-
        # children inside the subset) create/update; the remaining moves
        # relocate into what the upserts created; deletes remove; redirects
        # last (the source path is now vacated).
        apply_moves(site, cs, report, early=True)
        apply_upserts(
            site,
            cs,
            dist_content_dir,
            report,
            dir_for=dir_for,
            whole_metadata=whole_metadata,
        )
        apply_review_states(site, cs, dist_content_dir, report, dir_for=dir_for)
        # Site-wide registry settings the content depends on (the translate
        # languages); every run, like relations — the file is the truth.
        apply_site_settings(dist_content_dir, report)
        # Relations after upserts (any newly-created endpoints now exist) and
        # decoupled from the change-set: relations.json is the source of truth,
        # re-applied idempotently every deploy (cheap — skips already-correct).
        if with_relations:
            apply_relations(site, dist_content_dir, report)
        else:
            report["relations"] = "skipped (with_relations=False)"
        apply_moves(site, cs, report)
        apply_deletes(site, cs, report)
        apply_redirects(site, cs, report)
    if dry_run:
        transaction.abort()
        report["committed"] = False
    else:
        transaction.commit()
        report["committed"] = True
    return report
