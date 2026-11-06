"""A renamed item keeps its place in its folder.

A delta renamed a file from `….pdf` to the same id without `.pdf`. Its folder
lists items in folder order, 25 to a page: the renamed item went from 21st to
last, and dropped off page 1.

`plone.api.content.move` renames in place only when `source.aq_parent is
target`, an identity test on acquisition wrappers. `apply_moves` traverses to
the target itself, so the wrapper is never the same one, and every rename was a
cut and paste to the end of the folder.
"""

from inkaengine.inka.content_deploy.apply import apply_moves
from inkaengine.inka.content_deploy.changeset import ChangeSet
from plone import api


def test_a_rename_in_place_keeps_the_item_s_position(integration):
    portal = integration["portal"]
    with api.env.adopt_roles(["Manager"]):
        folder = api.content.create(
            container=portal, type="Document", id="files", title="Files"
        )
        for name in ("first", "renamed.pdf", "last"):
            api.content.create(container=folder, type="Document", id=name, title=name)
        report = {}
        apply_moves(
            portal,
            ChangeSet(
                moves=[{"src": "files/renamed.pdf", "dst": "files/renamed", "uid": ""}]
            ),
            report,
        )
    assert report["move"] == ["files/renamed.pdf -> files/renamed"]
    assert list(folder.objectIds()) == ["first", "renamed", "last"]
