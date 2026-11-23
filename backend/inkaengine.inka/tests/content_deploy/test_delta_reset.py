"""`reset`: the layout wins everywhere.

A delta applies only what the layout changed since the base, so what an editor
does on the site outside that survives every deploy: a page they make is in
neither the base nor the layout, and a page they change that the layout didn't
change is left as an editor's edit. A site that is only a copy of its layout
(one being tested before it goes live, say) wants those gone, so the next
comparison sees the layout. `reset` deletes what the site holds that the layout
lacks, re-creates what the layout has that the site lost, and takes back from
the layout every page changed on the site since the last committed apply.
"""

from __future__ import annotations

from DateTime import DateTime
from inkaengine.inka.content_deploy.delta import DeltaRefused
from inkaengine.inka.content_deploy.delta import last_applied
from inkaengine.inka.content_deploy.delta import run_delta
from inkaengine.inka.content_deploy.delta import serialize_live_candidates
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
    (where / "site-settings.json").write_text("{}")
    return where


@pytest.fixture
def converted(functional, tmp_path):
    """A site holding one converted page, `page`, deployed: the layout and the
    base are what the exporter makes of it, and an apply has been recorded."""
    portal = functional["portal"]
    request = functional["request"]
    with api.env.adopt_roles(["Manager"]):
        api.content.create(
            container=portal, type="Document", id="page", title="Converted"
        )
    transaction.commit()
    with api.env.adopt_roles(["Manager"]):
        live = serialize_live_candidates(portal, request, {}, {}, extra=("page",))
    items = {"plone_site_root": ROOT, "page": live["page"]}
    layout = write_layout(tmp_path / "layout", items)
    base = write_layout(tmp_path / "layout-prev", items)
    with api.env.adopt_roles(["Manager"]):
        first = run_delta(portal, request, layout, base, commit=True)
    assert first["apply"]["committed"] is True, first["apply"]
    return portal, request, layout, base


def reset(portal, request, layout, base, **kwargs):
    with api.env.adopt_roles(["Manager"]):
        return run_delta(portal, request, layout, base, reset=True, **kwargs)


def test_a_committed_apply_records_when(converted):
    portal, *_ = converted
    assert last_applied(portal) is not None


def test_a_page_made_on_the_site_is_deleted(converted):
    portal, request, layout, base = converted
    with api.env.adopt_roles(["Manager"]):
        api.content.create(
            container=portal, type="Document", id="made-here", title="A test"
        )
    transaction.commit()

    with api.env.adopt_roles(["Manager"]):
        kept = run_delta(portal, request, layout, base, commit=False)
    assert kept["plan"]["deletes"] == [], "without reset, a delta leaves it"

    report = reset(portal, request, layout, base, commit=True)
    assert report["reset"]["site_only"] == ["made-here"]
    assert report["apply"]["committed"] is True, report["apply"]
    assert "made-here" not in portal
    assert portal["page"].title == "Converted"


def test_only_the_topmost_of_what_the_site_made_is_deleted(converted):
    """Deleting a folder takes what is in it; naming both would delete the
    child twice."""
    portal, request, layout, base = converted
    with api.env.adopt_roles(["Manager"]):
        folder = api.content.create(
            container=portal, type="Document", id="made-here", title="A test"
        )
        api.content.create(container=folder, type="Document", id="inside", title="In")
    transaction.commit()

    report = reset(portal, request, layout, base, commit=True)
    assert report["reset"]["site_only"] == ["made-here"]
    assert "made-here" not in portal


def test_a_page_changed_on_the_site_is_taken_back_from_the_layout(converted):
    portal, request, layout, base = converted
    page = portal["page"]
    page.title = "Changed on the site"
    page.setModificationDate(DateTime())
    page.reindexObject()
    transaction.commit()

    with api.env.adopt_roles(["Manager"]):
        left = run_delta(portal, request, layout, base, commit=False)
    assert left["plan"]["updates"] == [], "without reset, it is an editor's edit"

    report = reset(portal, request, layout, base, commit=True)
    assert report["reset"]["changed_on_site"] == ["page"]
    assert report["apply"]["committed"] is True, report["apply"]
    assert portal["page"].title == "Converted"


def test_a_page_deleted_on_the_site_is_made_again(converted):
    portal, request, layout, base = converted
    with api.env.adopt_roles(["Manager"]):
        api.content.delete(obj=portal["page"], check_linkintegrity=False)
    transaction.commit()

    report = reset(portal, request, layout, base, commit=True)
    assert report["reset"]["missing"] == ["page"]
    assert report["apply"]["committed"] is True, report["apply"]
    assert portal["page"].title == "Converted"


def test_a_reset_with_nothing_to_undo_changes_nothing(converted):
    portal, request, layout, base = converted
    report = reset(portal, request, layout, base, commit=False)
    assert report["reset"] == {
        "since": report["reset"]["since"],
        "site_only": [],
        "changed_on_site": [],
        "missing": [],
    }
    assert report["plan"]["creates"] == []
    assert report["plan"]["updates"] == []
    assert report["plan"]["deletes"] == []


def test_a_reset_needs_to_know_when_the_site_was_last_applied(functional, tmp_path):
    """Without the time of the last committed apply, a reset cannot tell an
    editor's change from what the apply wrote. Refused, unless the caller says
    from when (`changed_since`)."""
    portal = functional["portal"]
    request = functional["request"]
    items = {"plone_site_root": ROOT}
    layout = write_layout(tmp_path / "layout", items)
    base = write_layout(tmp_path / "layout-prev", items)
    with api.env.adopt_roles(["Manager"]):
        api.content.create(container=portal, type="Document", id="x", title="X")
    transaction.commit()

    with pytest.raises(DeltaRefused, match="changed_since"):
        reset(portal, request, layout, base, commit=False)

    report = reset(
        portal, request, layout, base, commit=False, changed_since=DateTime() - 1
    )
    assert report["reset"]["site_only"] == ["x"]
