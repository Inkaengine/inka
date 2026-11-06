"""What the editor writes as `searchableText` makes a page findable, on a stock Plone.

Real Plone, real plone.restapi and its own indexer: no addon code is involved. The page
goes through the JS function the editor runs on save (by way of the `plone-content`
command imports use), then in through the REST API, and is searched for in the catalog.
"""

from pathlib import Path
from plone import api

import json
import os
import pytest
import shutil
import subprocess
import transaction


CLI = Path(__file__).resolve().parents[4] / "bin" / "plone-content.cjs"

SCHEMAS = {
    "card": {
        "id": "card",
        "blockSchema": {
            "properties": {
                "title": {"type": "string"},
                "href": {"widget": "url"},
            }
        },
    },
    "section": {
        "id": "section",
        "blockSchema": {
            "properties": {
                "heading": {"type": "string"},
                "items": {"widget": "blocks_layout"},
            }
        },
    },
    "panels": {
        "id": "panels",
        "blockSchema": {
            "properties": {
                "data": {
                    "widget": "object",
                    "schema": {"properties": {"items": {"widget": "blocks_layout"}}},
                }
            }
        },
    },
    "grid": {
        "id": "grid",
        "blockSchema": {
            "properties": {
                "table": {
                    "widget": "object",
                    "schema": {
                        "properties": {
                            "rows": {
                                "widget": "object_list",
                                "idField": "key",
                                "schema": {"properties": {"label": {"type": "string"}}},
                            }
                        }
                    },
                }
            }
        },
    },
}


def slate(text: str) -> dict:
    return {"@type": "slate", "value": [{"type": "p", "children": [{"text": text}]}], "plaintext": text}


PAGE = {
    "@type": "Document",
    "id": "searched",
    "title": "Searched",
    "blocks": {
        "c": {"@type": "card", "title": "Cardword", "href": "https://example.com/Linkword"},
        "s": {
            "@type": "section",
            "heading": "Headingword",
            "blocks": {"n": slate("Nestedword")},
            "blocks_layout": {"items": ["n"]},
        },
        "p": {
            "@type": "panels",
            "data": {
                "blocks": {"i": {"@type": "card", "title": "Panelword"}},
                "blocks_layout": {"items": ["i"]},
            },
        },
        "g": {"@type": "grid", "table": {"rows": [{"key": "r", "label": "Rowword"}]}},
        "t": {
            "@type": "card",
            "title": "Sharedword",
            "templateId": "/t",
            "fixed": True,
            "readOnly": True,
        },
    },
    "blocks_layout": {"items": ["c", "s", "p", "g", "t"]},
}


def with_search_text(page: dict, tmp_path: Path) -> dict:
    if shutil.which("node") is None or not CLI.exists():
        if os.environ.get("CI"):
            raise FileNotFoundError("node or the inka checkout is missing")
        pytest.skip("needs node and the inka checkout")
    (tmp_path / "content" / "page").mkdir(parents=True)
    data = tmp_path / "content" / "page" / "data.json"
    data.write_text(json.dumps(page))
    schemas = tmp_path / "schemas.json"
    schemas.write_text(json.dumps(SCHEMAS))
    subprocess.run(
        ["node", str(CLI), "search-text", str(tmp_path / "content"), "--schemas", str(schemas)],
        check=True,
    )
    return json.loads(data.read_text())


@pytest.fixture
def blocks_page(portal, api_session, tmp_path):
    fti = portal.portal_types.Document
    fti.behaviors = (*fti.behaviors, "volto.blocks")
    transaction.commit()
    response = api_session.post("/", json=with_search_text(PAGE, tmp_path))
    assert response.status_code == 201, response.text
    transaction.commit()
    yield
    fti.behaviors = tuple(b for b in fti.behaviors if b != "volto.blocks")
    transaction.commit()


def found(word: str) -> list[str]:
    return [brain.getId for brain in api.content.find(SearchableText=word)]


@pytest.mark.parametrize(
    "word",
    ["Cardword", "Headingword", "Nestedword", "Panelword", "Rowword"],
)
def test_a_page_is_found_by_the_text_of_each_block(blocks_page, word):
    assert found(word) == ["searched"]


@pytest.mark.parametrize("word", ["Linkword", "Sharedword"])
def test_it_is_not_found_by_links_or_a_template_s_blocks(blocks_page, word):
    assert found(word) == []


def test_each_text_is_indexed_once(blocks_page, portal):
    brain = api.content.find(id="searched")[0]
    words = portal.portal_catalog.getIndexDataForRID(brain.getRID())["SearchableText"]
    assert words.count("nestedword") == 1
