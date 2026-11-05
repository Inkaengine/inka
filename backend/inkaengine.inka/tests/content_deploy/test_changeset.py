"""Unit tests for the pure incremental-apply helpers (no Plone needed)."""

from __future__ import annotations

from inkaengine.inka.content_deploy.changeset import build_subset_dir
from inkaengine.inka.content_deploy.changeset import ChangeSet
from inkaengine.inka.content_deploy.changeset import data_sort_key
from inkaengine.inka.content_deploy.changeset import load_relations
from inkaengine.inka.content_deploy.changeset import split_id
from pathlib import Path

import json
import tempfile


def _make_dist(root: Path, items: dict[str, dict]) -> Path:
    """items: {rel: data.json dict (+ optional '__blobs__': {relname: bytes})}"""
    content = root / "content"
    for rel, data in items.items():
        d = content / rel
        d.mkdir(parents=True, exist_ok=True)
        blobs = data.pop("__blobs__", {})
        (d / "data.json").write_text(json.dumps(data))
        for name, payload in blobs.items():
            bf = d / name
            bf.parent.mkdir(parents=True, exist_ok=True)
            bf.write_bytes(payload)
    return content


def test_changeset_from_json_roundtrips():
    cs = ChangeSet.from_json({
        "creates": ["services/build"],
        "updates": ["services/x"],
        "deletes": ["services/old"],
        "moves": [{"src": "build", "dst": "services/build", "uid": "u"}],
        "redirects": [["/build", "/services/build"]],
    })
    assert cs.creates == ["services/build"]
    assert cs.moves[0]["dst"] == "services/build"
    assert cs.redirects == [("/build", "/services/build")]


def test_upsert_rels_dedup_and_order():
    cs = ChangeSet(creates=["a", "b"], updates=["b", "c"])
    assert cs.upsert_rels() == ["a", "b", "c"]


def test_sort_key_root_then_parents_before_children():
    files = [
        "services/x/y/data.json",
        "services/data.json",
        "plone_site_root/data.json",
        "services/x/data.json",
    ]
    assert sorted(files, key=data_sort_key) == [
        "plone_site_root/data.json",
        "services/data.json",
        "services/x/data.json",
        "services/x/y/data.json",
    ]


def test_split_id():
    assert split_id("services/build") == ("services", "build")
    assert split_id("build") == ("", "build")


def test_build_subset_copies_only_changed_items_with_metadata():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        dist = _make_dist(
            tmp / "dist",
            {
                "services/build": {"@id": "/services/build", "title": "Build"},
                "services/operate": {"@id": "/services/operate", "title": "Operate"},
                "services/untouched": {"@id": "/services/untouched", "title": "Nope"},
            },
        )
        cs = ChangeSet(creates=["services/build"], updates=["services/operate"])
        out = tmp / "subset"
        meta = build_subset_dir(cs, dist, out)

        # only the two changed items were copied
        assert (out / "content/services/build/data.json").is_file()
        assert (out / "content/services/operate/data.json").is_file()
        assert not (out / "content/services/untouched").exists()
        # subset metadata lists exactly those, parents-before-children ordered
        assert meta["_data_files_"] == [
            "services/build/data.json",
            "services/operate/data.json",
        ]
        # round-trips on disk
        written = json.loads((out / "content/__metadata__.json").read_text())
        assert written["_data_files_"] == meta["_data_files_"]


def test_build_subset_includes_blob_sidecars():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        dist = _make_dist(
            tmp / "dist",
            {
                "images/logo": {
                    "@id": "/images/logo",
                    "@type": "Image",
                    "__blobs__": {"image/logo.png": b"\x89PNG..."},
                },
            },
        )
        cs = ChangeSet(creates=["images/logo"])
        out = tmp / "subset"
        meta = build_subset_dir(cs, dist, out)
        assert (
            out / "content/images/logo/image/logo.png"
        ).read_bytes() == b"\x89PNG..."
        assert meta["_blob_files_"] == ["images/logo/image/logo.png"]


def test_build_subset_missing_item_fails_loudly():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        dist = _make_dist(tmp / "dist", {})
        cs = ChangeSet(creates=["services/ghost"])
        try:
            build_subset_dir(cs, dist, tmp / "subset")
        except FileNotFoundError:
            return
        raise AssertionError("expected FileNotFoundError for a missing item")


def test_load_relations_absent_returns_empty():
    with tempfile.TemporaryDirectory() as tmp:
        assert load_relations(Path(tmp) / "relations.json") == []


def test_load_relations_reads_valid_entries():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "relations.json"
        rels = [
            {
                "from_uuid": "cs1",
                "to_uuid": "logo1",
                "from_attribute": "preview_image_link",
            },
            {
                "from_uuid": "cs2",
                "to_uuid": "logo1",
                "from_attribute": "preview_image_link",
            },
        ]
        p.write_text(json.dumps(rels))
        assert load_relations(p) == rels


