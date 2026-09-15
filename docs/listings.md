---
"@type": Document
UID: docs-listings-001
allow_discussion: false
contributors: []
creators:
  - admin
description: A listing block fetches content from the server (e.g. latest news)
  and renders each result as a separate block, repeating each block once per
  result entry. This means a listing can be moved between containers and reuse
  normal blocks for what it repeats.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: listings
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - listings
  - frontend
title: Listings & Dynamic Blocks
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="separator" _="${hr}" styles={"align":"full"} />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
blocks-tagged: |
  <block type="slateTable">
    <region name="table.rows">
      <block type="row">
        <region name="cells">
          <block type="cell" value="${td/slate}" />
        </region>
      </block>
    </region>
  </block>
---

# Listings & Dynamic Blocks

A listing block fetches content from the server (e.g. latest news) and renders each result as a separate block, repeating each block once per result entry. This means a listing can be moved between containers and reuse normal blocks for what it repeats.

`expandListingBlocks(layout, options)` is a helper in hydra.js that handles fetching, paging, and mapping results to block objects. It walks a layout, fetches results for each listing-type block, and returns `{ items, paging }` where `items` is an array of block objects with `@uid` and `@type`.

You tell it which block types need fetching via a `fetchItems` map — keys are block types, values are fetcher functions. This means you can have different kinds of listings (Plone queries, RSS feeds, etc.) each with their own fetcher:

### Javascript

```javascript
const { items, paging } = await expandListingBlocks(layout, {
  blocks,
  paging: { start: 0, size: 6 },
  fetchItems: {
    listing: ploneFetchItems({ apiUrl, contextPath }),
    rssFeed: myRSSFetcher,
  },
});
// paging = { totalPages, totalItems, currentPage, prev, next, pages, seen }
```

<block type="separator" />

## Example: Mixing Listings, Blocks and Paging

A grid can have a mix of listing and static blocks sharing a single paging. The `staticBlocks` helper wraps non-listing blocks so they participate in the shared page window. The listings use Suspense so they load client-side:

### Jsx

```jsx
import { Suspense, useState } from 'react';
import { staticBlocks, expandListingBlocks, ploneFetchItems } from '@hydra-js/hydra.js';

function Grid({ blocks, blocks_layout, pageNum, apiUrl, contextPath }) {
  const pagingInput = { start: pageNum * 6, size: 6 };
  const fetchItems = { listing: ploneFetchItems({ apiUrl, contextPath }) };
  const [gridPaging, setGridPaging] = useState({});

  // Walk layout in order, chaining `seen` for position tracking
  let seen = 0;
  return (
    <div className="grid">
      {blocks_layout.items.map(id => {
        if (fetchItems[blocks[id]['@type']]) {
          const mySeen = seen;
          return (
            <Suspense key={id} fallback={<div>Loading...</div>}>
              <ListingItems id={id} blocks={blocks} paging={pagingInput}
                seen={mySeen} fetchItems={fetchItems} onPaging={setGridPaging} />
            </Suspense>
          );
        }
        const result = staticBlocks([id], { blocks, paging: pagingInput, seen });
        seen = result.paging.seen;
        return result.items.map(item =>
          <Block key={item['@uid']} block={item} />
        );
      })}
      {gridPaging.totalPages > 1 && <Paging paging={gridPaging} />}
    </div>
  );
}

async function ListingItems({ id, blocks, paging, seen, fetchItems, onPaging }) {
  const result = await expandListingBlocks([id], {
    blocks, paging, seen, fetchItems,
  });
  onPaging(result.paging);
  return result.items.map(item => <Block key={item['@uid']} block={item} />);
}
```

**Worked example:** [Listing Block](./examples/listing.md) — the built-in block, with renderers for all four stacks.

## expandListingBlocks Options

