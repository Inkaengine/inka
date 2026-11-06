"""A page's search text, from its blocks.

plone.restapi walks the `blocks` dict, children before their container, and indexes every
block it finds. An editor that writes `searchableText` on a top-level block has already
given the text of its whole subtree, in order, so here the page's layout gives the order and
that field ends the walk. A block without it is read as restapi reads it.
"""

from plone.app.dexterity import textindexer
from plone.restapi.behaviors import IBlocks
from plone.restapi.blocks import visit_blocks
from plone.restapi.indexers import extract_text
from plone.restapi.indexers import text_strip
from typing import Iterator
from zope.component import adapter
from zope.globalrequest import getRequest
from zope.interface import implementer


def _listed_blocks(obj) -> Iterator[dict]:
    """The page's top-level blocks, region by region, in layout order."""
    blocks = obj.blocks or {}
    for ids in (obj.blocks_layout or {}).values():
        for block_id in ids:
            if block_id in blocks:
                yield blocks[block_id]


def blocks_text(obj) -> list[str]:
    request = getRequest()
    texts = []
    for block in _listed_blocks(obj):
        if block.get("searchableText"):
            texts.append(block["searchableText"])
            continue
        for visited in visit_blocks(obj, {"block": block}):
            texts.append(extract_text(visited, obj, request))
    return texts


@implementer(textindexer.IDynamicTextIndexExtender)
@adapter(IBlocks)
class BlocksSearchableTextExtender:
    def __init__(self, context):
        self.context = context

    def __call__(self) -> str:
        return text_strip(blocks_text(self.context))
