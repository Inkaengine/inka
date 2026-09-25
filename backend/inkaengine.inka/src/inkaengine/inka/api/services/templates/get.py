"""The `@templates` component.

One adapter serves BOTH paths — the inline `?expand=templates` expansion and the
standalone `@templates` route — so the two cannot drift. (The mock this was ported from
has been bitten by exactly that drift: a session-aware `@navigation` route beside an
expansion that was not.)
"""

from inkaengine.inka.api.templates import resolve_templates
from inkaengine.inka.api.templates import split_list
from plone import api
from plone.restapi.interfaces import IExpandableElement
from plone.restapi.services import Service
from zope.component import adapter
from zope.interface import implementer
from zope.interface import Interface


@implementer(IExpandableElement)
@adapter(Interface, Interface)
class Templates:
    def __init__(self, context, request):
        self.context = context
        self.request = request

    def __call__(self, expand=False):
        result = {
            "templates": {
                "@id": f"{self.context.absolute_url()}/@templates",
            }
        }
        # Resolving walks the page's references and reads each template, so an unexpanded
        # read must not pay for it — it gets the @id stub, like every other component.
        if not expand:
            return result

        portal = api.portal.get()
        extra = split_list(self.request.form.get("expand.templates.extra"))
        # The page's own stored blocks are what carry templateId references.
        page_content = {
            "blocks": getattr(self.context, "blocks", None) or {},
            "blocks_layout": getattr(self.context, "blocks_layout", None) or {},
        }
        templates, errors = resolve_templates(portal, self.request, page_content, extra)

        result["templates"]["templates"] = templates
        # Named rather than raised: one missing template must not fail the page read. The
        # frontend decides whether that is fatal.
        if errors:
            result["templates"]["errors"] = errors
        return result


class TemplatesGet(Service):
    """GET <path>/@templates — the same component, addressed directly."""

    def reply(self):
        service = Templates(self.context, self.request)
        return service(expand=True)["templates"]
