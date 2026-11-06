"""A page's search text: top-level blocks in page order, and each block's
`searchableText` is the whole of it (the editor writes it from the block's subtree).
"""

from plone import api
from plone.app.dexterity.textindexer import IDynamicTextIndexExtender
from plone.restapi.behaviors import IBlocks
from zope.component import getAdapter
from zope.interface import alsoProvides

import pytest


def slate(text):
    return {"@type": "slate", "plaintext": text}


def indexed(portal, blocks, layout):
    with api.env.adopt_roles(["Manager"]):
        page = api.content.create(
            container=portal,
            type="Document",
            id="page",
            title="Title",
        )
    alsoProvides(page, IBlocks)
    page.blocks = blocks
    page.blocks_layout = layout
    # As the catalog finds it, so this is the registered override and not restapi's.
    return getAdapter(page, IDynamicTextIndexExtender, name="IBlocks")()


@pytest.fixture
def portal(integration):
    return integration["portal"]


def test_top_level_blocks_are_in_layout_order(portal):
    text = indexed(
        portal,
        {
            "second": {"@type": "card", "searchableText": "SECOND"},
            "first": {"@type": "card", "searchableText": "FIRST"},
        },
        {"items": ["first", "second"]},
    )
    assert text.index("FIRST") < text.index("SECOND")


def test_every_region_is_walked(portal):
    text = indexed(
        portal,
        {"a": {"@type": "card", "searchableText": "MAINTEXT"}, "b": {"@type": "card", "searchableText": "FOOTERTEXT"}},
        {"items": ["a"], "footer": ["b"]},
    )
    assert "MAINTEXT" in text
    assert "FOOTERTEXT" in text


def test_a_block_no_region_lists_is_not_indexed(portal):
    text = indexed(
        portal,
        {"a": {"@type": "card", "searchableText": "LISTED"}, "b": {"@type": "card", "searchableText": "HIDDEN"}},
        {"items": ["a"]},
    )
    assert "LISTED" in text
    assert "HIDDEN" not in text


def test_it_stops_at_a_block_with_searchable_text(portal):
    text = indexed(
        portal,
        {
            "s": {
                "@type": "gridBlock",
                "searchableText": "WHOLE",
                "blocks": {"c": slate("NESTED")},
                "blocks_layout": {"items": ["c"]},
            }
        },
        {"items": ["s"]},
    )
    assert "WHOLE" in text
    assert "NESTED" not in text


def test_a_block_without_it_is_read_as_before(portal):
    """Content not yet saved with search text keeps what restapi found in it."""
    text = indexed(
        portal,
        {
            "s": {
                "@type": "gridBlock",
                "blocks": {"c": slate("NESTED")},
                "blocks_layout": {"items": ["c"]},
            }
        },
        {"items": ["s"]},
    )
    assert "NESTED" in text
