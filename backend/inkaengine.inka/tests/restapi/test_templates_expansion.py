"""The @templates endpoint: every template a page needs, resolved in one request.

The contract is not invented here — it was settled on the JS side first, where the mock
API let the shape be tried against the real merge before any Python existed:

    tests-playwright/fixtures/mock-plone-api.cjs                  reference implementation
    tests-playwright/fixtures/templates-component.test.cjs        response shape
    tests-playwright/fixtures/templates-component-merge.test.cjs  the merge consuming it
    tests-playwright/conformance/rest-api.spec.ts                 diff against real Plone

These tests restate that contract in Python, against the SAME template fixtures (imported
as a plone.exportimport distribution — see conftest.py). Three rules carry the weight:

1. Templates are keyed by EVERY spelling that reached them. The merge looks a template up
   by the literal string the block carries, so a block carrying `resolveuid/<uid>` must
   find an entry at `resolveuid/<uid>` — not at the path it resolved to. Get this wrong
   and the JSON is still well-formed while the page renders blank.
2. `expand.templates.extra` resolves forced layouts. A forced layout is never referenced
   from page content, which is exactly why frontends had to pre-load it by hand. The
   FRONTEND owns the layout rules and names the layouts; the backend answers only
   "resolve these and everything they reference". No allowedTemplates/allowedLayouts
   policy crosses the wire.
3. A missing template is NAMED, not raised. One unresolvable id must not fail the page
   read; it appears in `errors` and everything that did resolve still arrives.
"""


class TestTemplatesComponent:
    """The component as reached via ?expand=templates on a content GET."""

    def test_unexpanded_is_an_id_stub(self, api_session, page_using_template):
        """Resolving walks the page's references and reads each template, so an
        unexpanded read must not pay for it — while still emitting the stub, so a client
        that follows it reaches the same data."""
        response = api_session.get("/a-page")
        assert response.status_code == 200
        components = response.json()["@components"]
        assert list(components["templates"].keys()) == ["@id"]
        assert components["templates"]["@id"].endswith("/a-page/@templates")

    def test_expand_returns_the_contract_keys(self, api_session, page_using_template):
        response = api_session.get("/a-page?expand=templates")
        assert response.status_code == 200
        templates = response.json()["@components"]["templates"]
        assert set(templates) >= {"@id", "templates", "idFieldMap"}

    def test_resolves_the_template_the_page_references(
        self, api_session, page_using_template, site_footer
    ):
        response = api_session.get("/a-page?expand=templates")
        templates = response.json()["@components"]["templates"]["templates"]
        key = f"resolveuid/{site_footer.UID()}"
        assert key in templates, (
            "the template must be keyed by the spelling the block carries, "
            "or the merge cannot look it up"
        )
        assert "blocks" in templates[key]
        assert "blocks_layout" in templates[key]

    def test_template_arrives_with_its_slot_metadata(
        self, api_session, page_using_template, site_footer
    ):
        """The merge reads `slotId` / `fixed` off each template block to decide what is
        locked and where page content goes. They must survive serialization."""
        response = api_session.get("/a-page?expand=templates")
        templates = response.json()["@components"]["templates"]["templates"]
        blocks = templates[f"resolveuid/{site_footer.UID()}"]["blocks"]
        assert blocks, "the template carries blocks"
        assert any(b.get("slotId") for b in blocks.values()), "slotIds survive"
        assert any(b.get("fixed") for b in blocks.values()), "fixed flags survive"

    def test_no_templates_for_a_page_without_references(self, api_session, plain_page):
        response = api_session.get("/plain?expand=templates")
        templates = response.json()["@components"]["templates"]
        assert templates["templates"] == {}
        assert not templates.get("errors")

    def test_does_not_expand_the_templates_own_components(
        self, api_session, page_using_template, site_footer
    ):
        """A template's expandable elements include THIS component, so expanding them
        re-enters the resolver and recurses until the stack blows. The caller asked for
        template content, not for another set of links to follow."""
        response = api_session.get("/a-page?expand=templates")
        templates = response.json()["@components"]["templates"]["templates"]
        assert "@components" not in templates[f"resolveuid/{site_footer.UID()}"]


