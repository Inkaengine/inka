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


INKA = Path(__file__).resolve().parents[4]
CLI = INKA / "bin" / "plone-content.cjs"
# The mock API is held to the same cases (mock-searchable-text.test.cjs).
CASES = json.loads((INKA / "tests-playwright/fixtures/search-text-cases.json").read_text())


def with_search_text(page: dict, tmp_path: Path) -> dict:
    if shutil.which("node") is None or not CLI.exists():
        if os.environ.get("CI"):
            raise FileNotFoundError("node or the inka checkout is missing")
        pytest.skip("needs node and the inka checkout")
    (tmp_path / "content" / "page").mkdir(parents=True)
    data = tmp_path / "content" / "page" / "data.json"
    data.write_text(json.dumps(page))
    schemas = tmp_path / "schemas.json"
    schemas.write_text(json.dumps(CASES["schemas"]))
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
    response = api_session.post("/", json=with_search_text(CASES["page"], tmp_path))
    assert response.status_code == 201, response.text
    transaction.commit()
    yield
    fti.behaviors = tuple(b for b in fti.behaviors if b != "volto.blocks")
    transaction.commit()


def found(word: str) -> list[str]:
    return [brain.getId for brain in api.content.find(SearchableText=word)]


@pytest.mark.parametrize("word", CASES["found"])
def test_a_page_is_found_by_the_text_of_each_block(blocks_page, word):
    assert found(word) == ["searched"]


@pytest.mark.parametrize("word", CASES["notFound"])
def test_it_is_not_found_by_links_or_a_template_s_blocks(blocks_page, word):
    assert found(word) == []


def test_each_text_is_indexed_once(blocks_page, portal):
    brain = api.content.find(id="searched")[0]
    words = portal.portal_catalog.getIndexDataForRID(brain.getRID())["SearchableText"]
    assert words.count("nestedword") == 1
