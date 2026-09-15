---
"@type": Document
UID: docs-examples-searchShortcuts-001
allow_discussion: false
contributors: []
creators:
  - admin
description: Renders a set of values as links into a faceted search — a "tag
  cloud" of shortcuts. Each value links to a search page with
  ?facet.<index>=<value> pre-set, which a Search block reads from the URL.
effective: null
exclude_from_nav: false
expires: null
id: searchShortcuts
is_folderish: false
language: "##DEFAULT##"
layout: document_view
review_state: published
rights: ""
subjects:
  - blocks
  - listings
title: Search Shortcuts Block
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Search Shortcuts Block

Renders a set of values as links into a faceted search — a "tag cloud" of shortcuts. Each value links to a search page with ?facet.\<index>=\<value> pre-set, which a Search block reads from the URL.

## Live example

<block type="searchShortcuts" index="Subject" searchUrl="/search" variation="default" />

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-searchShortcuts">

<block type="codeExample" slotId="schema" source="searchShortcuts" format="schema" />

<block type="codeExample" slotId="json-data" source="searchShortcuts" format="json" />

<fields slotId="rendering">

This block has no bespoke renderer. Add its fetcher to your fetchItems map (keyed by @type) and expandListingBlocks expands it in any region you render — the same seam that powers [listings](../listings.md) and other collection blocks. See [Custom Blocks](../custom-blocks.md) to define the block type. Only the fetcher below is block-specific.

### Fetcher

```javascript
export function searchShortcutsFetcher({ apiUrl, contextPath }) {
  return async function fetchItems(block, { start, size }) {
    const index = block.index || 'Subject';
    let values;
    if (block.pageField) {
      // Linked field → THIS page's values of that field.
      const content = await (await fetch(`${apiUrl}${contextPath}/++api++`, { headers: authHeaders() })).json();
      values = content[block.pageField] || [];
    } else {
      // No field → all unique values of the index, site-wide (its vocabulary).
      const vocab = index === 'Subject' ? 'plone.app.vocabularies.Keywords' : index;
      const data = await (await fetch(`${apiUrl}/++api++/@vocabularies/${vocab}`, { headers: authHeaders() })).json();
      values = (data.items || []).map((t) => t.token);
    }
    // Each value → a shortcut link; @id is the facet-search URL.
    const all = values.map((v) => ({
      '@id': `${block.searchUrl}?facet.${index}=${encodeURIComponent(v)}`,
      title: v,
    }));
    return { items: all.slice(start, start + size), total: all.length };
  };
}
```

<block type="codeExample">

### Render

```javascript
// One fetchItems map, keyed by @type, holds every fetch-based block you use.
const fetchItems = {
  listing: ploneFetchItems({ apiUrl, contextPath }),
  searchShortcuts: searchShortcutsFetcher({ apiUrl, contextPath }), // ← this block
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
