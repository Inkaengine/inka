"""The incremental-deploy classifier.

Each test pins one row of the classification table in
docs/deploy-and-secure.md ("Deploy a site's content").
"""

from __future__ import annotations

from inkaengine.inka.content_deploy import changeset as _imod
from inkaengine.inka.content_deploy import classify as _mod
from inkaengine.inka.content_deploy.classify import cleaned_for_compare
from inkaengine.inka.content_deploy.classify import CompareRules

import copy


Action = _mod.Action
Plan = _mod.Plan
classify = _mod.classify

# A minimal local-format data.json. Volatile fields (modified/version/...) are
# present so tests can prove they're ignored for "did it change".
BASE_DOC = {
    "@id": "/services/x",
    "@type": "Document",
    "UID": "uid-x-0000000000000000000000000000",
    "id": "x",
    "title": "X",
    "description": "",
    "blocks": {"b1": {"@type": "slate", "value": [{"text": "hello"}]}},
    "blocks_layout": {"items": ["b1"]},
    "exclude_from_nav": False,
    "review_state": "published",
    "modified": "2026-06-01T00:00:00",
    "version": 1,
    "workflow_history": {"simple_publication_workflow": []},
}


def doc(rel: str, uid: str, **over):
    d = copy.deepcopy(BASE_DOC)
    d["@id"] = f"/{rel}"
    d["id"] = rel.rsplit("/", 1)[-1]
    d["UID"] = uid
    d.update(over)
    return d


def tree(*items):
    """items: (rel, data) -> {rel: data}"""
    return dict(items)


UID_X = "uid-x-0000000000000000000000000000"
UID_Y = "uid-y-0000000000000000000000000000"


def test_noop_identical_everywhere():
    d = doc("services/x", UID_X)
    plan = classify(
        tree(("services/x", d)), tree(("services/x", d)), tree(("services/x", d))
    )
    assert plan.actions_for("services/x") == Action.NOOP


def test_volatile_only_change_is_noop():
    base = doc("services/x", UID_X, modified="2026-06-01T00:00:00", version=1)
    disk = doc(
        "services/x",
        UID_X,
        modified="2026-06-09T12:00:00",
        version=7,
        workflow_history={"simple_publication_workflow": [{"action": "x"}]},
    )
    plan = classify(
        tree(("services/x", base)),
        tree(("services/x", disk)),
        tree(("services/x", base)),
    )
    assert plan.actions_for("services/x") == Action.NOOP


def test_disk_changed_live_unchanged_is_clean_update():
    base = doc("services/x", UID_X)
    disk = doc("services/x", UID_X, title="X v2")
    live = doc("services/x", UID_X)  # == base
    plan = classify(
        tree(("services/x", base)),
        tree(("services/x", disk)),
        tree(("services/x", live)),
    )
    assert plan.actions_for("services/x") == Action.UPDATE
    assert "services/x" not in plan.warnings


def test_disk_changed_and_live_changed_is_update_with_warning():
    base = doc("services/x", UID_X)
    disk = doc("services/x", UID_X, title="X disk")
    live = doc("services/x", UID_X, title="X live")  # editor changed it too
    plan = classify(
        tree(("services/x", base)),
        tree(("services/x", disk)),
        tree(("services/x", live)),
    )
    assert plan.actions_for("services/x") == Action.UPDATE
    assert "services/x" in plan.warnings


def test_disk_and_live_changed_same_way_is_update_no_warning():
    # editor's edit was already merged into disk -> apply is a no-op, no clobber
    base = doc("services/x", UID_X)
    disk = doc("services/x", UID_X, title="X both")
    live = doc("services/x", UID_X, title="X both")
    plan = classify(
        tree(("services/x", base)),
        tree(("services/x", disk)),
        tree(("services/x", live)),
    )
    assert plan.actions_for("services/x") == Action.UPDATE
    assert "services/x" not in plan.warnings


def test_live_only_change_is_left_alone():
    base = doc("services/x", UID_X)
    disk = doc("services/x", UID_X)  # disk unchanged vs base
    live = doc("services/x", UID_X, title="editor edit")
    plan = classify(
        tree(("services/x", base)),
        tree(("services/x", disk)),
        tree(("services/x", live)),
    )
    assert plan.actions_for("services/x") == Action.LEAVE
    assert "services/x" not in plan.warnings


