"""A site deployed from a layout keeps the base it was classified against.

Deleting the site and importing the layout again on every deploy leaves no
site at all while the import runs: every request in that window is a 404.
The incremental apply changes only what the layout changed, in one
transaction, but it needs the base — what the site holds now. The site keeps
it, written in the same transaction as the apply, so the two cannot drift.
"""

from __future__ import annotations

from inkaengine.inka.content_deploy.delta import DeltaRefused
from inkaengine.inka.content_deploy.delta import serialize_live_candidates
from inkaengine.inka.content_deploy.stored_base import deploy_content
from inkaengine.inka.content_deploy.stored_base import has_base
from inkaengine.inka.content_deploy.stored_base import record_base
from pathlib import Path
from plone import api

import json
import pytest
import transaction


ROOT = {
    "@id": "/plone",
    "@type": "Plone Site",
    "UID": "",
    "id": "plone",
    "title": "Site",
}


ADDED = {
    "@id": "/added",
    "@type": "Document",
    "UID": "d" * 32,
    "id": "added",
    "title": "Added",
}


def write_layout(where: Path, items: dict[str, dict]) -> Path:
    content = where / "content"
    content.mkdir(parents=True)
    for dirname, data in items.items():
        (content / dirname).mkdir()
        (content / dirname / "data.json").write_text(json.dumps(data))
    (content / "__metadata__.json").write_text(
        json.dumps({"_data_files_": [f"{d}/data.json" for d in items]})
    )
    (where / "redirects.json").write_text("{}")
    return where


@pytest.fixture
def deployed(functional, tmp_path):
    """A site imported in full from the first layout, its base recorded.

    The layout is what the exporter makes of the site, as a real one is: a
    thinner hand-written item differs from live in fields like `parent`, and
    the apply rightly takes that for an editor's edit.
    """
    portal, request = functional["portal"], functional["request"]
    with api.env.adopt_roles(["Manager"]):
        for name, title in (
            ("kept", "Kept"),
            ("changed", "Before"),
            ("removed", "Gone"),
        ):
            api.content.create(container=portal, type="Document", id=name, title=title)
        transaction.commit()
        items = serialize_live_candidates(
            portal, request, {}, {}, extra=("kept", "changed", "removed")
        )
        first = write_layout(tmp_path / "first", {"root": ROOT, **items})
        record_base(portal, first)
    transaction.commit()
    return portal, request, first, items


def second_layout(tmp_path: Path, items: dict[str, dict]) -> Path:
    """The first layout with one page changed, one removed and one added."""
    return write_layout(
        tmp_path / "second",
        {
            "root": ROOT,
            "kept": items["kept"],
            "changed": {**items["changed"], "title": "After"},
            "added": ADDED,
        },
    )


def test_a_site_with_no_base_is_refused(functional, tmp_path):
    layout = write_layout(tmp_path / "layout", {"root": ROOT, "added": ADDED})
    assert not has_base(functional["portal"])
    with pytest.raises(DeltaRefused, match="no base"):
        deploy_content(functional["portal"], functional["request"], layout, commit=True)


def test_a_deploy_applies_only_what_the_layout_changed(deployed, tmp_path):
    portal, request, _, items = deployed
    kept_before = portal["kept"]._p_serial
    with api.env.adopt_roles(["Manager"]):
        report = deploy_content(
            portal, request, second_layout(tmp_path, items), commit=True
        )
    assert report["apply"]["committed"] is True, report["apply"]
    assert report["plan"]["creates"] == ["added"]
    assert report["plan"]["updates"] == ["changed"]
    assert report["plan"]["deletes"] == ["removed"]
    assert portal["added"].title == "Added"
    assert portal["changed"].title == "After"
    assert "removed" not in portal
    assert portal["kept"]._p_serial == kept_before


def test_the_next_deploy_is_classified_against_what_was_applied(deployed, tmp_path):
    portal, request, _, items = deployed
    second = second_layout(tmp_path, items)
    with api.env.adopt_roles(["Manager"]):
        deploy_content(portal, request, second, commit=True)
        again = deploy_content(portal, request, second, commit=False)
    plan = again["plan"]
    assert (plan["creates"], plan["updates"], plan["deletes"]) == ([], [], [])


def test_a_dry_run_leaves_the_base_and_the_site_as_they_were(deployed, tmp_path):
    portal, request, first, items = deployed
    with api.env.adopt_roles(["Manager"]):
        dry = deploy_content(
            portal, request, second_layout(tmp_path, items), commit=False
        )
    assert dry["apply"]["committed"] is False
    assert "added" not in portal
    assert portal["changed"].title == "Before"
    with api.env.adopt_roles(["Manager"]):
        again = deploy_content(portal, request, first, commit=False)
    plan = again["plan"]
    assert (plan["creates"], plan["updates"], plan["deletes"]) == ([], [], [])


def test_a_refused_deploy_keeps_the_base_it_had(deployed, tmp_path):
    """An editor changed the page this deploy would overwrite: the apply
    refuses, and the base still describes what the site holds."""
    portal, request, first, items = deployed
    portal["changed"].title = "Edited on the site"
    transaction.commit()
    with api.env.adopt_roles(["Manager"]):
        refused = deploy_content(
            portal, request, second_layout(tmp_path, items), commit=True
        )
    assert refused["apply"]["committed"] is False
    assert refused["apply"]["must_merge"] == ["changed"]
    assert portal["changed"].title == "Edited on the site"
    with api.env.adopt_roles(["Manager"]):
        again = deploy_content(portal, request, first, commit=False)
    assert again["plan"]["creates"] == []
    assert again["plan"]["deletes"] == []
