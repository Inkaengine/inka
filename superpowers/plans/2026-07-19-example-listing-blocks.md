# Example listing-variant blocks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans to implement this plan task-by-task (inline, no subagents — per user instruction). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Three example/reference blocks that reuse `expandListingBlocks` + a custom `fetchItems` fetcher — Related Items, Search Shortcuts, and RSS Feed — in the nuxt example + mock test frontend.

**Architecture:** Each block is a new block type whose items come from a custom fetcher `async (block, { start, size }) => ({ items, total })` (the same contract as `ploneFetchItems`). Fetchers live in the shared `packages/helpers/index.js` (imported by every frontend). **No bespoke renderers:** each block expands via `expandListingBlocks` into standard item blocks (default/summary/teaser) that all frontends already render — Search Shortcuts included (each shortcut is a link *item* with an `href`, not a custom chip). So the only per-frontend work is registering the fetcher in that frontend's `fetchItems` map and letting the new block types flow through the existing listing-render path. That makes the blocks frontend-agnostic — they work anywhere the fetcher is registered. Block schemas go in `shared-block-schemas.js` (mock) + the nuxt example's registered blocks. One small admin-side widget (`schemaFieldSelect`, parameterized by field type) lists a content type's fields for the Related Items override.

**Tech stack:** `@volto-hydra/helpers` (shared fetchers, jest-tested), mock test frontend (vite) + nuxt-blog-starter (Vue), Volto admin widgets (`packages/volto-hydra`), Playwright admin-mock.

**Spec:** `docs/superpowers/specs/2026-07-19-example-listing-blocks-design.md`

**Key existing anchors:**
- Fetcher contract + factory pattern: `packages/helpers/index.js:811` (`ploneFetchItems`).
- Fetcher unit-test pattern (mock `global.fetch`): `packages/hydra-js/ploneFetchItems.test.js`.
- Mock frontend fetchItems wiring: `tests-playwright/fixtures/test-frontend/index.html:219-232`.
- Mock renderer switch + `renderListingBlock`: `renderer.js:307`, `:1671`.
- Nuxt fetchItems wiring: `examples/nuxt-blog-starter/components/ListingBlock.vue:61`.
- Nuxt block render switch: `examples/nuxt-blog-starter/components/block.vue`.
- Search facet URL format (`facet.<field>`): mock `renderer.js:2117`, nuxt `ListingBlock.vue:29`.
- Reuse for the index picker: `select_querystring_field` + `plone.app.contenttypes.metadatafields` (`core/.../Search/schema.js:150`).
- `Keywords` vocab already served by the mock: `mock-plone-api.cjs:1706`.
- **#258 lessons:** synthetic blocks/pages get auto-discovered (`block-sanity`, `empty-region-sanity`) and can bloat frontend choosers — exclude `conv`-style prefixes and mark helper blocks `restricted`.

---

## File structure