def test_created_on_disk():
    disk = doc("services/new", UID_Y)
    plan = classify(tree(), tree(("services/new", disk)), tree())
    assert plan.actions_for("services/new") == Action.CREATE


def test_deleted_from_disk():
    base = doc("services/old", UID_Y)
    plan = classify(tree(("services/old", base)), tree(), tree(("services/old", base)))
    assert plan.actions_for("services/old") == Action.DELETE
    # 301 the removed path to its parent
    assert ("/services/old", "/services") in plan.redirects


def test_move_same_uid_different_path():
    base = doc("build", UID_X, title="Build")
    disk = doc("services/build", UID_X, title="Build")  # same UID, new path
    live = doc("build", UID_X, title="Build")
    plan = classify(
        tree(("build", base)), tree(("services/build", disk)), tree(("build", live))
    )
    assert plan.actions_for("build") == Action.MOVE
    assert any(m.src == "build" and m.dst == "services/build" for m in plan.moves)
    # a move emits an old->new redirect and is NOT counted as delete+create
    assert ("/build", "/services/build") in plan.redirects
    assert plan.actions_for("services/build") != Action.CREATE


def test_a_move_that_also_changes_is_an_update_of_the_new_path():
    # The move carries the item; a change made in the same delta is an update,
    # not lost (a moved page once kept its pre-move content).
    base = doc("build", UID_X, title="Build")
    disk = doc("services/build", UID_X, title="Build it")
    plan = classify(
        tree(("build", base)), tree(("services/build", disk)), tree(("build", base))
    )
    assert any(m.src == "build" and m.dst == "services/build" for m in plan.moves)
    assert plan.actions_for("services/build") == Action.UPDATE
    assert "services/build" in plan.updates
    assert plan.warnings == []


def test_a_move_that_also_changes_warns_over_a_live_edit():
    base = doc("build", UID_X, title="Build")
    disk = doc("services/build", UID_X, title="Build it")
    live = doc("build", UID_X, title="Edited live")
    plan = classify(
        tree(("build", base)), tree(("services/build", disk)), tree(("build", live))
    )
    assert plan.warnings == ["services/build"]


def test_a_plain_move_is_not_an_update():
    base = doc("build", UID_X, title="Build")
    disk = doc("services/build", UID_X, title="Build")
    plan = classify(
        tree(("build", base)), tree(("services/build", disk)), tree(("build", base))
    )
    assert plan.updates == []


def test_plan_is_read_only_returns_lists():
    plan = classify(tree(), tree(), tree())
    assert isinstance(plan, Plan)
    assert plan.creates == [] and plan.deletes == [] and plan.moves == []


def test_to_changeset_shape():
    base = doc("build", UID_X)
    disk = doc("services/build", UID_X)
    plan = classify(
        tree(("build", base)), tree(("services/build", disk)), tree(("build", base))
    )
    cs = plan.to_changeset()
    assert set(cs) == {
        "creates",
        "updates",
        "deletes",
        "moves",
        "redirects",
        "warnings",
        "base_tid",
    }
    assert cs["moves"] == [{"src": "build", "dst": "services/build", "uid": UID_X}]
    assert ["/build", "/services/build"] in cs["redirects"]


