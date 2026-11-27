---
"@type": Document
UID: 6bd32a3367ea4254b295db642655b9d3
allow_discussion: false
contributors: []
creators:
  - admin
description: The listing block allows the display of various listings of
  content. Editors can configure a number of criteria for listing content (e.g.
  all news from 2022 with the keyword 'research').
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: listing
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - blocks
  - listings
title: Listing
blocks-matched: |
  <block is="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" />
  <block is="title" _="${h1}" />
  <block is="image" description="${p?/textarea}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block is="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block is="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
blocks-tagged: |
  <block is="gridBlock" headline="${h/text}">
    <region name="items" widget="blocks_layout">
      <block is="teaser" title="${h/text}" head_title="${strong?/text}" href="${h/link}" description="${p?/textarea}" />
    </region>
  </block>
  <block is="slider">
    <region name="slides" widget="object_list" idField="@id" typeField="@type">
      <block is="slide" title="${h/text}" head_title="${strong?/text}" description="${p/textarea}" buttonText="${a?/text}" href="${a?/link}" preview_image="${img/link}" />
    </region>
  </block>
---

# Listing

Displays a list of content items from a query. The listing block fetches items from the Plone catalog based on a querystring and renders each item using a configurable item type (variation). Built-in item types are default (title + description) and summary (title + description + image).

<block is="image">

![The listing example block being edited in Inka](../images/listing-edit.png)

</block>

<fields headlineTag="h2">

<fields block="24280e07-e962-4414-8ee5-cdaf58ca5f35">

<block is="listing" headline="Listing: Default" variation="default" :styles='{"backgroundColor":"transparent"}' :querystring='{"b_size":"4","limit":"10","query":[{"i":"portal_type","o":"plone.app.querystring.operation.selection.any","v":["Document"]},{"i":"Subject","o":"plone.app.querystring.operation.selection.none","v":["main folder"]}],"sort_on":"getId","sort_order":"ascending"}' :query="[]" />

<block is="listing" headline="Listing: Summary" :styles='{"backgroundColor":"grey"}' :querystring='{"limit":"5","query":[{"i":"portal_type","o":"plone.app.querystring.operation.selection.any","v":["Document"]},{"i":"Subject","o":"plone.app.querystring.operation.selection.none","v":["main folder"]}],"sort_on":"getId","sort_order":"ascending"}' :query="[]" />

</fields>

<block is="gridBlock" :styles='{"backgroundColor":"transparent"}'>

## Listing: Grid (Teaser)

<block is="listing" :querystring='{"limit":"6","query":[{"i":"portal_type","o":"plone.app.querystring.operation.selection.any","v":["Document"]},{"i":"Subject","o":"plone.app.querystring.operation.selection.none","v":["main folder"]}],"sort_on":"getId","sort_order":"ascending"}' variation="teaser" />

</block>

<block is="slider" headline="Listing: Image Slider" :slides='[{"@type":"listing","querystring":{"query":[{"i":"portal_type","o":"plone.app.querystring.operation.selection.any","v":["Image"]}],"sort_order":"ascending"},"variation":"image"}]' />

</fields>

<defaults templateId="/inka-templates/block-reference-layout" templateInstanceId="tpl-inst-listing">

<fields :fixed="false" :readOnly="false">

<block is="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: listing
```

</block>

<block is="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./listing.md
:block: listing
:as: json
```

</block>

<block is="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/ListingBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/ListingBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/ListingBlock.svelte
:language: svelte
```

</block>

</fields>

</defaults>