**Create:**
- `packages/helpers/relatedItemsFetcher` / `searchShortcutsFetcher` / `rssFetcher` — three exported factories in `packages/helpers/index.js` (one file; they're small and belong with `ploneFetchItems`).
- `packages/hydra-js/exampleListingFetchers.test.js` — jest unit tests for all three (mock `fetch`).
- `packages/volto-hydra/src/components/Widgets/SchemaFieldSelectWidget.jsx` — a `/@types` field dropdown **parameterized by field type** (`fieldType: 'relation' | 'keyword' | …`); Related Items uses it with `fieldType: 'relation'`. Reusable for other field pickers.
- `tests-playwright/fixtures/content/example-listings-page/data.json` — page fixture with the three blocks + `relatedItems` summaries + `subjects`.
- `tests-playwright/integration/example-listings.spec.ts` — integration coverage.

**Modify:**
- `packages/helpers/index.js` — add the three fetchers.
- `tests-playwright/fixtures/shared-block-schemas.js` — three block schemas (`relatedItemsListing`, `searchShortcuts`, `rssFeed`), `restricted` where they shouldn't clutter choosers.
- `tests-playwright/fixtures/test-frontend/index.html` — add the three fetchers to the `fetchItems` map (`:232`), register in page `allowedBlocks`.
- `tests-playwright/fixtures/test-frontend/renderer.js` — recognize the new block types in the listing path (`hasListings` check + a `case` delegating to `renderListingBlock`); **no bespoke renderers**.
- `examples/nuxt-blog-starter/components/ListingBlock.vue` (or `[...slug].vue`) — add the three fetchers to `fetchItems`.
- `examples/nuxt-blog-starter/components/block.vue` — recognize the new types on the existing ListingBlock render path (no new render logic).
- `packages/volto-hydra/src/index.js` — register the widget.
- `tests-playwright/fixtures/mock-plone-api.cjs` — serve `/@types/<Type>` with relation fields; serve a stubbed RSS URL.
- `tests-playwright/bridge/block-sanity.spec.ts` + `empty-region-sanity.spec.ts` — exclude the example blocks if they trip discovery (mirror #258's `conv` filter).
- `docs/listings.md` — document the three example fetchers.

---

## Task 1: `relatedItemsFetcher` (helpers, unit)

**Files:**
- Modify: `packages/helpers/index.js`
- Test: `packages/hydra-js/exampleListingFetchers.test.js`

- [ ] **Step 1: Write the failing test** (mock `fetch` returning a content item with `relatedItems`)

```js
import { relatedItemsFetcher } from '@volto-hydra/helpers';

const API = 'http://api.test';
function mockContent(relatedItems) {
  global.fetch = async (url) => ({
    ok: true,
    json: async () => ({ '@id': `${API}/page`, relatedItems }),
  });
}

test('relatedItemsFetcher returns the current page relation field items, paged', async () => {
  mockContent([
    { '@id': `${API}/a`, title: 'A' },
    { '@id': `${API}/b`, title: 'B' },
    { '@id': `${API}/c`, title: 'C' },
  ]);
  const fetcher = relatedItemsFetcher({ apiUrl: API, contextPath: '/page' });
  const { items, total } = await fetcher({ relationField: 'relatedItems' }, { start: 1, size: 1 });
  expect(total).toBe(3);
  expect(items.map((i) => i.title)).toEqual(['B']);
});

test('defaults to the relatedItems field', async () => {
  mockContent([{ '@id': `${API}/a`, title: 'A' }]);
  const fetcher = relatedItemsFetcher({ apiUrl: API, contextPath: '/page' });
  const { items } = await fetcher({}, { start: 0, size: 10 });
  expect(items).toHaveLength(1);
});
```

- [ ] **Step 2: Run — expect FAIL** (`relatedItemsFetcher` not exported)

Run: `cd packages/hydra-js && NODE_OPTIONS='--experimental-vm-modules' npx jest exampleListingFetchers`
Expected: FAIL (import undefined).

- [ ] **Step 3: Implement** in `packages/helpers/index.js` (mirror `ploneFetchItems`'s factory + image normalization)

```js
/**
 * Fetcher for the Related Items example block: renders the CURRENT page's
 * relation field (default `relatedItems`). Reads the context content and pages
 * its relation summaries — no catalog query.
 */
export function relatedItemsFetcher({ apiUrl, contextPath = '/' } = {}) {
  if (!apiUrl) throw new Error('relatedItemsFetcher requires apiUrl');
  return async function fetchItems(block, { start, size }) {
    const field = block.relationField || 'relatedItems';
    const headers = _getAuthHeaders();
    const res = await fetch(`${apiUrl}${contextPath}/++api++`, { headers });
    const content = await res.json();
    const all = Array.isArray(content?.[field]) ? content[field] : [];
    const items = size ? all.slice(start, start + size) : [];
    return { items, total: all.length };
  };
}
```

(If `_getAuthHeaders` / the `++api++` path differ from `ploneFetchItems`, match that helper exactly. Reuse the same image-normalization map if related summaries carry `image_scales`.)

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/helpers/index.js packages/hydra-js/exampleListingFetchers.test.js
git commit -m "feat(helpers): relatedItemsFetcher — page relation field as a listing source"
```

---

## Task 2: `searchShortcutsFetcher` (helpers, unit)

**Files:** Modify `packages/helpers/index.js`; extend the test file.

- [ ] **Step 1: Write failing tests** — this-page (linked field) vs site-wide (vocab), and the `facet.` href.

```js
import { searchShortcutsFetcher } from '@volto-hydra/helpers';

test('this-page mode: values from the content field, hrefs facet the index', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ subjects: ['news', 'plone'] }) });
  const fetcher = searchShortcutsFetcher({ apiUrl: API, contextPath: '/page' });
  const { items } = await fetcher(
    { pageField: 'subjects', index: 'Subject', searchUrl: '/search' },
    { start: 0, size: 10 },
  );
  expect(items.map((i) => i.title)).toEqual(['news', 'plone']);
  expect(items[0].href).toEqual([{ '@id': '/search?facet.Subject=news' }]);
});