def test_uid_keyed_exportimport_tree_classifies_and_builds_subset(tmp_path):
    """A plone.exportimport export is UID-keyed (content/<uid>/data.json,
    hierarchy only in @id): the loader keys the classifier by @id path and hands build_subset_dir
    the dirname index, so the whole delta pipeline runs on that layout too."""
    import json as _json

    load_exportimport_tree = _mod.load_exportimport_tree

    def write(tree_dir, uid, at_id, title):
        d = tree_dir / uid
        d.mkdir(parents=True)
        (d / "data.json").write_text(
            _json.dumps({
                "@id": at_id,
                "@type": "Document",
                "UID": uid,
                "id": at_id.rsplit("/", 1)[-1],
                "title": title,
            })
        )

    base_dir = tmp_path / "base"
    disk_dir = tmp_path / "disk"
    for uid, at_id, títles in [
        ("aaaa0000000000000000000000000001", "/about", ("About", "About")),
        ("bbbb0000000000000000000000000002", "/about/team", ("Team", "Team, renamed")),
    ]:
        write(base_dir, uid, at_id, títles[0])
        write(disk_dir, uid, at_id, títles[1])
    write(disk_dir, "cccc0000000000000000000000000003", "/about/new-page", "New")

    base, _ = load_exportimport_tree(base_dir)
    disk, disk_dirs = load_exportimport_tree(disk_dir)
    plan = classify(base, disk, live=dict(base))

    assert plan.creates == ["about/new-page"]
    assert plan.updates == ["about/team"]
    assert plan.warnings == []

    # And the subset builds from the UID-keyed tree via the dirname index.

    cs = _imod.ChangeSet.from_json(plan.to_changeset())
    out = tmp_path / "subset"
    meta = _imod.build_subset_dir(cs, disk_dir, out, dir_for=disk_dirs.__getitem__)
    listed = meta["_data_files_"]
    assert "cccc0000000000000000000000000003/data.json" in listed
    assert "bbbb0000000000000000000000000002/data.json" in listed
    # parents-by-PATH ordering held even though dirnames carry no hierarchy
    assert listed.index("bbbb0000000000000000000000000002/data.json") <= 1


def test_null_field_and_absent_field_compare_equal():
    """A field serialized as null on one side and absent on the other is the
    same unset state, not a divergence. The live exporter emits e.g.
    "nav_title": null where the layout tree omits the key entirely; comparing
    dict shapes raw made every such page a false clobber (and the ?debug=1
    field-by-field .get() compare — None both ways — couldn't even name it)."""
    base = doc("services/x", UID_X)
    disk = doc("services/x", UID_X, title="X changed")
    live = doc("services/x", UID_X, nav_title=None)  # exporter noise, no edit
    plan = classify(
        tree(("services/x", base)),
        tree(("services/x", disk)),
        tree(("services/x", live)),
    )
    assert plan.actions_for("services/x") == Action.UPDATE
    assert "services/x" not in plan.warnings


def test_clearing_a_field_still_registers():
    # base has a real value; disk sets it to null -> that IS a change (unset).
    base = doc("services/x", UID_X, nav_title="Old nav")
    disk = doc("services/x", UID_X, nav_title=None)
    live = doc("services/x", UID_X, nav_title="Old nav")
    plan = classify(
        tree(("services/x", base)),
        tree(("services/x", disk)),
        tree(("services/x", live)),
    )
    assert plan.actions_for("services/x") == Action.UPDATE
    assert "services/x" not in plan.warnings


def test_default_sentinel_and_absent_compare_equal():
    """plone.exportimport writes "##DEFAULT##" for fields at the site default
    (language on most pages); the live exporter serializes the resolved value
    or omits it. The sentinel means "unset" — same state as absent."""
    base = doc("services/x", UID_X, language="##DEFAULT##")
    disk = doc("services/x", UID_X, language="##DEFAULT##", title="X changed")
    live = doc("services/x", UID_X)  # live resolved/omitted it
    plan = classify(
        tree(("services/x", base)),
        tree(("services/x", disk)),
        tree(("services/x", live)),
    )
    assert plan.actions_for("services/x") == Action.UPDATE
    assert "services/x" not in plan.warnings


def test_language_and_allow_discussion_do_not_warn():
    """language: the layout stores "##DEFAULT##" while the live exporter
    resolves it to the site default ("en") — absent-vs-resolved can never
    compare equal, so every translated page warned. allow_discussion: None
    and False mean the same thing (discussion off). Both are volatile for
    the compare; the import still applies the disk values."""
    base = doc("services/x", UID_X, language="##DEFAULT##")
    disk = doc("services/x", UID_X, language="##DEFAULT##", title="X changed")
    live = doc("services/x", UID_X, language="en", allow_discussion=False)
    plan = classify(
        tree(("services/x", base)),
        tree(("services/x", disk)),
        tree(("services/x", live)),
    )
    assert plan.actions_for("services/x") == Action.UPDATE
    assert "services/x" not in plan.warnings


# ── Empty is not an edit ────────────────────────────────────────────────────
# The live serializer writes an unset field as its empty value ("" / [] / {});
# an exportimport layout just leaves it out. Three chrome pages warned as
# "live editor edits" on every deploy over exactly this: changeNote,
# contributors, creators, rights, subjects, and a page with no blocks at all.


