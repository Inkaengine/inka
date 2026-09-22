# Plone backend — the templates addon

The Plone side of the templates feature: a `@templates` endpoint that resolves, in one
request, every template a page needs to render.

## Why

Without it a frontend fetches each template itself, discovers nested references only after
the parent arrives, and serialises the walk. `examples/nuxt-blog-starter/composables/ploneApi.js`
is an archaeology of that pain — a cross-render cache, an in-flight-promise dedupe map and
a 5s abort, all because the SSG prerender hit the API ~179x for the same forced footer
layout and cold-hung.

## The contract

Already specified and under test, before any Python exists:

| What | Where |
| --- | --- |
| Response shape | `tests-playwright/fixtures/templates-component.test.cjs` |
| The merge actually consuming it | `tests-playwright/fixtures/templates-component-merge.test.cjs` |
| Reference implementation | `@templates` in `tests-playwright/fixtures/mock-plone-api.cjs` |
| Diff against real Plone | `tests-playwright/conformance/rest-api.spec.ts` |

```json
{
  "@id": "http://localhost:8080/Plone/my-page/@templates",
  "templates": { "<the templateId the block carries>": { "blocks": {}, "blocks_layout": {} } },
  "idFieldMap": { "form": { "subblocks": "field_id" } }
}
```

Three rules the mock encodes, each of which the addon must reproduce:

1. **Key templates by every spelling that reached them.** The merge looks a template up by
   the literal string on the block, so a block carrying `resolveuid/abc` must find an entry
   at `resolveuid/abc` — not at the path it resolved to. One template reached both ways
   appears under both keys, or the merge misses it and the page renders empty.
2. **Resolve `?expand.templates.extra=/a,/b` as well as what the page references.** A
   forced layout is never referenced from page content, which is exactly why frontends had
   to pre-load it by hand. The **frontend** owns the layout rules and names the layouts;
   the backend answers only "resolve these and everything they reference". No
   `allowedTemplates` / `allowedLayouts` policy crosses the wire — layouts are a design
   system's artifacts, and a second frontend against the same content would use entirely
   different template paths.
3. **Name a missing template, don't throw.** One unresolvable id must not fail the page
   read; it appears in an `errors` array and the rest still arrive.

`idFieldMap` covers object_list fields keyed by anything but `@id` (a form's `subblocks` on
`field_id`). The merge falls back to `@id` when not told, which mints a bogus id and the
item is silently dropped on the next merge. Nested object_lists are excluded — the merge
only enumerates a block's top-level array fields, so a nested entry could never be looked up.

## Scaffolding the addon

Not scaffolded yet — generate the package here with the Plone CLI, then set `ADDON_NAME`
so the container installs it:

```bash
export ADDON_NAME=collective.inka.templates   # whatever you name it
```

## Running it

```bash
make backend-start        # this addon, mounted + pip install -e on boot
```

The compose file works before the package exists: with `ADDON_NAME` unset it comes up as
plain Plone rather than failing. Edit Python locally and restart the container to pick
changes up; the ZODB lives in a named volume, so content survives restarts (delete the
volume for a clean site).

Admin is `admin` / `admin`; the API root is <http://localhost:8080/Plone/++api++/>.

For vanilla Plone with no addon — what the conformance suite diffs against — use
`make backend-docker-start` instead.

## Checking it

```bash
make test-conformance
```

`@templates is not yet served by Plone` is the port's tripwire: it asserts Plone 404s the
endpoint, so it **fails the moment the addon starts answering**. That is the signal to
replace it with a real shape diff against the mock.