- **\`blocks\`** — Map of blockId to block data
- **\`fetchItems\`** — Required. Map of `{ blockType: async (block, { start, size }) => { items, total } }`. Keys declare which block types to expand; values are fetcher functions. Use `ploneFetchItems()` for Plone backends.
- **\`paging\`** — Paging input `{ start, size }` (not mutated). Computed values are returned in the response.
- **\`seen\`** — Number of items already seen by prior calls (default: 0). Chain `paging.seen` from one call to the next for grids.
- **\`itemTypeField\`** — Field on the listing block that holds the item type (default: `'itemType'`)
- **\`defaultItemType\`** — Fallback type when field is not set (default: `'summary'`)

## ploneFetchItems Helper

`ploneFetchItems({ apiUrl, contextPath, extraCriteria })` creates a fetcher function for Plone's `@querystring-search` endpoint, suitable as a value in the `fetchItems` map.

<block type="slateTable" table.fixed table.celled>

| Option | Default | Description |
| --- | --- | --- |
| `apiUrl` | — | Plone site URL (e.g. `'http://localhost:8080/Plone'`) |
| `contextPath` | `'/'` | Path for relative queries |
| `extraCriteria` | `{}` | Additional query params — `SearchableText`, `sort_on`, `sort_order`, `facet.*` keys |

</block>

A listing with no `querystring` defaults to showing the current folder's contents in folder order.

`ploneFetchItems` also normalizes Plone's image data — packaging `image_field` + `image_scales` into a self-contained `image` object with `@id` duplicated inside (needed for URL resolution):

### Json

```json
// Plone search result:
{ "@id": "/news/article", "image_field": "image", "image_scales": { "image": [{ "...": "..." }] } }

// After normalization:
{ "@id": "/news/article", "image": { "@id": "/news/article", "image_field": "image", "image_scales": { "...": "..." } } }
```

This self-contained object has everything needed to resolve image URLs with scale support — see the Nuxt example's `composables/imageProps.js` for one approach.

For non-Plone backends (RSS feeds, external APIs, etc.), write your own fetcher: `async (block, { start, size }) => ({ items, total })`. `start` is the zero-based offset, `size` is the number of items to return (or `0` for total-only), and `total` in the return value is the full count, not just this page.

## Example fetchers

The same `fetchItems` seam powers other "collection" blocks — each is just a fetcher that returns raw result objects (`expandListingBlocks` maps `@id → href` etc. and repeats an item block per result, so they need **no bespoke renderer**; they render via the standard item types on every frontend). `@hydra-js/helpers` ships three reference fetchers:

<block type="slateTable" table.fixed table.celled>

| Fetcher | Block | What it returns |
| --- | --- | --- |
| `relatedItemsFetcher({ apiUrl, contextPath })` | **Related Items** | the current page's relation field (default `relatedItems`) — its summaries, paged |
| `searchShortcutsFetcher({ apiUrl, contextPath })` | **Search Shortcuts** | one link per value, each `@id` set to `${searchUrl}?facet.${index}=${value}` (a shortcut into a search page's facet). A linked `pageField` → this page's values; none → the index's site-wide unique values (e.g. `Keywords` for `Subject`) |
| `rssFetcher()` | **RSS Feed** | entries from `block.feedUrl`, client-side `fetch` (best-effort — a CORS/parse error degrades to an empty feed); each entry's `@id` is its link |

</block>

Register them alongside `listing` in the `fetchItems` map:

### Javascript

```javascript
const { items } = await expandListingBlocks(layout, {
  blocks,
  fetchItems: {
    listing:             ploneFetchItems({ apiUrl, contextPath }),
    relatedItemsListing: relatedItemsFetcher({ apiUrl, contextPath }),
    searchShortcuts:     searchShortcutsFetcher({ apiUrl, contextPath }),
    rssFeed:             rssFetcher(),
  },
});
```

The **Search Shortcuts** link target reads Volto's search-block facet params — a page with a `search` block picks up `?facet.<index>=<value>` from the URL. The block's *index* uses the existing `select_querystring_field` widget; the optional *this-page field* uses `schemaFieldSelect` (a `/@types`-backed field dropdown, parameterized by `fieldType`), which **Related Items** also uses with `fieldType: 'relation'`.

## Field Mapping

`fieldMapping` on a listing block controls which fields appear on expanded items — only mapped fields are included. Default: `{ @id → href, title → title, description → description, image → image }`. Values can be a string (rename) or `{ field, type }` for conversions:

Built-in item types and the fields they expose:

<block type="slateTable" table.fixed table.celled>

| Type | Fields |
| --- | --- |
| `default` | `title`, `description`, `href` |
| `summary` | `title`, `description`, `href`, `image` |
| `teaser` | `title`, `description`, `href`, `preview_image` |

</block>

### Json

```json
"fieldMapping": {
  "@id": { "field": "href", "type": "link" },
  "title": "title",
  "image": { "field": "preview_image", "type": "image" },
  "Subject": { "field": "tags", "type": "string" }
}