class TestTemplatesExtra:
    """`expand.templates.extra` — the frontend names its forced layouts."""

    def test_resolves_a_layout_not_referenced_by_the_page(
        self, api_session, plain_page, site_footer
    ):
        """A forced layout is never referenced from page content. The frontend owns the
        rule and names the layout; the backend resolves it."""
        response = api_session.get(
            "/plain?expand=templates&expand.templates.extra=/templates/site-footer"
        )
        templates = response.json()["@components"]["templates"]["templates"]
        assert "/templates/site-footer" in templates

    def test_accepts_several_comma_separated(
        self, api_session, plain_page, templates
    ):
        response = api_session.get(
            "/plain?expand=templates&expand.templates.extra="
            "/templates/site-footer,/templates/event-view"
        )
        resolved = response.json()["@components"]["templates"]["templates"]
        assert "/templates/site-footer" in resolved
        assert "/templates/event-view" in resolved

    def test_extras_do_not_displace_page_references(
        self, api_session, page_using_template, site_footer, event_view
    ):
        response = api_session.get(
            "/a-page?expand=templates&expand.templates.extra=/templates/event-view"
        )
        resolved = response.json()["@components"]["templates"]["templates"]
        assert f"resolveuid/{site_footer.UID()}" in resolved
        assert "/templates/event-view" in resolved

    def test_one_template_reached_two_ways_is_keyed_under_both(
        self, api_session, page_using_template, site_footer
    ):
        """The merge looks a template up by the literal string on the block. A template
        reached by uid AND by path must appear under both keys, or one of the two lookups
        misses and that content renders empty."""
        response = api_session.get(
            "/a-page?expand=templates&expand.templates.extra=/templates/site-footer"
        )
        resolved = response.json()["@components"]["templates"]["templates"]
        uid_key = f"resolveuid/{site_footer.UID()}"
        path_key = "/templates/site-footer"
        assert uid_key in resolved
        assert path_key in resolved
        assert resolved[uid_key] == resolved[path_key]

    def test_an_unknown_extra_does_not_hide_the_rest(
        self, api_session, plain_page, site_footer
    ):
        response = api_session.get(
            "/plain?expand=templates&expand.templates.extra="
            "/templates/site-footer,/templates/nope"
        )
        body = response.json()["@components"]["templates"]
        assert "/templates/site-footer" in body["templates"]
        assert [e["templateId"] for e in body["errors"]] == ["/templates/nope"]


class TestTemplatesErrors:
    """A missing template is reported, never raised."""

    def test_missing_template_is_named_not_raised(
        self, api_session, page_using_template, site_footer
    ):
        response = api_session.get(
            "/a-page?expand=templates&expand.templates.extra=/templates/nope"
        )
        assert response.status_code == 200, "one missing template must not fail the read"
        templates = response.json()["@components"]["templates"]
        errors = templates.get("errors", [])
        assert len(errors) == 1
        assert errors[0]["templateId"] == "/templates/nope"
        assert "not found" in errors[0]["error"]
        assert f"resolveuid/{site_footer.UID()}" in templates["templates"], (
            "the templates that DO resolve still arrive"
        )

    def test_unknown_uid_is_reported(self, api_session, plain_page):
        response = api_session.get(
            "/plain?expand=templates&expand.templates.extra=resolveuid/no-such-uid"
        )
        assert response.status_code == 200
        errors = response.json()["@components"]["templates"]["errors"]
        assert errors[0]["templateId"] == "resolveuid/no-such-uid"

    def test_no_errors_key_when_everything_resolves(
        self, api_session, page_using_template
    ):
        response = api_session.get("/a-page?expand=templates")
        assert "errors" not in response.json()["@components"]["templates"]


class TestTemplatesRoute:
    """The same component from its own @templates route."""

    def test_route_serves_the_component(self, api_session, page_using_template):
        response = api_session.get("/a-page/@templates")
        assert response.status_code == 200
        assert set(response.json()) >= {"@id", "templates", "idFieldMap"}

    def test_route_matches_the_inline_expansion(self, api_session, page_using_template):
        """Two paths to one component drift when only one is maintained. Pin them."""
        extra = "expand.templates.extra=/templates/event-view"
        route = api_session.get(f"/a-page/@templates?{extra}").json()
        inline = api_session.get(f"/a-page?expand=templates&{extra}").json()
        inline = inline["@components"]["templates"]
        assert route["templates"] == inline["templates"]
        assert route["idFieldMap"] == inline["idFieldMap"]

    def test_route_works_at_the_site_root(self, api_session, portal):
        """The site root has templates like any other page."""
        response = api_session.get("/@templates")
        assert response.status_code == 200
        assert "templates" in response.json()


class TestIdFieldMap:
    """The object_list id fields the merge cannot infer.

    The merge falls back to `@id` when it is not told, which mints a bogus id for a
    `field_id`-keyed field — the item is then silently dropped on the next merge.
    """

    def test_reports_a_known_non_default_id_field(
        self, api_session, page_using_template
    ):
        id_field_map = _id_field_map(api_session)
        assert id_field_map["form"]["subblocks"] == "field_id", (
            "a form's fields key on field_id, not @id"
        )

    def test_never_restates_the_at_id_default(self, api_session, page_using_template):
        """`@id` is the merge's own fallback, so restating it would be noise."""
        for block_type, fields in _id_field_map(api_session).items():
            for field, id_field in fields.items():
                assert id_field != "@id", f"{block_type}.{field} restates the default"


def _id_field_map(api_session):
    return api_session.get("/a-page?expand=templates").json()["@components"][
        "templates"
    ]["idFieldMap"]
