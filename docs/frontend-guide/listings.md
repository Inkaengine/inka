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
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" />
  <block type="title" _="${h1}" />
  <block type="separator" _="${hr}" styles={"align":"full"} />
  <block type="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
blocks-tagged: |
  <block type="slateTable">
    <region name="table.rows" idField="key">
      <block type="row" _="${tr}">
        <region name="cells" idField="key" typeField="type">
          <block type="header" value="${th/slate}" />
          <block type="data" value="${td/slate}" />
        </region>
      </block>
    </region>
  </block>
---

# Listings & Dynamic Blocks

A listing block fetches content from the server (e.g. latest news) and renders each result as a separate block, repeating each block once per result entry. This means a listing can be moved between containers and reuse normal blocks for what it repeats.

Inka has no listing of its own: your frontend declares it, like any block, with a `title`, a `group` and a `blockSchema` (see [Item Type Selection](#item-type-selection) for the whole declaration).

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
import { staticBlocks, expandListingBlocks, ploneFetchItems } from '@hydra-js/helpers';

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

**Worked example:** [Listing Block](../examples/listing.md) — the declaration, with renderers for all four stacks.

## expandListingBlocks Options

- **\`blocks\`** — Map of blockId to block data
- **\`fetchItems\`** — Required. Map of `{ blockType: async (block, { start, size }) => { items, total } }`. Keys declare which block types to expand; values are fetcher functions. Use `ploneFetchItems()` for Plone backends.
- **\`paging\`** — Paging input `{ start, size }` (not mutated). Computed values are returned in the response.
- **\`seen\`** — Number of items already seen by prior calls (default: 0). Chain `paging.seen` from one call to the next for grids.
- **\`itemTypeField\`** — Required. Field on the listing block that holds the item type: the recipe's `typeField` (e.g. `'variation'`). The editor stores the type there, picked or the one the listing's position allows; a listing without one throws.
- **\`mappingField\`** — Field on the listing block that holds its mapping: the recipe's `mappingField` (default: `'fieldMapping'`).
- **\`defaultsField\`** — Prefix of the listing fields that hold its item defaults, `<defaultsField>_<field>`: the recipe's `defaultsField` (default: `'itemDefaults'`).

The editor saves the item type, the mapping and the item defaults into the listing under the fields its recipe names. `expandListingBlocks` has no recipe, so the frontend that declared those fields passes their names.

## ploneFetchItems Helper

`ploneFetchItems({ apiUrl, contextPath, extraCriteria, mappingField })` creates a fetcher function for Plone's `@querystring-search` endpoint, suitable as a value in the `fetchItems` map.

<block type="slateTable" table.fixed table.celled>

| Option | Default | Description |
| --- | --- | --- |
| `apiUrl` | — | Plone site URL (e.g. `'http://localhost:8080/Plone'`) |
| `contextPath` | `'/'` | Path for relative queries |
| `extraCriteria` | `{}` | Additional query params — `SearchableText`, `sort_on`, `sort_order`, `facet.*` keys |
| `mappingField` | `'fieldMapping'` | Field on the listing block that holds its mapping (the recipe's `mappingField`); a folder-contents listing checks the page's own items carry every mapped field |

</block>

A listing with no `querystring` defaults to showing the current folder's contents in folder order.

The listing's own query is the base, and a `facet.*` narrows within it. Plone keeps one criterion per index, so a facet on an index the listing already restricts is combined with it, never appended: a type facet on a listing of Documents and News Items keeps only the values both allow. A facet value the listing doesn't allow (a stale or hand-edited `?facet.portal_type=Image`) matches nothing, so the listing is empty and the API isn't asked. `buildQuerystringSearchBody` returns `null` for that case.

A search is sorted by the `sort_on` in `extraCriteria`, else by the listing's own, else by date (newest first). To rank the results by relevance, pass `sort_on: null` with a `SearchableText`: the request then names no sort, which is how Plone ranks a text search. Without a `SearchableText` there is nothing to rank, and `sort_on: null` throws.

A search block usually sorts the way Volto's does (plone/volto#4000): a keyword is ranked by relevance unless the reader chose a sort; with no keyword the listing's own sort applies; and a sort the reader chose is dropped when the keyword starts or ends, but kept while one keyword changes to another. Three helpers answer those rules, wherever the frontend keeps the keyword and the chosen sort (the URL, component state):

<block type="slateTable" table.fixed table.celled>

| Helper | Answers |
| --- | --- |
| `hasSearchKeyword(text)` | Is there a keyword? Text with no letter or digit is none, since Plone's text index can't read it. A sort control can disable its Relevance choice without one. |
| `keepsChosenSort(beforeText, nextText)` | Does the reader's chosen sort stay when the search text changes? Not when a keyword starts or ends. |
| `searchSort(text, sortOn, sortOrder)` | The sort part of `extraCriteria`: the chosen sort, else `{ sort_on: null }` (relevance) with a keyword, else nothing (the listing's own). |

</block>

The Nuxt example's search block (`examples/nuxt-blog-starter`) uses all three: its sort control offers Relevance first, shows the chosen sort, else Relevance with a keyword, else the listing's own sort.

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

### Locations: what the path criterion lists

A path criterion's value (Absolute path or Relative path) says where to look, and its last character says whether the folder there is a result:

<block type="slateTable" table.fixed table.celled>

| Value | Lists |
| --- | --- |
| `/news/` | `/news` and everything under it |
| `/news/*` | everything under `/news`, not `/news` |
| `./`, `./*` | this page and everything under it / only what is under it |
| `../`, `../*` | the page's parent and everything under it / only what is under it (the page and its siblings) |
| `/*/` (Relative path) | the page's 2nd-level section (the site root's child it is under; the site root is the 1st level) and everything under it |
| `/*/*/`, `/*/*` (Relative path) | the page's 3rd-level section and everything under it / the 2nd-level section's contents, not the section |
| `<uid>/`, `<uid>/*` (Absolute path) | the folder with that UID, as the editor stores the one picked, and everything under it / only what is under it |

</block>

Plone's `::depth` goes after it as usual (`/news/*::1`, the folder's children only). A value with neither ending (`.`, `..`, `/news`, `.::1`) means what it means to Plone, so everything Volto writes keeps its meaning.

A breadcrumb step (`*` before a `/`, in a Relative path starting with `/`) counts from the top of the page's breadcrumb, so one stored location lists the same section for every page in it; `..` counts from the page instead. A page above the level resolves to itself. Anything but `*` steps there, and a `*` anywhere but last in an Absolute path, throws.

Plone can't say all of this in one search. Whether its folder is a result depends on the depth: in with no depth, `::0` (the folder alone) and `::2` or more; out only at `::1`. So `ploneFetchItems` sends the searches that give the location:

<block type="slateTable" table.fixed table.celled>

| Location | Sent to Plone |
| --- | --- |
| folder in, no depth or `::2`+ | the path, as it is |
| folder in, `::1` | the path `::1`, and the folder alone (`::0`, with the listing's other criteria) put first |
| folder out, `::1` | the path `::1` |
| folder out, no depth or `::2`+ | the path, and the folder left out by its UID (`UID` `selection.none`) |

</block>

`resolveLocation(value, contextPath, { relative })` is exported for a fetcher of your own.

In the editor, a listing's Location criterion is the place, its Depth, and **Children only**:

- **Absolute path**: a folder picked. A first pick is Volto's: its children, depth 1.
- **Relative path**: **2nd level**, **3rd level**, **4th level** (the section of the site the page is in at that level), **Parent** or **Here**. A place the menu doesn't offer (`../news`) is shown as it is.
- **Children only** writes `/*` (only what is under the place) or `/` (the place too). At depth 0 there is only the place, so it isn't offered.

A value Volto wrote (`.::1`, `..`, `<uid>::1`) is shown as Plone reads it (children only at depth 1), and an edit writes it with the ending that keeps that meaning.

### Is the same as this page

A "related" or "more like this" listing compares other pages with the one it is on. The query editor offers **Is the same as this page** as an operation on the indexes a page has a value for: Tags (`Subject`), Type (`portal_type`), Creator, Language, and `getRawRelatedItems` (the pages whose relations name this one). It takes no value: *Tag · Is the same as this page* lists the pages that share any of this page's tags.

`ploneFetchItems` fills it in before it queries. It reads the page's own values (from `contextContent` when that is the page, else by reading the page), sends them as Plone's own "any of", and leaves the page itself out of the results. A page with no value for the index lists nothing, and nothing is asked of Plone. Plone itself needs nothing: the operation, `THIS_PAGE` (`inka.operation.thisPage`), never reaches it. The indexes it is offered on, and the page field each reads, are `THIS_PAGE_FIELDS`; `withThisPageOperation(indexes)` adds it to the indexes Plone describes, as the query editor does.

### Asked from the site root

Plone's `@querystring-search` leaves out the page it is asked from (every page but the site root), whatever the query. `ploneFetchItems` asks every search from the site root, with its relative locations resolved for the page first, so a listing lists exactly what its criteria say. A page in its own section's navigation is listed there; a news item in a listing of `/news/*` is listed too.

## Example fetchers

The same `fetchItems` seam powers other "collection" blocks — each is just a fetcher that returns raw result objects (`expandListingBlocks` maps each result's address, `getURL`, to `href` etc. and repeats an item block per result, so they need **no bespoke renderer**; they render via the standard item types on every frontend). `@hydra-js/helpers` ships three reference fetchers:

<block type="slateTable" table.fixed table.celled>

| Fetcher | Block | What it returns |
| --- | --- | --- |
| `relatedItemsFetcher({ apiUrl, contextPath })` | **Related Items** | the pages related to the current page by a relation field (default `relatedItems`), paged: the ones it names (`direction: 'outgoing'`, the default), the ones naming it (`'incoming'`, from `@relations`), or both |
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

The **Search Shortcuts** link target reads the search block's facet params — a page with a `search` block picks up `?facet.<index>=<value>` from the URL. The block's *index* uses the existing `select_querystring_field` widget; the optional *this-page field* uses `schemaFieldSelect` (a `/@types`-backed field dropdown, parameterized by `fieldType`), which **Related Items** also uses with `fieldType: 'relation'`.

## Field Mapping

`fieldMapping` on a listing block controls which fields appear on expanded items — only mapped fields are included. Each entry is `{ field, type }`: the item field it fills and the conversion that gets it there. Default: `getURL` → `href` (link), `title` → `title` and `description` → `description` (string), `image` → `image` (image_link).

A result's address is mapped from `getURL`, the catalog's name for it, never `@id`: Plone reads every `@id` in a block's stored data as a link, so a stored mapping keyed `@id` with a `{ field, type }` value can't be saved, and a config that maps from `@id` stops the editor loading. A listing saved before the rename keeps its `@id` key and is still read as the address.

The example item types and the fields they expose:

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
  "getURL": { "field": "href", "type": "link" },
  "title": { "field": "title", "type": "string" },
  "image": { "field": "preview_image", "type": "image_link" },
  "Subject": { "field": "tags", "type": "array" }
}

Every entry carries its conversion: the listing is expanded where there is no
schema to work one out, so an entry without one is refused. Types: string
(a list is joined), textarea, slate, link (→ [{@id}]), image_link (the image
with its scales), array, boolean.
```

**Worked example:** [RSS Feed Block](../examples/rssFeed.md) — feed entries mapped onto the item schema by a fetcher you provide.

## Item Type Selection

Use `variation` on the listing block to control what `@type` expanded items get. Listings reuse the same `inheritSchemaFrom` recipe as container blocks (see [Container Blocks › Synchronised Block Types](./container-blocks.md#synchronised-block-types-in-a-container)) but differ in one structural way: there's no blocks field to declare `itemTypeField` on, since listing children are *virtual* (produced from query results at render time, not authored as page data). Instead, declare the typeField directly on the `inheritSchemaFrom` recipe:

### Javascript

```javascript
listing: {
    id: 'listing',
    title: 'Listing',
    group: 'common',
    blockSchema: {
        properties: {
            variation: {
                title: 'Item type',
                widget: 'blockTypeSelect',
                filterConvertibleFrom: '@default',  // only offer types with @default mappings
                blocksField: '..',                  // ...that the listing's container allows
                default: 'summary',                 // preferred, where the container allows it
            },
            querystring: { title: 'Search criteria', widget: 'querystring' },
            // The mapping widget, and what a result offers to map: the
            // fields YOUR fetcher returns (here @querystring-search's). A
            // listing of another kind — related items, a feed — lists the
            // fields its own fetcher returns.
            fieldMapping: {
                title: 'Field mapping',
                widget: 'field_mapping',
                sourceFields: {
                    getURL: { title: 'URL', type: 'string' },
                    title: { title: 'Title', type: 'string' },
                    description: { title: 'Description', type: 'string' },
                    image: { title: 'Lead Image', type: 'image' },
                    effective: { title: 'Published', type: 'date' },
                },
            },
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

The type picker's options go on the type field, never on the recipe: the picker and the recipe both read them there. `blocksField: '..'` takes the choices from the listing's container — a link list that allows only links offers only `link` — and `default` is a preference, kept where the container allows it and otherwise the container's first choice (see [Type field options](./container-blocks.md#type-field-options)). The editor stores the resulting type as the listing lands, so a listing always has one: picked, or the one its position allows.

`filterConvertibleFrom: '@default'` restricts the dropdown to types that have a `fieldMappings['@default']` entry — i.e. types that can be populated from the canonical content fields (`getURL`, `title`, `description`, `image`) that listing queries return. Each item type's `fieldMappings['@default']` (on its own block config) defines how those source fields land on its schema. Adding `mappingField` to the enhancer fills the declared `field_mapping` widget with its smart defaults for the chosen item type, so the editor can override the mapping per listing instance. The widget and its `sourceFields` are yours to declare, as is every other field: the schema you send is the listing's whole schema.

**Worked example:** [Related Items Block](../examples/relatedItemsListing.md) — the page's relation field, drawn with a configurable item type.

### Where the mapping lives

`fieldMappings` (plural, on a **block config**) and `fieldMapping` (singular, on **block data**) are different things, and only the singular one is read at render:

<block type="slateTable" table.fixed table.celled>

|  | `fieldMappings['@default']` | `fieldMapping` |
| --- | --- | --- |
| Lives on | the item type's block config | the listing block's saved data |
| Used by | `FieldMappingWidget`, while **editing** | `expandListingBlocks`, at **render** |
| Role | seeds the widget's smart defaults for the chosen item type | the mapping actually applied to query results |

</block>

The registry mapping is an *editing-time* input: it decides what the widget proposes for the selected `variation`. `expandListingBlocks` never reads a block config — it reads the listing's stored item type and mapping (from the fields the frontend names: `itemTypeField`, `mappingField`), and converts each result by exactly what is stored, so a listing carries its item type and mapping in its own data:

- **The item type is stored as the listing lands.** Picked, or the one its position allows; a listing without one makes `expandListingBlocks` throw, naming it. There is no render-time default.
- **Picking the item type stores its mapping.** The widget's default for that type (the registry mapping, kept to the sources the widget offers) is saved with the block, every entry `{ field, type }` with its conversion from the [mapping rule](./custom-blocks.md#which-fields-map-onto-which). Changing the item type stores the new type's default.
- **There is no fallback.** A listing with no stored `fieldMapping`, or an entry without a `type`, makes `expandListingBlocks` throw, naming the listing: the renderer has no schema to work one out from.
- **It is checked.** A block whose schema has a mapping widget must have a mapping, and every entry must name a source the widget offers, a field the item type has, and a conversion that gives what that field holds. The editor refuses to save one that doesn't, and the content check reports it.

Content that never passes through the editor — a conversion, an import, a fixture — gets what the editor would have stored by running `plone-content field-mappings <content-dir> --schemas <schemas>` over it: the item type's default where there is no mapping, a conversion for every entry without one, and the address under `getURL`. A listing with no item type has no default and is reported. A listing that maps a site's own catalog column needs the site's content types as well, `--content-types <types.json>` (`{ <type>: <its @types/<type> schema> }`), since that is where a column's kind comes from; `plone-content schema` takes the same option.

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

## Folder contents come with the page

A listing asking for exactly **this folder's children, in folder order** (the default for a listing with no criteria: `path` `.::1`, sorted `getObjPositionInParent`, nothing else) is asking the question plone.restapi already answers for every folderish page: the content response's `items`. So `ploneFetchItems` answers it from there instead of `@querystring-search`:

- **From the page's own content, with no request**, when you pass it as `contextContent` and its `items` cover the page asked for and carry every field the listing maps.
- **Otherwise from the content endpoint**: `GET <context>/++api++?b_start=&b_size=&metadata_fields=_all`, a GET a CDN can cache (a `@querystring-search` POST it cannot).

### Javascript

```javascript
const fetchItems = {
  listing: ploneFetchItems({ apiUrl, contextPath, contextContent: content }),
};
```

Any other question (a type filter, search text or a facet from a search block, another sort, a limit, a depth other than 1) is still a `@querystring-search`.

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

A listing with no results still gives back one item while editing: `{ "@uid": <the listing's uid>, "@type": "empty", "readOnly": true }`, so the author has something to click to select the listing and fix its query. Published, it gives back none. Render items by their `@type`, as above, and your `empty` block draws it. A block that renders its items itself, without going through `Block` (chips, a list of links), has to draw an `empty` item as something an author can click, never as an empty link or label: an element with no size can't be selected.
