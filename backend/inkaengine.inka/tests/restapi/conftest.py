"""Fixtures for the @templates tests.

Content comes from the SAME templates the JS side tests against, imported as a
`plone.exportimport` distribution rather than hand-built in Python. Hand-built Python
content would be a second, drifting definition of what a template looks like; importing
the shared fixtures means both suites assert against one set.

The distribution is GENERATED at test time (see `tests/distribution_fixture.py`), not
committed: the fixtures live in the inka repo as markdown and are decoded by the mock API,
so a committed export would be a copy that silently goes stale when the markdown changes.
It needs `node` and the inka checkout — without either, these tests skip.
"""

from pathlib import Path
from plone import api
from plone.app.testing import setRoles
from plone.app.testing import TEST_USER_ID
from plone.exportimport.importers import get_importer

import importlib.util
import pytest
import sys
import transaction


def _load_distribution_fixture():
    """Import tests/distribution_fixture.py by path.

    `tests/` is deliberately not a package in this scaffold (no __init__.py), so a
    relative import is unavailable — load the sibling module directly instead of
    restructuring the test tree around one helper.
    """
    if "distribution_fixture" in sys.modules:
        return sys.modules["distribution_fixture"]
    path = Path(__file__).resolve().parent.parent / "distribution_fixture.py"
    spec = importlib.util.spec_from_file_location("distribution_fixture", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["distribution_fixture"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def distribution(tmp_path_factory):
    """The shared template fixtures, exported once per test session.

    Session-scoped because generating it boots a node server and scans content — far too
    slow to repeat per test. Skips (rather than fails) when the inka checkout or node is
    absent, so the addon can still be worked on without the JS repo.
    """
    try:
        build = _load_distribution_fixture().build_distribution
        return build(tmp_path_factory.mktemp("distribution"))
    except FileNotFoundError as exc:
        pytest.skip(f"shared template fixtures unavailable: {exc}")


@pytest.fixture
def portal(functional_portal):
    """The FUNCTIONAL portal.

    Every test here drives the endpoint over HTTP, so content must exist in the functional
    layer — content written to the integration portal is invisible to the request session,
    and the mismatch surfaces as a confusing TestIsolationBroken rather than as "your
    fixture used the wrong layer".
    """
    setRoles(functional_portal, TEST_USER_ID, ["Manager"])
    return functional_portal


@pytest.fixture
def templates(portal, distribution):
    """The shared template fixtures, imported into the portal.

    Returns the `/templates` folder. Individual templates are reached by id, e.g.
    `templates["site-footer"]`.
    """
    importer = get_importer(portal)
    importer.import_site(distribution)
    transaction.commit()
    return portal["templates"]


@pytest.fixture
def site_footer(templates):
    """A layout whose blocks are all fixed — the branded-footer case."""
    return templates["site-footer"]


@pytest.fixture
def event_view(templates):
    """A layout mixing fixed blocks with an editable slot."""
    return templates["event-view"]


@pytest.fixture
def page_using_template(portal, site_footer):
    """A page whose blocks reference a template by `resolveuid/<uid>`.

    The uid spelling is deliberate: it is what the admin writes into stored content, and
    the case most likely to break, since resolving it requires the catalog.
    """
    uid = site_footer.UID()
    page = api.content.create(
        container=portal, type="Document", id="a-page", title="A Page"
    )
    page.blocks = {
        "user-block": {
            "@type": "slate",
            "templateId": f"resolveuid/{uid}",
            "slotId": "default",
            "value": [{"type": "p", "children": [{"text": "User content"}]}],
        }
    }
    page.blocks_layout = {"items": ["user-block"]}
    transaction.commit()
    return page


@pytest.fixture
def plain_page(portal):
    """A page with no template references at all."""
    page = api.content.create(
        container=portal, type="Document", id="plain", title="Plain"
    )
    transaction.commit()
    return page


@pytest.fixture
def api_session(request_factory):
    """An authenticated REST API session (pytest-plone closes it for us)."""
    return request_factory(role="Manager")
