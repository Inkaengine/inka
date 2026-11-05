"""The content delta runs against a site directly — no HTTP view in the way.

A zconsole script calls it: on RelStorage zconsole can open the database while
the instance serves, so the public API carries no endpoint that rewrites site
content.
"""

from __future__ import annotations

from inkaengine.inka.content_deploy.delta import DeltaRefused
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
NEW_PAGE = {
    "@id": "/a-new-page",
    "@type": "Document",
    "UID": "0123456789abcdef0123456789abcdef",
    "id": "a-new-page",
    "title": "A new page",
}


def write_layout(where: Path, items: dict[str, dict]) -> Path:
    """A plone.exportimport tree, keyed by dirname like an export's."""
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
def staged(tmp_path):
    layout = write_layout(tmp_path / "layout", {"root": ROOT, "new": NEW_PAGE})
    base = write_layout(tmp_path / "layout-prev", {"root": ROOT})
    return layout, base


def test_refuses_without_a_base(integration, tmp_path):
    layout = write_layout(tmp_path / "layout", {"root": ROOT, "new": NEW_PAGE})
    with pytest.raises(DeltaRefused, match="BASE"):
        run_delta(
            integration["portal"],
            integration["request"],
            layout,
            tmp_path / "layout-prev",
            commit=False,
        )


def test_a_dry_run_reports_the_create_and_writes_nothing(integration, staged):
    portal = integration["portal"]
    layout, base = staged
    report = run_delta(portal, integration["request"], layout, base, commit=False)
    assert report["plan"]["creates"] == ["a-new-page"]
    assert report["apply"]["committed"] is False
    assert "a-new-page" not in portal


def test_a_commit_creates_the_page(functional, staged):
    """Functional: the delta commits for real, as it does under zconsole."""
    portal = functional["portal"]
    layout, base = staged
    with api.env.adopt_roles(["Manager"]):
        report = run_delta(portal, functional["request"], layout, base, commit=True)
    assert report["apply"]["committed"] is True
    assert portal["a-new-page"].title == "A new page"


def test_the_whole_ordering_applies_when_nothing_else_changes(functional, tmp_path):
    """`--metadata-all` is for order that is wrong on pages that are NOT
    changing: they never become candidates, so their positions never ride
    along with a change-set. It returned "nothing to upsert" and applied no
    ordering at all whenever the change-set was empty — which is exactly that
    case (a top-level nav with two items the wrong way round)."""
    portal = functional["portal"]
    with api.env.adopt_roles(["Manager"]):
        second = api.content.create(
            container=portal, type="Document", id="second", title="Second"
        )
        first = api.content.create(
            container=portal, type="Document", id="first", title="First"
        )
    transaction.commit()
    assert portal.getObjectPosition("second") < portal.getObjectPosition("first")

    items = {
        "root": ROOT,
        "second": {
            "@id": "/second",
            "@type": "Document",
            "UID": second.UID(),
            "id": "second",
            "title": "Second",
        },
        "first": {
            "@id": "/first",
            "@type": "Document",
            "UID": first.UID(),
            "id": "first",
            "title": "First",
        },
    }
    layout = write_layout(tmp_path / "layout", items)
    base = write_layout(tmp_path / "layout-prev", items)
    meta = layout / "content" / "__metadata__.json"
    meta.write_text(
        json.dumps({
            **json.loads(meta.read_text()),
            "ordering": {first.UID(): 0, second.UID(): 1},
        })
    )

    with api.env.adopt_roles(["Manager"]):
        report = run_delta(
            portal,
            functional["request"],
            layout,
            base,
            commit=True,
            whole_metadata=True,
        )
    assert report["apply"]["committed"] is True
    assert portal.getObjectPosition("first") < portal.getObjectPosition("second")


