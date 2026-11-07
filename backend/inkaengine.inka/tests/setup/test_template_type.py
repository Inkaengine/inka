"""The Template content type: a page that other pages take blocks from.

It is a Document in every way but its name, so a site can tell templates apart: leave them
out of search and the sitemap, and have its front end mark them noindex. Templates can be
saved in any folder, so nothing here is tied to one.
"""

from inkaengine.inka.upgrades import templates_become_template_type
from plone import api
from plone.app.testing import setRoles
from plone.app.testing import TEST_USER_ID
from plone.restapi.search.handler import SearchHandler

import pytest


@pytest.fixture
def manager_portal(portal):
    setRoles(portal, TEST_USER_ID, ["Manager"])
    return portal


class TestTemplateType:
    def test_is_a_copy_of_document(self, portal):
        types = portal.portal_types
        template, document = types["Template"], types["Document"]
        assert template.klass == document.klass
        assert list(template.behaviors) == list(document.behaviors)
        assert template.schema == document.schema
        assert template.model_source == document.model_source
        assert template.global_allow is True
        assert template.factory == "Template"
        assert "Template" in template.add_view_expr
        assert template.title == "Template"

    def test_left_out_of_site_search(self, portal):
        assert "Template" in api.portal.get_registry_record("plone.types_not_searched")

    def test_versioned_like_document(self, portal):
        repo = portal.portal_repository
        assert "Template" in repo.getVersionableContentTypes()
        assert repo.getPolicyMap().get("Template") == repo.getPolicyMap().get(
            "Document"
        )

    def test_can_be_added_in_any_folder(self, manager_portal):
        folder = api.content.create(manager_portal, "Document", id="anywhere")
        at_root = api.content.create(manager_portal, "Template", id="footer")
        in_folder = api.content.create(folder, "Template", id="sidebar")
        assert at_root.portal_type == in_folder.portal_type == "Template"

    def test_site_search_settings_skip_templates(self, manager_portal):
        api.content.create(
            manager_portal, "Template", id="footer", title="Shared words"
        )
        api.content.create(manager_portal, "Document", id="page", title="Shared words")
        api.content.transition(manager_portal["footer"], "publish")
        api.content.transition(manager_portal["page"], "publish")
        request = manager_portal.REQUEST
        found = SearchHandler(manager_portal, request).search({
            "SearchableText": "Shared",
            "use_site_search_settings": 1,
        })
        assert [item["@id"].rsplit("/", 1)[-1] for item in found["items"]] == ["page"]


class TestExistingTemplatesBecomeTemplates:
    """A site made before the type has its templates as Documents. The upgrade finds them
    by what pages reference, wherever they are saved, and leaves every other page alone."""

    def test_referenced_documents_become_templates(self, manager_portal):
        folder = api.content.create(manager_portal, "Document", id="shared")
        footer = api.content.create(folder, "Document", id="footer")
        nested = api.content.create(manager_portal, "Document", id="nested")
        uid_ref = api.content.create(manager_portal, "Document", id="by-uid")
        plain = api.content.create(manager_portal, "Document", id="plain")
        footer.blocks = {"n": {"@type": "slate", "templateId": "/nested"}}
        page = api.content.create(manager_portal, "Document", id="page")
        page.blocks = {
            "a": {"@type": "slate", "templateId": "/shared/footer"},
            "b": {
                "@type": "gridBlock",
                "blocks": {
                    "c": {
                        "@type": "slate",
                        "templateId": f"../resolveuid/{uid_ref.UID()}",
                    },
                },
            },
        }

        changed = templates_become_template_type(manager_portal)

        assert sorted(changed) == ["/by-uid", "/nested", "/shared/footer"]
        for obj in (footer, nested, uid_ref):
            assert obj.portal_type == "Template"
        assert plain.portal_type == page.portal_type == "Document"
        catalog = manager_portal.portal_catalog
        assert {b.getId for b in catalog(portal_type="Template")} == {
            "footer",
            "nested",
            "by-uid",
        }

    def test_a_missing_template_fails_loudly(self, manager_portal):
        page = api.content.create(manager_portal, "Document", id="page")
        page.blocks = {"a": {"@type": "slate", "templateId": "/gone"}}
        with pytest.raises(LookupError, match="/gone"):
            templates_become_template_type(manager_portal)
