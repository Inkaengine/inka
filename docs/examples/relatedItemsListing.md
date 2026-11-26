---
"@type": Document
UID: docs-examples-relatedItemsListing-001
allow_discussion: false
contributors: []
creators:
  - admin
description: Renders the current page's related items relation field (default
  relatedItems) as a list, reusing the listing machinery — each related item is
  rendered with a configurable item type (variation).
effective: null
exclude_from_nav: false
expires: null
id: relatedItemsListing
language: "##DEFAULT##"
layout: document_view
review_state: published
rights: ""
subjects:
  - blocks
  - listings
title: Related Items Block
blocks-matched: |
  <block is="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" />
  <block is="title" _="${h1}" />
  <block is="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block is="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
---

# Related Items Block

Renders the pages related to the current page by one of its relation fields (default relatedItems). Its items are fetched at render time and shown with a configurable item type (variation).

**Direction** says which way the relation runs. Plone keeps a relation on the page that makes it, so a page names its related pages, but the pages that name it hold nothing on it:

- **This page's related items** (`outgoing`, the default): the pages this page's field names, in its order.
- **Pages relating to this one** (`incoming`): the pages whose same field names this page, from plone.restapi's relation catalog (`@relations?target=<UID>&relation=<field>`). A relation whose page the visitor can't view is left out. With it, relating two pages once lists each on the other.
- **Both**: this page's related items, then the pages relating to it, each page once.

## Live example

<block is="relatedItemsListing" relationField="relatedItems" />

<defaults templateId="/inka-templates/block-reference-layout" templateInstanceId="tpl-inst-relatedItemsListing">

<fields :fixed="false" :readOnly="false">

<block is="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: relatedItemsListing
```

</block>

<block is="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./relatedItemsListing.md
:block: relatedItemsListing
:as: json
```

</block>

<fields slotId="rendering">

This block has no bespoke renderer. Add its fetcher to your fetchItems map (keyed by @type) and expandListingBlocks expands it in any region you render — the same seam that powers [listings](../frontend-guide/listings.md) and other collection blocks. See [Custom Blocks](../frontend-guide/custom-blocks.md) to define the block type. Only the fetcher below is block-specific.

### Fetcher

```javascript
export function relatedItemsFetcher({ apiUrl, contextPath }) {
  return async function fetchItems(block, { start, size }) {
    const field = block.relationField || 'relatedItems';
    const direction = block.direction || 'outgoing';
    const content = await (await fetch(`${apiUrl}${contextPath}/++api++`, { headers: authHeaders() })).json();
    const outgoing = direction === 'incoming' ? [] : content[field] || [];
    let incoming = [];
    if (direction !== 'outgoing') {
      const query = new URLSearchParams({ target: content.UID, relation: field });
      const rel = await (await fetch(`${apiUrl}/++api++/@relations?${query}`, { headers: authHeaders() })).json();
      incoming = rel.relations[field].items.map((relation) => relation.source);
    }
    const seen = new Set();
    const all = [...outgoing, ...incoming].filter((item) => !seen.has(item['@id']) && seen.add(item['@id']));
    return { items: all.slice(start, start + size), total: all.length };
  };
}
```

<block is="codeExample">

### Render

```javascript
// One fetchItems map, keyed by @type, holds every fetch-based block you use.
const fetchItems = {
  listing: ploneFetchItems({ apiUrl, contextPath }),
  relatedItemsListing: relatedItemsFetcher({ apiUrl, contextPath }), // ← this block
};

// Call this on each region you render (the list of block ids in that region).
const { items } = await expandListingBlocks(regionBlockIds, {
  blocks, fetchItems, itemTypeField: 'variation',
});
items.forEach((item) => renderBlock(item)); // your normal per-block renderer
```

</block>

</fields>

</fields>

</defaults>