def test_load_relations_missing_key_fails_loudly():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "relations.json"
        # to_uuid absent -> would silently never apply; must raise instead.
        p.write_text(
            json.dumps([{"from_uuid": "cs1", "from_attribute": "preview_image_link"}])
        )
        try:
            load_relations(p)
        except ValueError:
            return
        raise AssertionError("expected ValueError for a relation missing to_uuid")


def test_load_relations_empty_value_fails_loudly():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "relations.json"
        p.write_text(
            json.dumps([
                {
                    "from_uuid": "cs1",
                    "to_uuid": "",
                    "from_attribute": "preview_image_link",
                }
            ])
        )
        try:
            load_relations(p)
        except ValueError:
            return
        raise AssertionError("expected ValueError for an empty to_uuid")


def test_load_relations_non_list_fails_loudly():
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "relations.json"
        p.write_text(json.dumps({"from_uuid": "x"}))
        try:
            load_relations(p)
        except ValueError:
            return
        raise AssertionError("expected ValueError for a non-list relations.json")


def _make_dist_with_metadata(
    root: Path, items: dict[str, dict], metadata: dict
) -> Path:
    """A distribution whose content/__metadata__.json carries setter data."""
    content = _make_dist(root, items)
    existing = {"__version__": "1.0.0", "_blob_files_": [], "_data_files_": []}
    (content / "__metadata__.json").write_text(json.dumps({**existing, **metadata}))
    return content


def test_build_subset_carries_ordering_for_the_items_it_ships():
    """Position-in-parent, or the nav comes out in insertion order.

    plone.exportimport's ContentImporter applies `ordering` through
    metadata_setters(), reading the metadata of the tree it is given. The
    subset wrote only _data_files_, so nothing was ever ordered — a
    converted site's top-level nav came out the wrong way round against the
    source.
    """
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        dist = _make_dist_with_metadata(
            tmp / "dist",
            {
                "a": {"@id": "/a", "UID": "uid-a"},
                "b": {"@id": "/b", "UID": "uid-b"},
                # in another folder, so not a sibling of anything shipped
                "elsewhere": {"@id": "/elsewhere", "UID": "uid-e"},
                "untouched": {"@id": "/elsewhere/untouched", "UID": "uid-u"},
            },
            {"ordering": {"a": 2, "b": 1, "elsewhere": 3, "untouched": 0}},
        )
        cs = ChangeSet(creates=["a"], updates=["b"])
        meta = build_subset_dir(cs, dist, tmp / "subset")

        # `elsewhere` is a sibling of a and b (all at the root), so it is
        # placed too; what sits inside it is not.
        assert meta["ordering"] == {"a": 2, "b": 1, "elsewhere": 3}


def test_an_item_moves_with_all_its_siblings():
    """Positions are the export's absolute indices, and our folders hold items
    the export does not (templates, rebuilt pages), so one item placed alone
    lands somewhere else relative to siblings that were not placed. A
    change-set shipping `contact` but not `about`/`services` put it FIRST in
    the top-level nav (export: 45 about, 46 services, 47 contact). Every
    sibling of a shipped item is placed with it; the
    importer sorts by position, so their relative order is the export's."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        dist = _make_dist_with_metadata(
            tmp / "dist",
            {
                "UA": {"@id": "/about", "UID": "UA"},
                "UC": {"@id": "/services", "UID": "UC"},
                "UK": {"@id": "/contact", "UID": "UK"},
                "UX": {"@id": "/about/team", "UID": "UX"},
            },
            {"ordering": {"UA": 45, "UC": 46, "UK": 47, "UX": 0}},
        )
        meta = build_subset_dir(ChangeSet(updates=["UK"]), dist, tmp / "subset")
        assert meta["ordering"] == {"UA": 45, "UC": 46, "UK": 47}


def test_build_subset_carries_the_default_page_that_points_into_it():
    """The site's home page, which is why a stray page showed up in the nav.

    `default_page` is keyed by CONTAINER, and the container here is the site
    root — which a delta almost never ships. The entry has to come across on
    the strength of its TARGET being in the subset, or the page that should be
    the home page stays an ordinary sibling, and appeared in the main nav on
    every page under the site's title.
    """
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        dist = _make_dist_with_metadata(
            tmp / "dist",
            {"front-page": {"@id": "/front-page", "UID": "uid-front"}},
            {
                "default_page": {
                    "plone_site_root": {
                        "default_page": "front-page",
                        "default_page_uuid": "uid-front",
                    },
                    "other-folder": {
                        "default_page": "index",
                        "default_page_uuid": "uid-elsewhere",
                    },
                }
            },
        )
        cs = ChangeSet(creates=["front-page"])
        meta = build_subset_dir(cs, dist, tmp / "subset")

        assert "plone_site_root" in meta["default_page"]
        # the one pointing at content this subset does not ship is left out
        assert "other-folder" not in meta["default_page"]


def test_build_subset_carries_local_roles_and_permissions():
    """Dropped silently on every delta until now — the same bug, quieter."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        dist = _make_dist_with_metadata(
            tmp / "dist",
            {"a": {"@id": "/a", "UID": "uid-a"}, "b": {"@id": "/b", "UID": "uid-b"}},
            {
                "local_roles": {"a": {"local_roles": {"someone": ["Owner"]}}, "b": {}},
                "local_permissions": {"a": {}, "b": {"View": {"acquire": False}}},
            },
        )
        cs = ChangeSet(creates=["a"])
        meta = build_subset_dir(cs, dist, tmp / "subset")

        assert meta["local_roles"] == {"a": {"local_roles": {"someone": ["Owner"]}}}
        assert meta["local_permissions"] == {"a": {}}