def test_an_empty_value_and_an_absent_one_are_the_same_content():
    absent = {"@id": "/x", "title": "X"}
    empty = {
        "@id": "/x",
        "title": "X",
        "changeNote": "",
        "rights": "",
        "contributors": [],
        "creators": [],
        "subjects": [],
    }
    assert _mod.content_key(absent) == _mod.content_key(empty)


def test_clearing_a_real_value_still_registers():
    """The point of the compare: emptying a field an author had filled is an
    edit, and must not be swallowed with the drift."""
    filled = {"@id": "/x", "title": "X", "description": "About X"}
    cleared = {"@id": "/x", "title": "X", "description": ""}
    assert _mod.content_key(filled) != _mod.content_key(cleared)


def test_a_page_with_no_blocks_matches_one_with_no_blocks_field():
    """A folder the export gives no blocks at all comes back from the live
    serializer as blocks {} with a blocks_layout of no items."""
    absent = {"@id": "/templates", "title": "Templates"}
    empty = {
        "@id": "/templates",
        "title": "Templates",
        "blocks": {},
        "blocks_layout": {"items": []},
    }
    assert _mod.content_key(absent) == _mod.content_key(empty)


def test_a_page_that_HAS_blocks_is_untouched_by_that():
    with_blocks = {
        "@id": "/x",
        "blocks": {"b1": {"@type": "slate"}},
        "blocks_layout": {"items": ["b1"]},
    }
    assert "b1" in _mod.content_key(with_blocks)
    assert _mod.content_key(with_blocks) != _mod.content_key({"@id": "/x"})


def test_creators_is_not_an_editor_edit():
    """The export records no creator at all; the import stamps whoever ran it
    ("admin"). Value-against-unset can never compare equal, so the three
    chrome pages warned on every deploy. Volatile for the COMPARE only — the
    import still applies whatever the disk says."""
    base = doc("templates", UID_X, creators=None)
    disk = doc("templates", UID_X, creators=None, title="Templates changed")
    live = doc("templates", UID_X, creators=["admin"])
    plan = classify(
        tree(("templates", base)), tree(("templates", disk)), tree(("templates", live))
    )
    assert plan.actions_for("templates") == Action.UPDATE
    assert "templates" not in plan.warnings


def test_importer_bookkeeping_is_not_a_live_edit():
    """A freshly imported object diverges from the layout tree in the fields the
    importer itself stamps — creators from the importing user, changeNote and
    friends at their defaults. Comparing those made every apply warn that an
    editor had changed a page nobody had touched, which spends the one clobber
    override on noise. Provenance is not content, and the conversion does not
    carry it."""
    layout = {"title": "Site footer", "blocks": {"a": 1}}
    live = {
        "title": "Site footer",
        "blocks": {"a": 1},
        "creators": ["admin"],
        "contributors": ["admin"],
        "changeNote": "",
        "rights": "",
        "subjects": [],
    }
    assert cleaned_for_compare(live) == cleaned_for_compare(layout)


def test_a_real_content_change_still_registers():
    """The guard above must not swallow an actual edit."""
    layout = {"title": "Site footer", "blocks": {"a": 1}}
    live = {"title": "Site footer EDITED", "blocks": {"a": 1}, "creators": ["admin"]}
    assert cleaned_for_compare(live) != cleaned_for_compare(layout)


def test_fields_the_site_cannot_round_trip_do_not_warn():
    """A field no schema on the site declares can NEVER round-trip: the import
    can't set it, the live export can't emit it, and every touched page warned
    forever. A capability gap is not an editor edit — the site names such
    fields and they leave the compare (the tree keeps the data)."""
    base = doc("news/x", UID_X, Finding="Sustained")
    disk = doc("news/x", UID_X, Finding="Sustained", title="X changed")
    live = doc("news/x", UID_X)  # live can't hold the field
    unaware = classify(
        tree(("news/x", base)), tree(("news/x", disk)), tree(("news/x", live))
    )
    assert unaware.warnings == ["news/x"]

    plan = classify(
        tree(("news/x", base)),
        tree(("news/x", disk)),
        tree(("news/x", live)),
        CompareRules(ignored_fields=frozenset({"Finding"})),
    )
    assert plan.actions_for("news/x") == Action.UPDATE
    assert plan.warnings == []


