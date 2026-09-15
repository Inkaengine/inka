---
"@type": Document
UID: docs-examples-rssFeed-001
allow_discussion: false
contributors: []
creators:
  - admin
description: Renders entries from an external RSS feed, reusing the listing
  machinery. Each entry is rendered with a configurable item type (variation).
effective: null
exclude_from_nav: false
expires: null
id: rssFeed
is_folderish: false
language: "##DEFAULT##"
layout: document_view
review_state: published
rights: ""
subjects:
  - blocks
  - listings
title: RSS Feed Block
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# RSS Feed Block

Renders entries from an external RSS feed. Its items are fetched at render time (by a fetcher you provide) and shown with a configurable item type (variation).

## Live example

<block type="rssFeed" feedUrl="https://pypi.org/rss/project/plone/releases.xml" variation="default" />

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-rssFeed">

<block type="codeExample" slotId="schema" source="rssFeed" format="schema" />

<block type="codeExample" slotId="json-data" source="rssFeed" format="json" />

<fields slotId="rendering">

This block has no bespoke renderer. Add its fetcher to your fetchItems map (keyed by @type) and expandListingBlocks expands it in any region you render — the same seam that powers [listings](../listings.md) and other collection blocks. See [Custom Blocks](../custom-blocks.md) to define the block type. Only the fetcher below is block-specific.

### Fetcher

```javascript
// packages/helpers — client-side, best-effort (CORS-permitting feeds).
export function rssFetcher() {
  return async function fetchItems(block, { start, size }) {
    let entries = [];
    try {
      const res = await fetch(block.feedUrl);
      entries = parseRssEntries(await res.text()); // → [{ '@id': link, title, description, pubDate }]
    } catch {
      return { items: [], total: 0 };              // CORS / parse failure → empty feed, never throws
    }
    if (block.count != null) entries = entries.slice(0, block.count);
    return { items: entries.slice(start, start + size), total: entries.length };
  };
}

// Dependency-free parse so it runs in the browser AND node (no DOMParser):
function parseRssEntries(xml) {
  const out = [];
  const tag = (b, n) => (new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)<\\/${n}>`, 'i').exec(b) || [])[1];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const b = m[1];
    out.push({ '@id': tag(b, 'link') || '', title: tag(b, 'title') || '', description: tag(b, 'description') || '', pubDate: tag(b, 'pubDate') });
  }
  return out;
}
```

<block type="codeExample">

### Render

```javascript
// One fetchItems map, keyed by @type, holds every fetch-based block you use.
const fetchItems = {
  listing: ploneFetchItems({ apiUrl, contextPath }),
  rssFeed: rssFetcher(), // ← this block — just another entry
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
