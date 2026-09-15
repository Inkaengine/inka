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
is_folderish: true
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
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="image" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
blocks-tagged: |
  <block type="gridBlock" headline="${h/text}">
    <region name="items" widget="blocks_layout">
      <block type="teaser" title="${h/text}" description="${p/text}" />
    </region>
  </block>
  <block type="slider">
    <region name="slides" widget="object_list">
      <block type="slide" title="${h/text}" head_title="${strong?/text}" description="${p/text}" buttonText="${p[2]/text}" href="${p[2]/link}" preview_image="${img/link}" />
    </region>
  </block>
---

# Listing

Displays a list of content items from a query. The listing block fetches items from the Plone catalog based on a querystring and renders each item using a configurable item type (variation). Built-in item types are default (title + description) and summary (title + description + image).

<block type="image">

![The listing example block being edited in Volto Hydra](/docs/images/listing-edit.png)

</block>

<fields headlineTag="h2">

<fields block="24280e07-e962-4414-8ee5-cdaf58ca5f35" data-json='{"query":[]}'>

<block type="listing" headline="Listing: Default" variation="default" data-json='{"querystring":{"b_size":"4","limit":"10","query":[{"i":"portal_type","o":"plone.app.querystring.operation.selection.any","v":["Document"]},{"i":"Subject","o":"plone.app.querystring.operation.selection.none","v":["main folder"]}],"sort_on":"getId","sort_order":"ascending"},"styles":{"backgroundColor":"transparent"}}' />

<block type="listing" headline="Listing: Summary" variation="summary" data-json='{"querystring":{"limit":"5","query":[{"i":"portal_type","o":"plone.app.querystring.operation.selection.any","v":["Document"]},{"i":"Subject","o":"plone.app.querystring.operation.selection.none","v":["main folder"]}],"sort_on":"getId","sort_order":"ascending"},"styles":{"backgroundColor":"grey"}}' />

</fields>

<block type="gridBlock" headline="Listing: Grid (Teaser)" data-json='{"styles":{"backgroundColor":"transparent"},"items":[{"@type":"listing","querystring":{"limit":"6","query":[{"i":"portal_type","o":"plone.app.querystring.operation.selection.any","v":["Document"]},{"i":"Subject","o":"plone.app.querystring.operation.selection.none","v":["main folder"]}],"sort_on":"getId","sort_order":"ascending"},"variation":"teaser"}]}' />

<block type="slider" headline="Listing: Image Slider" data-json='{"autoplayDelay":4000,"autoplayEnabled":false,"autoplayJump":false,"slides":[{"@type":"listing","fieldMapping":{"@id":"href","title":"alt","image":"url"},"querystring":{"query":[{"i":"portal_type","o":"plone.app.querystring.operation.selection.any","v":["Image"]}],"sort_order":"ascending"},"variation":"image"}]}' />

</fields>

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-listing">

<block type="codeExample" slotId="schema" source="listing" format="schema" />

<block type="codeExample" slotId="json-data" source="listing" format="json" />

<block type="codeExample" slotId="rendering">

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