def test_build_subset_leaves_relations_alone():
    """Relations are gated behind ?relations=1 on purpose.

    Re-restoring them is minutes of work — 413 relations plus link integrity
    over the whole graph — so carrying them here would make every delta pay for
    something it rarely changes.
    """
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        dist = _make_dist_with_metadata(
            tmp / "dist",
            {"a": {"@id": "/a", "UID": "uid-a"}},
            {"relations": [{"from_uuid": "uid-a", "to_uuid": "uid-b"}]},
        )
        meta = build_subset_dir(ChangeSet(creates=["a"]), dist, tmp / "subset")

        assert "relations" not in meta


def test_build_subset_without_source_metadata_still_works():
    """A distribution with no setter data is not an error, it is a tree with
    nothing to say — and must not become an empty `ordering` that the importer
    would read as "put everything at position 0"."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        dist = _make_dist(tmp / "dist", {"a": {"@id": "/a"}})
        meta = build_subset_dir(ChangeSet(creates=["a"]), dist, tmp / "subset")

        assert "ordering" not in meta
        assert meta["_data_files_"] == ["a/data.json"]


def test_build_subset_metadata_round_trips_to_disk():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        dist = _make_dist_with_metadata(
            tmp / "dist",
            {"a": {"@id": "/a", "UID": "uid-a"}},
            {"ordering": {"a": 7}},
        )
        out = tmp / "subset"
        build_subset_dir(ChangeSet(creates=["a"]), dist, out)

        written = json.loads((out / "content/__metadata__.json").read_text())
        assert written["ordering"] == {"a": 7}


def test_build_subset_can_carry_the_whole_metadata():
    """For state that is wrong on items that are NOT changing.

    The filtered form fixes items inside a change-set. It cannot correct a
    site's navigation when its pages were created correctly and only
    their METADATA is wrong — so they never become candidates, and their
    `ordering` and `default_page` never ride along.

    plone.exportimport's setters resolve an object by UID globally
    (object_from_uid_or_path falls back to object_from_uid), and
    SITE_ROOT_UID = "plone_site_root" is special-cased to the portal. So the
    whole table can be applied even though the subset ships two items.
    """
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        dist = _make_dist_with_metadata(
            tmp / "dist",
            {"a": {"@id": "/a", "UID": "uid-a"}, "b": {"@id": "/b", "UID": "uid-b"}},
            {
                "ordering": {"a": 2, "b": 1, "untouched": 0},
                "default_page": {
                    "plone_site_root": {
                        "default_page": "front-page",
                        "default_page_uuid": "uid-front",
                    }
                },
            },
        )
        meta = build_subset_dir(
            ChangeSet(creates=["a"]), dist, tmp / "subset", whole_metadata=True
        )

        # every position, not just the shipped item's
        assert meta["ordering"] == {"a": 2, "b": 1, "untouched": 0}
        # and the site root's default page, whose target ships in no delta
        assert "plone_site_root" in meta["default_page"]


def test_the_whole_metadata_is_opt_in():
    """Default stays filtered: applying the whole table on every delta would
    reposition content the change-set never mentions."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        dist = _make_dist_with_metadata(
            tmp / "dist",
            {
                "a": {"@id": "/a", "UID": "uid-a"},
                "f": {"@id": "/f", "UID": "uid-f"},
                "untouched": {"@id": "/f/untouched", "UID": "uid-u"},
            },
            {"ordering": {"a": 1, "f": 2, "untouched": 0}},
        )
        meta = build_subset_dir(ChangeSet(creates=["a"]), dist, tmp / "subset")
        assert meta["ordering"] == {"a": 1, "f": 2}


def test_the_whole_metadata_still_leaves_relations_alone():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        dist = _make_dist_with_metadata(
            tmp / "dist",
            {"a": {"@id": "/a", "UID": "uid-a"}},
            {
                "relations": [{"from_uuid": "uid-a", "to_uuid": "uid-b"}],
                "ordering": {"a": 1},
            },
        )
        meta = build_subset_dir(
            ChangeSet(creates=["a"]), dist, tmp / "subset", whole_metadata=True
        )
        assert "relations" not in meta
