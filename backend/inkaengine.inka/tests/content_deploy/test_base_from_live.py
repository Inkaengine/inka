"""TDD for building the delta's BASE from what the site actually holds.

The delta serialises only the candidates:

    candidates = set(base) ^ set(disk)

so the BASE decides what a delta costs. An ABSENT base makes every rel a
candidate and turns the delta into a whole-site serialisation. After a clean
full import the base is just a copy of the layout; this is for the other case,
a site whose content matches no layout on disk (an interrupted import), where
the honest base is the layout minus the items that never arrived.

Standalone — no Plone. The catalog read that produces `live` is the only part
that needs a site, and it is deliberately not in here.
"""

from __future__ import annotations

from inkaengine.inka.content_deploy import base_from_live
from pathlib import Path

import json
import pytest


def make_layout(tmp_path: Path, items: dict[str, str]) -> Path:
    """A plone.exportimport content tree: {dirname: @id}."""
    layout = tmp_path / "layout"
    content = layout / "content"
    content.mkdir(parents=True)
    for dirname, at_id in items.items():
        item = content / dirname
        item.mkdir()
        (item / "data.json").write_text(json.dumps({"@id": at_id, "title": at_id}))
    # The sidecars a real export carries, which a BASE must not inherit.
    (content / "__metadata__.json").write_text(
        json.dumps({"_data_files_": [f"{d}/data.json" for d in items]})
    )
    (layout / "redirects.json").write_text("{}")
    return layout


def test_keeps_only_the_items_the_site_actually_holds(tmp_path):
    """The base is the layout minus what never arrived."""
    layout = make_layout(
        tmp_path,
        {"aaa": "/news/one", "bbb": "/news/two", "ccc": "/news/three"},
    )
    prev = tmp_path / "layout-prev"

    report = base_from_live.write_base({"news/one", "news/three"}, layout, prev)

    assert report["kept"] == 2
    assert report["skipped"] == 1
    kept = {json.loads(p.read_text())["@id"] for p in prev.glob("content/*/data.json")}
    assert kept == {"/news/one", "/news/three"}


def test_the_missing_items_become_the_candidates(tmp_path):
    """What is left out is exactly what the delta will have to look at."""
    layout = make_layout(tmp_path, {"aaa": "/a", "bbb": "/b", "ccc": "/c"})
    prev = tmp_path / "layout-prev"

    report = base_from_live.write_base({"a"}, layout, prev)

    assert report["candidates"] == ["/b", "/c"]


def test_the_site_root_is_always_kept(tmp_path):
    """The root has no path of its own, so it can never be in `live`."""
    layout = make_layout(tmp_path, {"plone_site_root": "/", "aaa": "/a"})
    prev = tmp_path / "layout-prev"

    base_from_live.write_base({"a"}, layout, prev)

    assert (prev / "content/plone_site_root/data.json").is_file()


def test_no_manifest_and_no_sidecars_are_carried_over(tmp_path):
    """A BASE is the classifier's picture, not an importable layout.

    load_exportimport_tree() globs `*/data.json` and reads nothing else. A
    _data_files_ manifest listing items the tree no longer holds is how
    content vanishes silently, so it must not be copied.
    """
    layout = make_layout(tmp_path, {"aaa": "/a", "bbb": "/b"})
    prev = tmp_path / "layout-prev"

    base_from_live.write_base({"a"}, layout, prev)

    assert not (prev / "content/__metadata__.json").exists()
    assert not (prev / "redirects.json").exists()


def test_it_refuses_to_destroy_a_base_that_already_has_content(tmp_path):
    """A real base is the only record of what was last applied.

    Overwriting it from the live site would declare every un-applied
    divergence already applied — silently, and in the direction that loses
    work. An EMPTY base (the stub a failed run leaves) is not a record and is
    replaced without complaint.
    """
    layout = make_layout(tmp_path, {"aaa": "/a"})
    prev = tmp_path / "layout-prev"
    (prev / "content/zzz").mkdir(parents=True)
    (prev / "content/zzz/data.json").write_text(json.dumps({"@id": "/z"}))

    with pytest.raises(base_from_live.BaseExists):
        base_from_live.write_base({"a"}, layout, prev)

    # and it is untouched
    assert (prev / "content/zzz/data.json").is_file()


def test_an_empty_base_stub_is_replaced(tmp_path):
    layout = make_layout(tmp_path, {"aaa": "/a"})
    prev = tmp_path / "layout-prev"
    (prev / "content").mkdir(parents=True)

    report = base_from_live.write_base({"a"}, layout, prev)

    assert report["kept"] == 1


def test_a_missing_layout_fails_loudly(tmp_path):
    with pytest.raises(FileNotFoundError):
        base_from_live.write_base({"a"}, tmp_path / "layout", tmp_path / "layout-prev")


def test_an_empty_base_directory_is_not_a_base(tmp_path):
    """The stub a failed run leaves behind must not read as a usable base.

    With an empty base, set(base) ^ set(disk) is the whole site — the
    whole-site serialisation the delta exists to avoid.
    """
    prev = tmp_path / "layout-prev"
    (prev / "content").mkdir(parents=True)

    assert not base_from_live.base_holds_items(prev)


def test_a_missing_base_directory_is_not_a_base(tmp_path):
    assert not base_from_live.base_holds_items(tmp_path / "nothing-here")


def test_a_base_with_items_is_a_base(tmp_path):
    prev = tmp_path / "layout-prev"
    (prev / "content/aaa").mkdir(parents=True)
    (prev / "content/aaa/data.json").write_text(json.dumps({"@id": "/a"}))

    assert base_from_live.base_holds_items(prev)


def test_items_in_nested_folders_are_kept_on_their_own(tmp_path):
    """A layout may name its folders by path, so `videos/intro/` sits inside
    the `videos/` item. Each is kept or skipped as itself."""
    layout = make_layout(tmp_path, {"videos": "/videos"})
    intro = layout / "content" / "videos" / "intro"
    intro.mkdir()
    (intro / "data.json").write_text(json.dumps({"@id": "/videos/intro"}))
    prev = tmp_path / "layout-prev"

    report = base_from_live.write_base({"videos"}, layout, prev)

    assert report["kept"] == 1
    assert report["candidates"] == ["/videos/intro"]
    assert (prev / "content" / "videos" / "data.json").is_file()
    assert not (prev / "content" / "videos" / "intro").exists()
