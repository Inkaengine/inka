"""A change of state alone is a transition, not a re-import.

A layout that starts declaring its files' states differs from its base in
nothing else. Re-importing each one reindexed its whole text, a PDF's included,
and a deploy over a few hundred files ran out of time.
"""

from inkaengine.inka.content_deploy.apply import apply_changeset
from inkaengine.inka.content_deploy.apply import apply_review_states
from inkaengine.inka.content_deploy.changeset import ChangeSet
from plone import api

import json
import pytest


def test_a_state_change_transitions_without_importing(integration, tmp_path):
    portal = integration["portal"]
    with api.env.adopt_roles(["Manager"]):
        page = api.content.create(
            container=portal, type="Document", id="report", title="On the site"
        )
        assert api.content.get_state(obj=page) == "private"
        item = tmp_path / "content" / "report"
        item.mkdir(parents=True)
        (item / "data.json").write_text(
            json.dumps({
                "@id": "/report",
                "@type": "Document",
                "id": "report",
                "title": "In the layout",
                "review_state": "published",
            })
        )
        report = apply_changeset(
            portal,
            ChangeSet(states=["report"]),
            tmp_path / "content",
            dry_run=True,
            with_relations=False,
        )
    assert report["review_state"] == ["report: private -> published"]
    assert report["upsert"]["items"] == []


def test_a_state_change_leaves_the_item_s_content_alone(integration, tmp_path):
    portal = integration["portal"]
    with api.env.adopt_roles(["Manager"]):
        page = api.content.create(
            container=portal, type="Document", id="report", title="On the site"
        )
        item = tmp_path / "content" / "report"
        item.mkdir(parents=True)
        (item / "data.json").write_text(
            json.dumps({
                "@id": "/report",
                "@type": "Document",
                "id": "report",
                "title": "In the layout",
                "review_state": "published",
            })
        )
        report = {}
        apply_review_states(
            portal, ChangeSet(states=["report"]), tmp_path / "content", report
        )
        assert api.content.get_state(obj=page) == "published"
        assert page.title == "On the site"
    assert report["review_state"] == ["report: private -> published"]


def test_a_state_change_for_an_item_the_site_lacks_fails(integration, tmp_path):
    portal = integration["portal"]
    item = tmp_path / "content" / "gone"
    item.mkdir(parents=True)
    (item / "data.json").write_text(json.dumps({"review_state": "published"}))
    with api.env.adopt_roles(["Manager"]), pytest.raises(LookupError, match="gone"):
        apply_review_states(
            portal, ChangeSet(states=["gone"]), tmp_path / "content", {}
        )
