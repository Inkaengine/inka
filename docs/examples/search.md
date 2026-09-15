---
"@type": Document
UID: 928010d84e5d4df2b2282f3e179d6b1a
allow_discussion: false
contributors: []
creators:
  - admin
description: The search block allows the content of the website to be listed.
  Users can use so-called facets to select certain properties of the listed
  content in order to filter them (e.g. filtering the news of 2022).
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: search
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image:
  blob_path: examples/search/preview_image/black-starry-night.jpg
  content-type: image/jpeg
  filename: black-starry-night.jpg
  height: 1708
  size: 693013
  width: 2400
review_state: published
rights: ""
subjects:
  - blocks
  - listings
  - navigation
title: Search
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="image" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Search

A search interface with faceted filtering. Contains a child listing block for results and typed facets (checkbox, select, date range, toggle) for filtering.

<block type="image">

![The search example block being edited in Volto Hydra](/docs/images/search-edit.png)

</block>

<fields data-json='{"query":{"b_size":"4","query":[{"i":"path","o":"plone.app.querystring.operation.string.absolutePath","v":"/"}],"sort_on":"effective","sort_order":"descending"},"showSearchInput":true,"showSortOn":true,"showTotalResults":true}'>

<block type="search" headline="Search with Facets" listingBodyTemplate="summary" facetsTitle="Filter by" data-json='{"facets":[{"@id":"facet-type","type":"checkboxFacet","title":"Content Type","field":{"value":"portal_type","label":"Type"},"multiple":true,"hidden":false},{"@id":"facet-subject","type":"checkboxFacet","title":"Tags","field":{"value":"Subject","label":"Tags"},"multiple":true,"hidden":false}],"blocks":{"facet-listing":{"@type":"listing","variation":"summary","querystring":{"query":[{"i":"path","o":"plone.app.querystring.operation.string.absolutePath","v":"/"}],"sort_on":"effective","sort_order":"descending"}}},"blocks_layout":{"listing":["facet-listing"]}}' />

<block type="search" headline="Simple Search" data-json='{"blocks":{"simple-listing":{"@type":"listing","variation":"default","querystring":{"query":[{"i":"path","o":"plone.app.querystring.operation.string.absolutePath","v":"/"}],"sort_on":"effective","sort_order":"descending"}}},"blocks_layout":{"listing":["simple-listing"]}}' />

</fields>

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-search">

<block type="codeExample" slotId="schema" source="search" format="schema" />

<block type="codeExample" slotId="json-data" source="search" format="json" />

<block type="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/SearchBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/SearchBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/SearchBlock.svelte
:language: svelte
```

</block>

</fields>
