# Example listing-variant blocks — design

**Status:** approved (brainstorm), pre-implementation
**Date:** 2026-07-19
**Scope:** new PR (independent of the merged conversion work, #258)

## Problem / goal

`listing` fetches catalog results and repeats an item block per result. We want
three **example/reference blocks** that reuse that exact machinery for other
kinds of "collections", to demonstrate the `expandListingBlocks` + custom
`fetchItems` fetcher pattern:

1. **Related Items** — render the current page's *related items* relation field.
2. **Search Shortcuts** — render a set of values (this page's tags, or all
   site-wide values of an index) as chips, each linking into a pre-filtered
   search.
3. **RSS Feed** — render entries from an external RSS feed.

They live in the **nuxt example** (canonical reference) + the **mock test
frontend** (for Playwright CI), matching how `listing`/`search` are done today.

## Decisions (from brainstorming)

1. **Frontends:** nuxt example + mock test frontend (not react/svelte/vue).
2. **Scope:** all three blocks in one PR. RSS is **client-side best-effort**
   (`fetch()` in the browser; works only for CORS-permitting feeds) — no server
   route. The mock test stubs the fetch.
3. **Pattern:** each block is a new block type + a custom `fetchItems` fetcher
   (`async (block, { start, size }) => ({ items, total })`) fed to
   `expandListingBlocks`. Reuse `variation` + `fieldMapping` for how results map
   to item blocks. No new expansion/paging machinery.
4. **Related-items field:** default to the standard `relatedItems` behavior
   field (present on all content), with an **optional override dropdown** — a
   small new widget that fetches `/@types/<currentType>` and lists the type's
   relation fields. (Verified: no vocabulary enumerates a type's relation
   fields; `/@types` is the source, auth-gated but available to the editor.)
5. **Search-shortcuts index:** reuse Volto's existing `select_querystring_field`
   widget + `plone.app.contenttypes.metadatafields` vocabulary (includes
   `Subject → Tags`). No new picker.
6. **Search-shortcuts scope:** the **presence of a linked page field** decides —
   linked → this page's values of that field; not linked → all unique values of
   the index, site-wide.
7. **Shortcut URL format:** `${searchUrl}?facet.${index}=${value}` — the `search`
   block already reads `facet.*` params from the URL (mock `renderer.js:2117`,
   nuxt `ListingBlock.vue:29`).

## Backend facts (verified against hydra-api.pretagov.com)

- Content items expose `relatedItems` (relation summaries: `@id`/`title`/
  `description`/`image`) and `subjects` (tag values) — both present on `/docs`.
- `plone.app.vocabularies.Keywords` (Subject values) is served by the backend
  **and already by the mock API** (`mock-plone-api.cjs:1706`).
- `plone.app.contenttypes.metadatafields` lists catalog columns incl. `Subject`.
- `/@types/<Type>` requires auth (401 anon) — fine inside the editor.
- No vocabulary lists a type's *relation field instances* (the `Fields` vocab is
  field *types*: Choice/Date/…). So related-items' override needs `/@types`.

## Blocks

### 1. Related Items (`relatedItemsListing`)

- **Config:** `relationField` (default `relatedItems`; override via the new
  `/@types` relation-field dropdown), `variation` (default/summary/teaser),
  `fieldMapping`.
- **Fetcher:** reads the current context content's `[relationField]` (an array of
  relation summaries), slices by `start`/`size`, returns `{ items, total }`. No
  catalog query — the summaries already carry `@id`/`title`/`description`/`image`.
  The fetcher resolves the current content from `contextPath` (or the frontend
  passes it in — decide at plan time; nuxt already has the content in scope).

### 2. Search Shortcuts (`searchShortcuts`)

- **Config:** `index` (`select_querystring_field`, default `Subject`) — drives the
  shortcut URL and the site-wide value source; `searchUrl` (link to the page that
  holds a `search` block); `pageField` (optional) — the content field to read for
  **this-page** mode. Presence of `pageField` ⇒ this-page; absence ⇒ site-wide.
- **Fetcher:** produces one item per value.
  - this-page: read `content[pageField]` values.
  - site-wide: fetch the index's vocabulary
    (`@vocabularies/plone.app.vocabularies.Keywords` for Subject) for the unique
    values.
  - Each item is a link block: `href = ${searchUrl}?facet.${index}=${value}`,
    label = value. Rendered as a chip/tag list (small dedicated renderer).
- **Index vs content-field wrinkle:** the index name (`Subject`) differs from the
  content field (`subjects`); the block maps index → content field for this-page
  reads (known convention for the example; documented).

### 3. RSS Feed (`rssFeed`)

- **Config:** `feedUrl` (text), `count` (max items).
- **Fetcher:** client-side `fetch(feedUrl)` → `DOMParser` XML → map each `<item>`
  (`title`/`link`/`description`/`pubDate`) to an item block. Best-effort: a CORS
  failure renders an empty/placeholder state, not a crash. Mock test stubs the
  fetch with canned RSS XML.

## Rendering

Each block expands to item blocks rendered by the frontend's existing item
renderers (teaser/summary/default), exactly like `listing`. Search Shortcuts
adds one small renderer for the chip/link list. Nuxt example + mock frontend both
get renderers; the block schemas go in the shared `shared-block-schemas.js`
(mock) and the nuxt example's registered blocks.

## Shared new widget

`relationFieldSelect` (working name): fetches `/@types/<currentType>` (authed),
lists RelationList/RelationChoice fields as a `select`. Used only by Related
Items. All other pickers reuse existing widgets/vocabularies.

## Testing (mock frontend + Playwright, admin-mock)

- **Mock API/content:** a page fixture with `relatedItems` summaries + `subjects`
  values; `Keywords` vocab (already served); a stubbed RSS endpoint returning
  canned XML; `/@types/<Type>` returning a schema with a couple of relation
  fields (for the override dropdown).
- **Tests:**
  - Related Items renders the page's related items; the `/@types` override lists
    the relation fields and switching field changes the rendered set.
  - Search Shortcuts: with a linked field renders this page's tags; without,
    renders site-wide tags; each chip's `href` is `…?facet.Subject=<value>`.
  - RSS renders the stubbed feed's entries; a fetch failure degrades gracefully.
  - Follow the mock-only guard + auto-discovery lessons from #258 (synthetic
    blocks/pages must not break `block-sanity`/`empty-region-sanity`; mark
    non-addable helpers `restricted` where appropriate).

## Non-goals / follow-ups

- No server-side RSS proxy (client-side best-effort only).
- React/svelte/vue example frontends not covered this PR.
- The relation-field override widget is intentionally minimal (example-grade).

## Risks

- **Fetchers reading the current page** (related-items, search-shortcuts
  this-page) don't fit the "fetch from catalog" shape of `ploneFetchItems` — they
  read the context content. Confirm the cleanest way to hand the fetcher the
  current content (fetch by `contextPath` vs frontend injection) at plan time.
- **index → content-field mapping** for this-page search-shortcuts (Subject vs
  subjects) — keep the example's mapping explicit/documented.
- **Auto-discovery / sanity specs** (lesson from #258): the new example blocks +
  fixtures must be excluded from or tolerated by `block-sanity` /
  `empty-region-sanity`, and kept out of frontend choosers where they'd bloat
  (`restricted`).