test('site-wide mode (no pageField): unique values from the index vocabulary', async () => {
  global.fetch = async (url) => ({
    ok: true,
    json: async () =>
      url.includes('Keywords')
        ? { items: [{ token: 'a', title: 'a' }, { token: 'b', title: 'b' }] }
        : {},
  });
  const fetcher = searchShortcutsFetcher({ apiUrl: API, contextPath: '/page' });
  const { items, total } = await fetcher({ index: 'Subject', searchUrl: '/search' }, { start: 0, size: 10 });
  expect(items.map((i) => i.title)).toEqual(['a', 'b']);
  expect(total).toBe(2);
});
```

(Confirm the item shape the renderers expect — `title` + `href` as a link array, or a plain string href. Match whatever the chip renderer in Task 6 consumes; keep the test and renderer in sync.)

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** — factory that branches on `block.pageField`:
  - present → `GET ${apiUrl}${contextPath}/++api++`, read `content[pageField]` (array).
  - absent → `GET ${apiUrl}/++api++/@vocabularies/plone.app.vocabularies.Keywords` (map by `index`; for the example, Subject→Keywords), read `items[].token`.
  - map each value → `{ '@type': <chip item type>, title: value, href: [{ '@id': `${searchUrl}?facet.${index}=${value}` }] }`.
  - page by `start`/`size`; `total` = full count.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(helpers): searchShortcutsFetcher — page/site values as facet-search links"
```

---

## Task 3: `rssFetcher` (helpers, unit)

**Files:** Modify `packages/helpers/index.js`; extend the test file.

- [ ] **Step 1: Write failing test** — mock `fetch` returning RSS XML; assert parsed entries.

```js
import { rssFetcher } from '@volto-hydra/helpers';

const RSS = `<?xml version="1.0"?><rss><channel>
  <item><title>First</title><link>http://x/1</link><description>d1</description><pubDate>Mon, 01 Jan 2026</pubDate></item>
  <item><title>Second</title><link>http://x/2</link><description>d2</description></item>
</channel></rss>`;

test('rssFetcher parses feed items, paged', async () => {
  global.fetch = async () => ({ ok: true, text: async () => RSS });
  const fetcher = rssFetcher();
  const { items, total } = await fetcher({ feedUrl: 'http://x/feed', count: 10 }, { start: 0, size: 10 });
  expect(total).toBe(2);
  expect(items[0]).toMatchObject({ title: 'First', href: [{ '@id': 'http://x/1' }] });
});

test('rssFetcher degrades to empty on fetch failure (best-effort)', async () => {
  global.fetch = async () => { throw new Error('CORS'); };
  const { items, total } = await rssFetcher()({ feedUrl: 'http://x/feed' }, { start: 0, size: 10 });
  expect(items).toEqual([]);
  expect(total).toBe(0);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** — client-side fetch + parse. Use a **dependency-free, DOMParser-free** parse (regex over `<item>…</item>` extracting `title`/`link`/`description`/`pubDate`) so it runs in both the browser and jest-node without a polyfill; wrap in try/catch → `{ items: [], total: 0 }` on any failure. Map each entry → item block `{ title, description, href: [{'@id': link}], pubDate }`. Respect `block.count` and `start`/`size`.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(helpers): rssFetcher — external RSS entries (client-side best-effort)"
```

---

## Task 4: `schemaFieldSelect` widget (admin, field-type parameterized)

**Files:**
- Create: `packages/volto-hydra/src/components/Widgets/SchemaFieldSelectWidget.jsx`
- Modify: `packages/volto-hydra/src/index.js` (register `config.widgets.widget.schemaFieldSelect`)

