"""The Template content type, and moving a site's existing templates onto it.

A template is a page other pages take blocks from (docs/frontend-guide/templates.md).
Its own type lets a site tell templates apart from pages: site search and the sitemap
leave them out, and a front end can mark them noindex. Templates can be saved in any
folder, so nothing here looks at where they are.
"""

from Acquisition import aq_base
from inkaengine.inka.api.templates import collect_template_ids
from inkaengine.inka.api.templates import resolve_template_object
from plone import api

import logging


logger = logging.getLogger("inkaengine.inka")

TEMPLATE_TYPE = "Template"


def make_template_type(portal) -> None:
    """Add the Template type as a copy of this site's Document, so it has whatever
    behaviours, schema and views Document has here. Left as it is when it exists."""
    types = portal.portal_types
    if TEMPLATE_TYPE not in types:
        types.manage_pasteObjects(types.manage_copyObjects(["Document"]))
        types.manage_renameObject("copy_of_Document", TEMPLATE_TYPE)
        types[TEMPLATE_TYPE].manage_changeProperties(
            title="Template",
            description="A page whose blocks other pages use.",
            factory=TEMPLATE_TYPE,
            add_view_expr=f"string:${{folder_url}}/++add++{TEMPLATE_TYPE}",
        )

    not_searched = api.portal.get_registry_record("plone.types_not_searched")
    if TEMPLATE_TYPE not in not_searched:
        api.portal.set_registry_record(
            "plone.types_not_searched", (*not_searched, TEMPLATE_TYPE)
        )

    repo = portal.portal_repository
    versionable = list(repo.getVersionableContentTypes())
    if "Document" in versionable and TEMPLATE_TYPE not in versionable:
        repo.setVersionableContentTypes([*versionable, TEMPLATE_TYPE])
        for policy in repo.getPolicyMap().get("Document", ()):
            repo.addPolicyForContentType(TEMPLATE_TYPE, policy)

    diff_tool = portal.portal_diff
    document_diffs = diff_tool.getDiffForPortalType("Document")
    if document_diffs and not diff_tool.getDiffForPortalType(TEMPLATE_TYPE):
        for field, diff in document_diffs.items():
            diff_tool.setDiffForPortalType(TEMPLATE_TYPE, {field: diff})


def templates_become_template_type(portal) -> list[str]:
    """Every Document a page uses as a template becomes a Template. Found by the
    references in each page's blocks, so wherever the templates are saved. A reference
    to something that is not there stops the upgrade and names it.

    Returns the converted paths, relative to the site."""
    base = "/".join(portal.getPhysicalPath())
    referenced = {}
    for brain in portal.portal_catalog.unrestrictedSearchResults(path=base):
        obj = brain._unrestrictedGetObject()
        blocks = getattr(aq_base(obj), "blocks", None)
        if not blocks:
            continue
        for template_id in collect_template_ids(blocks):
            template = resolve_template_object(portal, template_id)
            if template is None:
                raise LookupError(
                    f"{brain.getPath()} uses template {template_id}, which is not there"
                )
            referenced["/".join(template.getPhysicalPath())] = template

    changed = []
    for path, template in sorted(referenced.items()):
        if template.portal_type != "Document":
            continue
        template.portal_type = TEMPLATE_TYPE
        template.reindexObject()
        changed.append(path[len(base) :])
    logger.info("%d templates are now Templates: %s", len(changed), changed)
    return changed


def post_install(context) -> None:
    make_template_type(api.portal.get())


def to_1001(context) -> None:
    portal = api.portal.get()
    make_template_type(portal)
    templates_become_template_type(portal)
