"""Resolving the templates a page needs.

The logic behind the `@templates` endpoint, kept apart from the service wiring so it can
be read and tested as plain functions.

Ported from the reference implementation in the mock API
(`tests-playwright/fixtures/mock-plone-api.cjs`), which was built first so the contract
could be settled cheaply against the real merge before any Python existed.
"""

from plone import api
from plone.app.uuid.utils import uuidToObject
from plone.restapi.interfaces import ISerializeToJson
from zope.component import getMultiAdapter

import re


# A template reference may be `resolveuid/<uid>`, an absolute URL, or a plain path — all
# three appear in real content. Matches an optional leading `../` chain, as stored
# references sometimes carry one.
RESOLVEUID_RE = re.compile(r"(?:\.\./)*resolveuid/([^/?#]+)$")


def collect_template_ids(value, found=None, seen=None):
    """Every `templateId` referenced anywhere in a value, at any depth.

    Walks everything rather than assuming a shape: the reference may sit on a block, on a
    nested container's child, or on an object_list item. `seen` guards against cycles in
    content that references itself.
    """
    if found is None:
        found = []
    if seen is None:
        seen = set()
    if isinstance(value, dict):
        if id(value) in seen:
            return found
        seen.add(id(value))
        template_id = value.get("templateId")
        if isinstance(template_id, str) and template_id not in found:
            found.append(template_id)
        for child in value.values():
            collect_template_ids(child, found, seen)
    elif isinstance(value, (list, tuple)):
        if id(value) in seen:
            return found
        seen.add(id(value))
        for item in value:
            collect_template_ids(item, found, seen)
    return found


def resolve_template_object(portal, template_id):
    """The content object a template reference points at, or None.

    Accepts the three spellings above. A uid is resolved through the catalog, a path
    through portal traversal.

    Deliberately performs NO permission check — both lookups are unrestricted, and the
    caller checks View once, uniformly (see resolve_templates). The uid lookup used to go
    through api.content.get, which ends in restrictedTraverse and RAISES Unauthorized
    itself: a private template then failed the whole page read with a 401 before the
    caller's check could report it. Locating unrestricted and checking explicitly is the
    pattern uuidToObject's own docstring asks for.
    """
    if not isinstance(template_id, str) or not template_id:
        return None

    uid_match = RESOLVEUID_RE.search(template_id)
    if uid_match:
        return uuidToObject(uid_match.group(1), unrestricted=True)

    path = template_id
    if path.startswith("http"):
        # An absolute URL: keep only the portion below the portal.
        portal_url = portal.absolute_url()
        if not path.startswith(portal_url):
            return None
        path = path[len(portal_url) :]
    path = path.replace("/++api++", "")
    if not path.startswith("/"):
        path = f"/{path}"
    path = path.rstrip("/")
    if not path:
        return portal
    try:
        return portal.unrestrictedTraverse(path.lstrip("/"), None)
    except Exception:
        return None


def serialize_template(obj, request):
    """A template as JSON, serialized the way any other content read is.

    Using the normal serializer means template content reaches the frontend through
    exactly the same path as page content — same blocks, same resolved references.

    `include_expansion=False` is load-bearing, not an optimisation: the expandable
    elements of a template include THIS component, so expanding them re-enters the
    resolver and recurses until the stack blows ("maximum recursion depth exceeded" on
    every request). A template's own @components are of no use to the caller anyway — it
    asked for template content, not for another set of links to follow.
    """
    serializer = getMultiAdapter((obj, request), ISerializeToJson)
    return serializer(include_expansion=False)


def resolve_templates(portal, request, page_content, extra_ids=()):
    """Every template a page needs: what it references, plus `extra`, plus what those
    reference in turn.

    `extra_ids` exists because the FRONTEND owns the layout rules. A forced layout is
    never referenced from page content — that is exactly why frontends had to pre-load it
    by hand — so the backend cannot discover it and must be told. The backend answers only
    the data question: "resolve these and everything they reference". No policy crosses
    the wire.

    Returns `(templates, errors)`. Templates are keyed by the SAME string the caller
    referenced, because that is what the merge looks up: a block carrying
    `resolveuid/<uid>` must find an entry at `resolveuid/<uid>`, not at the path it
    resolved to. One template reached by two spellings is emitted under both.
    """
    templates = {}
    errors = []
    visited_paths = set()
    pending = list(collect_template_ids(page_content)) + [e for e in extra_ids if e]

    while pending:
        next_round = []
        for template_id in pending:
            if template_id in templates:
                continue
            if any(e["templateId"] == template_id for e in errors):
                continue

            obj = resolve_template_object(portal, template_id)
            if obj is None:
                errors.append({
                    "templateId": template_id,
                    "error": f"not found: {template_id}",
                })
                continue

            # Serve templates with the REQUESTER's permissions, never elevated.
            # resolve_template_object locates objects without a security check (a uid
            # lookup, an unrestricted traverse), so without this the serializer raises
            # Unauthorized mid-response — which fails the WHOLE page read with a 401
            # whenever a published page uses a template the visitor cannot view (the
            # common case of an unpublished /templates folder). Reported like a missing
            # template instead. "unauthorized" rather than "not found" so a developer
            # sees why; it reveals no more than a direct GET of the template would.
            if not api.user.has_permission("View", obj=obj):
                errors.append({
                    "templateId": template_id,
                    "error": f"unauthorized: {template_id}",
                })
                continue

            data = serialize_template(obj, request)
            templates[template_id] = data

            # A template may reference further templates; follow those too. Guard on the
            # resolved PATH so two spellings of one template are walked only once.
            obj_path = "/".join(obj.getPhysicalPath())
            if obj_path not in visited_paths:
                visited_paths.add(obj_path)
                for nested in collect_template_ids(data):
                    if nested not in templates:
                        next_round.append(nested)
        pending = next_round

    return templates, errors


def split_list(raw):
    """A comma-separated query value as a list, accepting a repeated param too."""
    if raw is None:
        return []
    parts = raw if isinstance(raw, (list, tuple)) else [raw]
    out = []
    for part in parts:
        for piece in str(part).split(","):
            piece = piece.strip()
            if piece:
                out.append(piece)
    return out