def test_a_refreshed_page_is_taken_from_the_layout_over_a_live_edit(
    functional, tmp_path
):
    """A form page was saved in the editor from older data. The layout and the
    base agree, so the delta took the live copy for an editor's edit and left
    it; `refresh` names it."""
    portal = functional["portal"]
    with api.env.adopt_roles(["Manager"]):
        page = api.content.create(
            container=portal, type="Document", id="form", title="An old save"
        )
    transaction.commit()
    converted = {
        "@id": "/form",
        "@type": "Document",
        "UID": page.UID(),
        "id": "form",
        "title": "Converted",
    }
    items = {"root": ROOT, "form": converted}
    layout = write_layout(tmp_path / "layout", items)
    base = write_layout(tmp_path / "layout-prev", items)

    with api.env.adopt_roles(["Manager"]):
        left = run_delta(portal, functional["request"], layout, base, commit=False)
    assert left["plan"]["updates"] == []

    with api.env.adopt_roles(["Manager"]):
        report = run_delta(
            portal, functional["request"], layout, base, commit=True, refresh=["/form"]
        )
    assert report["plan"]["updates"] == ["form"]
    assert report["apply"]["committed"] is True
    assert portal["form"].title == "Converted"


def test_a_page_that_moves_and_changes_gets_its_new_content(functional, tmp_path):
    """A page moved into another folder, and its content changed in the same
    delta. The move was applied and the change was not ("content carried by
    the move"), while the base advanced to the new content: the site kept the
    old page, and every later delta took it for an editor's edit."""
    portal = functional["portal"]
    with api.env.adopt_roles(["Manager"]):
        api.content.create(
            container=portal, type="Document", id="folder", title="Folder"
        )
        api.content.create(container=portal, type="Document", id="page", title="Before")
    transaction.commit()
    # The base as an apply leaves it: what the exporter makes of live (a thinner
    # hand-written one differs from live, which the gate rightly calls an edit).
    with api.env.adopt_roles(["Manager"]):
        live = serialize_live_candidates(
            portal, functional["request"], {}, {}, extra=("folder", "page")
        )
    folder, before = live["folder"], live["page"]
    after = {**before, "@id": "/folder/page", "title": "After"}
    base = write_layout(
        tmp_path / "layout-prev", {"root": ROOT, "folder": folder, "page": before}
    )
    layout = write_layout(
        tmp_path / "layout", {"root": ROOT, "folder": folder, "page": after}
    )

    with api.env.adopt_roles(["Manager"]):
        report = run_delta(portal, functional["request"], layout, base, commit=True)
    assert report["apply"]["committed"] is True, report["apply"]
    assert "page" not in portal
    assert portal["folder"]["page"].title == "After"

    # The next layout changes it again, against the base this apply left
    # (the layout): an update, not a live edit to refuse.
    later = write_layout(
        tmp_path / "later",
        {"root": ROOT, "folder": folder, "page": {**after, "title": "Later"}},
    )
    with api.env.adopt_roles(["Manager"]):
        again = run_delta(portal, functional["request"], later, layout, commit=True)
    assert again["clobber_warnings"] == []
    assert again["apply"]["committed"] is True
    assert portal["folder"]["page"].title == "Later"


def test_a_page_that_moves_into_a_new_folder_and_changes_is_refused(
    functional, tmp_path
):
    """The update has to land on the moved page, and the page can only move
    once the upserts have created its folder: imported first at its new path,
    it would be a second object with the same UID. Refused, nothing written."""
    portal = functional["portal"]
    with api.env.adopt_roles(["Manager"]):
        api.content.create(container=portal, type="Document", id="page", title="Before")
    transaction.commit()
    with api.env.adopt_roles(["Manager"]):
        live = serialize_live_candidates(
            portal, functional["request"], {}, {}, extra=("page",)
        )
    before = live["page"]
    folder = {
        "@id": "/new-folder",
        "@type": "Document",
        "UID": "f" * 32,
        "id": "new-folder",
        "title": "New",
    }
    after = {**before, "@id": "/new-folder/page", "title": "After"}
    base = write_layout(tmp_path / "layout-prev", {"root": ROOT, "page": before})
    layout = write_layout(
        tmp_path / "layout", {"root": ROOT, "folder": folder, "page": after}
    )

    with (
        api.env.adopt_roles(["Manager"]),
        pytest.raises(LookupError, match="which this delta creates"),
    ):
        run_delta(portal, functional["request"], layout, base, commit=True)
    transaction.abort()
    assert portal["page"].title == "Before"
    assert "new-folder" not in portal