Types: string (array→join, image→URL), link (→[{@id}]), image (pass through)
```

**Worked example:** [RSS Feed Block](./examples/rssFeed.md) — feed entries mapped onto the item schema by a fetcher you provide.

## Item Type Selection

Use `variation` on the listing block to control what `@type` expanded items get. Listings reuse the same `inheritSchemaFrom` recipe as container blocks (see [Container Blocks › Synchronised Block Types](./container-blocks.md#synchronised-block-types-in-a-container)) but differ in one structural way: there's no blocks field to declare `itemTypeField` on, since listing children are *virtual* (produced from query results at render time, not authored as page data). Instead, declare the typeField directly on the `inheritSchemaFrom` recipe:

### Javascript

```javascript
listing: {
    blockSchema: {
        properties: {
            variation: {
                widget: 'blockTypeSelect',
                filterConvertibleFrom: '@default',  // only offer types with @default mappings
            },
            // FieldMappingWidget is added at sidebar render time by
            // inheritSchemaFrom (the enhancer reads `mappingField` below);
            // declare an empty placeholder so it appears in the auto-generated
            // default fieldset alongside `variation`.
            fieldMapping: {},
        },
    },
    schemaEnhancer: {
        inheritSchemaFrom: {
            typeField: 'variation',     // listing has no blocks field — declare here
            mappingField: 'fieldMapping',
        },
    },
}
```

`filterConvertibleFrom: '@default'` restricts the dropdown to types that have a `fieldMappings['@default']` entry — i.e. types that can be populated from the canonical content fields (`@id`, `title`, `description`, `image`) that listing queries return. Each item type's `fieldMappings['@default']` (on its own block config) defines how those source fields land on its schema. Adding `mappingField` to the enhancer exposes the `FieldMappingWidget` so the editor can override the mapping per listing instance.

**Worked example:** [Related Items Block](./examples/relatedItemsListing.md) — the page's relation field, drawn with a configurable item type.

### Where the mapping lives

`fieldMappings` (plural, on a **block config**) and `fieldMapping` (singular, on **block data**) are different things, and only the singular one is read at render:

<block type="slateTable" table.fixed table.celled>

|  | `fieldMappings['@default']` | `fieldMapping` |
| --- | --- | --- |
| Lives on | the item type's block config | the listing block's saved data |
| Used by | `FieldMappingWidget`, while **editing** | `expandListingBlocks`, at **render** |
| Role | seeds the widget's smart defaults for the chosen item type | the mapping actually applied to query results |

</block>

The registry mapping is an *editing-time* input: it decides what the widget proposes for the selected `variation`. `expandListingBlocks` never reads a block config — it reads `block.fieldMapping`, and when that is absent falls back to its own default, `{ @id → href, title, description, image }`.

That fallback targets `href`, which suits `link`-shaped item types and not others. A `card`, for example, renders its link from `url`, so a listing of cards with no saved `fieldMapping` produces cards with no link at all.

Two ways to end up with no saved mapping:

- **Hand-authored content.** A listing block written directly into a distribution or fixture JSON never passes through the widget, so nothing is saved. Author `fieldMapping` explicitly.
- **An untouched widget.** `FieldMappingWidget` *displays* `{ ...smartDefaults, ...saved }`, but only persists rows the editor actually changes. Accepting every proposed default without touching a row leaves `fieldMapping` empty — the sidebar shows one mapping while the page renders with another.

If the item type's fields don't match the render-time fallback, set `fieldMapping` on the block rather than relying on the defaults shown in the sidebar.

## Combining Listings with Container Syncing

A container (e.g. `gridBlock`) can mix **manual children** AND **a listing** as children. Add `'listing'` to the blocks field's `allowedBlocks`, and the parent's typeField propagates everywhere:

### Javascript

```javascript
gridBlock: {
    blockSchema: {
        properties: {
            slides: {
                widget: 'blocks_layout',
                itemTypeField: 'variation',
                allowedBlocks: ['teaser', 'image', 'listing'],  // manual items + listing
            },
            variation: {
                widget: 'blockTypeSelect',
                filterConvertibleFrom: '@default',  // keeps 'listing' out of the dropdown
            },
        },
    },
    schemaEnhancer: { inheritSchemaFrom: {} },
}
```

`filterConvertibleFrom: '@default'` keeps `'listing'` out of the dropdown (it's a structural container, not an item type, so it has no `fieldMappings['@default']`) but it stays in `allowedBlocks` so a listing block can still exist as a structural child. The editor sees "Teaser / Image / Summary" in the picker; the listing is a structural choice they don't have to think about.

When the editor changes `gridBlock.variation` to e.g. `'summary'`:

- **Manual children** (a teaser, an image) get their `@type` converted via the destination type's `fieldMappings` — teaser becomes summary.
- **Listing child** keeps `@type: 'listing'` but its own `variation` field is set to `'summary'`, so the listing now renders summary items.

The sync walks recursively — if the listing held nested containers with their own typeFields, those would update too. Net effect: ONE picker on the parent controls the rendered type for every descendant, regardless of whether descendants are authored manually or expanded from a query.

## Path Transformation (pathToApiPath)

If your frontend embeds state in the URL path (like pagination), you need to tell hydra.js how to transform the frontend path to the API/admin path. Otherwise, the admin will try to navigate to URLs that don't exist in the CMS.

### Javascript

```javascript
const bridge = initBridge({
    page: { ... },
    // Transform frontend path to API path by stripping paging segments
    // e.g., /test-page/@pg_block-8-grid_1 -> /test-page
    pathToApiPath: (path) => path.replace(/\/@pg_[^/]+_\d+/, ''),
});
```

The `pathToApiPath` function is called whenever hydra.js sends a `PATH_CHANGE` message to the admin, allowing your frontend to strip or transform URL segments that are frontend-specific (like pagination, filters, or other client-side state).

## Paging Values

Both `expandListingBlocks` and `staticBlocks` return `{ items, paging }`. You pass `{ start, size }` as input (not mutated) and get back computed paging values:

- **\`currentPage\`** (number) — Zero-based current page index
- **\`totalPages\`** (number) — Total number of pages
- **\`totalItems\`** (number) — Total item count across all blocks
- **\`prev\`** (number | null) — Previous page index, or null on first page
- **\`next\`** (number | null) — Next page index, or null on last page
- **\`pages\`** (array) — Window of \~5 page objects: `{ start, page }` where page is 1-based
- **\`seen\`** (number) — Running item count — pass to the next call's `seen` option for position tracking in grids

Neither function mutates the input `paging` object — calling again with the same `{ start, size }` is safe.

When multiple listings share a pager (e.g. a grid with several listings), `expandListingBlocks` walks them sequentially. Each fetch returns `{ items, total }`, so the total is learned from the response and used to compute where the next listing starts. One request per listing. Listings outside the page window are fetched with `size: 0` (total only, no items).

When mixing listings with static blocks in a shared pager, use `staticBlocks(ids, { blocks, paging, seen })` for the non-listing blocks — it tracks their position in the paging window. Chain the returned `paging.seen` to the next call so each block knows its offset (see the React example above).

## Notes

Expanded listing items share the listing block's `@uid`. Selecting any expanded item selects the parent listing block.