def test_items_in_nested_folders_are_part_of_the_tree(tmp_path):
    """A layout may name its folders by path, so an item's folder can sit
    inside another item's (`videos/` and `videos/intro/`). Reading one level
    deep left every nested item out of the delta: a change to one never
    deployed."""
    import json as _json

    for dirname, at_id in (("videos", "/videos"), ("videos/intro", "/videos/intro")):
        (tmp_path / dirname).mkdir(parents=True)
        (tmp_path / dirname / "data.json").write_text(
            _json.dumps({"@id": at_id, "@type": "Document", "UID": dirname})
        )
    tree, dirs = _mod.load_exportimport_tree(tmp_path)
    assert sorted(tree) == ["videos", "videos/intro"]
    assert dirs == {"videos": "videos", "videos/intro": "videos/intro"}


def test_where_a_blob_was_exported_is_not_content():
    """`blob_path` is where an export put a file's bytes: the exporter writes
    `<uid>/file/x.mp4`, a layout with path-named folders `videos/x/file/x.mp4`.
    Same bytes, so the same content — but a real change to the file (its
    size, its name, its type) still registers."""
    layout = {
        "@id": "/v",
        "file": {"blob_path": "videos/v/file/v.mp4", "filename": "v.mp4", "size": 10},
    }
    live = {
        "@id": "/v",
        "file": {"blob_path": "0123abcd/file/v.mp4", "filename": "v.mp4", "size": 10},
    }
    assert _mod.content_key(layout) == _mod.content_key(live)
    resized = {"@id": "/v", "file": {**live["file"], "size": 11}}
    assert _mod.content_key(resized) != _mod.content_key(live)


def test_parent_follows_from_the_path_and_is_not_content():
    """The live exporter leaves `parent` out; a layout may carry it. It is
    derived from `@id`, so a move still registers through `@id`."""
    with_parent = {"@id": "/videos/v", "title": "V", "parent": {"@id": "/videos"}}
    without = {"@id": "/videos/v", "title": "V"}
    assert _mod.content_key(with_parent) == _mod.content_key(without)


def test_an_item_on_its_types_default_view_is_unset():
    """Plone reports an item's default view as `layout: <default view>`, and a
    converted tree leaves the key out. That holds for any type the site has,
    its own included, by the default view the site gives it. Another view is
    an editor's choice and still counts."""
    rules = CompareRules(
        default_views={"Document": "document_view", "SiteOwnType": "own_view"}
    )
    for portal_type, default in (
        ("Document", "document_view"),
        ("SiteOwnType", "own_view"),
    ):
        live = doc("templates/footer", UID_X, **{"@type": portal_type, "layout": default})
        disk = doc("templates/footer", UID_X, **{"@type": portal_type})
        assert cleaned_for_compare(live, rules) == cleaned_for_compare(disk, rules)
        chosen = doc(
            "templates/footer", UID_X, **{"@type": portal_type, "layout": "summary_view"}
        )
        assert cleaned_for_compare(chosen, rules) != cleaned_for_compare(disk, rules)


def test_the_site_root_is_the_export_root_whatever_the_site_is_called(tmp_path):
    """The root is the item the export keeps in `plone_site_root`, the export
    format's own name for it. Not a site called `Plone` (a site's id is its
    own: `/lecc`), and not a type name: a page whose id is `Plone` is a page."""
    import json as _json

    items = (
        ("plone_site_root", {"@id": "/lecc", "@type": "SiteRootOfAnyType", "UID": "root"}),
        ("aaa", {"@id": "/Plone", "@type": "Document", "UID": "aaa"}),
    )
    for dirname, data in items:
        (tmp_path / dirname).mkdir(parents=True)
        (tmp_path / dirname / "data.json").write_text(_json.dumps(data))
    tree, dirs = _mod.load_exportimport_tree(tmp_path)
    assert tree["plone_site_root"]["UID"] == "root"
    assert tree["Plone"]["UID"] == "aaa"
    assert dirs == {"plone_site_root": "plone_site_root", "Plone": "aaa"}