- [ ] **Step 1** — inspect an existing simple select widget in `packages/volto-hydra/src/components/Widgets` (e.g. `BlockTypeSelectWidget.jsx`) for the shape (choices computed at render, `onChange(id, value)`).

- [ ] **Step 2: Implement** — a widget that reads a **`fieldType` parameter** from its schema entry (`props.fieldType` or `widgetOptions.frontendOptions.fieldType`, e.g. `'relation'`, `'keyword'`). On mount it fetches `/@types/${contentType}` (auth headers via the admin token; `contentType` from the Hydra schema context / `formData['@type']`), lists the schema fields matching that field type (relation → `widget: 'relateditems'` / relation markers; keyword → the tags/keyword widget), and renders a `<select>` (empty option = the block's default). Falls back to a free-text input if the fetch fails. `fieldType` unset → list all fields.

- [ ] **Step 3** — register in `packages/volto-hydra/src/index.js`: `config.widgets.widget.schemaFieldSelect = SchemaFieldSelectWidget;`

- [ ] **Step 4** — no unit test (network widget); covered by the Task 9 integration test (with `fieldType: 'relation'` the dropdown lists the mock `/@types` relation fields).

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(widget): schemaFieldSelect — /@types field dropdown, parameterized by field type"
```

---

## Task 5: Block schemas

**Files:** Modify `tests-playwright/fixtures/shared-block-schemas.js` (mock) + the nuxt example's registered blocks (`examples/nuxt-blog-starter/pages/[...slug].vue` newBlocks, via sharedBlocksConfig import).

- [ ] **Step 1** — add three block configs to `sharedBlocksConfig`:
  - `relatedItemsListing`: `blockSchema` with `relationField` (widget `schemaFieldSelect`, `fieldType: 'relation'`), `variation` (item type), `fieldMapping`; `restricted: false` (it's a real addable block); item type via `inheritSchemaFrom` like `listing`.
  - `searchShortcuts`: `index` (widget `select_querystring_field`, vocabulary `plone.app.contenttypes.metadatafields`, default `Subject`), `searchUrl` (link widget), `pageField` (optional — `select_querystring_field` or text).
  - `rssFeed`: `feedUrl` (text), `count` (number, default 6).
- [ ] **Step 2** — mirror the `listing` block's `inheritSchemaFrom`/`itemTypeField: 'variation'` so expanded items get the chosen item type.
- [ ] **Step 3: Commit**

```bash
git commit -am "feat(blocks): schemas for relatedItemsListing / searchShortcuts / rssFeed"
```

---

## Task 6: Mock frontend — register fetchers + recognize the new types

**Files:** Modify `tests-playwright/fixtures/test-frontend/index.html` + `renderer.js`. **No bespoke renderers** — the blocks expand via the existing listing path into standard item blocks.

- [ ] **Step 1** — `index.html`: import the three fetchers from `/helpers.js`; add them to the `fetchItems` map at `:232` (and the `contextOverride` branch): `{ listing: fi, relatedItemsListing: relatedItemsFetcher({...}), searchShortcuts: searchShortcutsFetcher({...}), rssFeed: rssFetcher() }`. Add the three types to the page `allowedBlocks`.
- [ ] **Step 2** — `renderer.js`: extend the listing recognition so the new types flow through the existing expansion — the `hasListings` check (`:40`, currently `=== 'listing'`) accepts the new types, and each new type's `case` in the block switch delegates to `renderListingBlock`. Search Shortcuts needs no chip renderer: its fetcher returns link items (title + `href`) which the existing `default`/link item renderer already renders as `<a href>`.
- [ ] **Step 3** — smoke: start servers, open the fixture page (Task 8), confirm the blocks render (assertions in Task 9).
- [ ] **Step 4: Commit**

```bash
git commit -am "feat(mock-frontend): register example fetchers + recognize the new listing types"
```

---

## Task 7: Nuxt example — register fetchers + recognize the new types

**Files:** Modify `examples/nuxt-blog-starter/components/ListingBlock.vue` (fetchItems map) + `block.vue` (type recognition). No new render logic.

- [ ] **Step 1** — add the three fetchers to `ListingBlock.vue`'s `fetchItems` (import from `@hydra-js/helpers`), keyed by the new block types.
- [ ] **Step 2** — `block.vue`: route the new types onto the existing ListingBlock render path (extend the `isListing`/type checks). Search Shortcuts renders as link items via the existing item rendering — no bespoke chip markup.
- [ ] **Step 3: Commit**

```bash
git commit -am "feat(nuxt-example): register example fetchers + recognize the new listing types"
```

---

## Task 8: Fixtures (content + mock API)

**Files:** Create `tests-playwright/fixtures/content/example-listings-page/data.json`; modify `tests-playwright/fixtures/mock-plone-api.cjs`.

- [ ] **Step 1** — content page: a `relatedItemsListing` (page has `relatedItems` summaries → 2-3 items), a `searchShortcuts` (page has `subjects: ['news','plone']`), a `rssFeed` (feedUrl → the stub), and a `search` block on a linked `/search` page (or reuse an existing search page).
- [ ] **Step 2** — mock API: serve `/@types/<Type>` returning a schema whose `properties` include a couple of relation fields (so the override dropdown has options); serve the stub RSS URL returning canned XML. `Keywords` vocab already served (`:1706`).
- [ ] **Step 3: Commit**

```bash
git commit -am "test(fixtures): example-listings page + mock @types + stub RSS"
```

---

## Task 9: Integration tests (admin-mock)

**Files:** Create `tests-playwright/integration/example-listings.spec.ts`.

- [ ] **Step 1: Write failing tests**
  - Related Items renders the page's related items (count matches `relatedItems`); selecting a different relation field in the override dropdown re-renders.
  - Search Shortcuts with `pageField: subjects` renders `news`/`plone` chips; each chip `href` ends `?facet.Subject=<value>`. Without `pageField`, renders the site-wide `Keywords` values.
  - RSS renders the stub feed's entries; simulate a fetch failure → graceful empty (no crash).
- [ ] **Step 2: Run — expect FAIL** (blocks not yet wired end-to-end / assertions unmet).
- [ ] **Step 3** — fix any wiring gaps surfaced (renderer/fetcher/schema mismatches).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit**

```bash
git commit -am "test(example-listings): integration coverage for the three blocks"
```

---

## Task 10: Auto-discovery guards + docs

**Files:** Modify `block-sanity.spec.ts` / `empty-region-sanity.spec.ts` if needed; `docs/listings.md`.

- [ ] **Step 1** — run the bridge sanity specs against a fresh discovery (or reason from #258): if the example blocks/page trip `block-sanity` (no `data-edit-text`) or `empty-region-sanity`, exclude them (filter by block-type prefix, mirroring the `conv` filter) OR ensure their renderers carry proper annotations. Mark any non-addable helper block `restricted`.
- [ ] **Step 2** — `docs/listings.md`: add a short "Example fetchers" subsection documenting `relatedItemsFetcher`, `searchShortcutsFetcher`, `rssFetcher` and the search-shortcut `?facet.` URL. Keep concise (`feedback_concise_docs`).
- [ ] **Step 3: Commit + push + open PR.**

---

## Verification

1. `cd packages/hydra-js && NODE_OPTIONS='--experimental-vm-modules' npx jest exampleListingFetchers` — 3 fetchers green.
2. `pnpm exec playwright test tests-playwright/integration/example-listings.spec.ts --project=admin-mock` — all green.
3. Bridge sanity (`block-sanity`, `empty-region-sanity`) + a listing regression spec — no regressions.
4. Push branch, open PR (independent of #258), CI green across frontends (watch nuxt — the example blocks now render in nuxt too).

## Risks / watch-items (from the spec + #258)

- **Current-page fetchers**: related-items + search-shortcuts-this-page GET the context content; confirm the exact `++api++` path + auth headers match `ploneFetchItems`.
- **index → content-field** (Subject vs subjects) for this-page search-shortcuts — keep the mapping explicit in the fetcher + documented.
- **RSS in jest-node**: parse without DOMParser (regex) so the unit test runs; try/catch → empty on CORS.
- **Auto-discovery / choosers (#258)**: new blocks must not break `block-sanity`/`empty-region-sanity`, and must not bloat the nuxt page chooser (nuxt derives it from unrestricted `blocksConfig` keys — `restricted` any helper types; keep the three real blocks addable but verify nuxt CI).
