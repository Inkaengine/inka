---
"@type": Document
UID: 99c70917b6894af08dd306fdbc0eff6a
allow_discussion: false
contributors: []
creators:
  - admin
description: The Grid block allows adding multi-column blocks. A grid block can
  contain between one and four columns of different blocks. Teasers and images
  can be added in a grid block.
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: grid
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image:
  blob_path: examples/grid/preview_image/black-starry-night.jpg
  content-type: image/jpeg
  filename: black-starry-night.jpg
  height: 1708
  size: 693013
  width: 2400
review_state: published
rights: ""
subjects:
  - blocks
  - containers
title: Grid
order:
  - grid-image
  - listing
  - teaser
  - text
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
  <block is="teaser" title="${h?/text}" head_title="${strong?/text}" href="${h?/link}" description="${p?/textarea}" />
  <block is="gridBlock" headline="${h/text}">
    <region name="items" widget="blocks_layout">
      <block is="teaser" title="${h/text}" head_title="${strong?/text}" href="${h/link}" description="${p?/textarea}" />
    </region>
  </block>
---

# Grid

A responsive grid that lays out child blocks in equal-width cells. The block uses Volto's standard shared-blocks shape — blocks is the dict of children, blocks_layout.items is their order — and constrains the allowed types via allowedBlocks.

<block is="listing" block="616b625c-b79f-4881-8536-b67a9e401a7d" headlineTag="h2" variation="default" :query="[]" />

<block is="slate">

</block>

<block is="gridBlock">

<block is="teaser">

### [Design](../../architecture.md)

We craft beautiful interfaces that users love.

</block>

![Placeholder](https://placehold.co/600x400)

<block is="teaser">

### [Learn More](../../index.md)

Explore the full documentation.

</block>

</block>

<defaults templateId="/inka-templates/block-reference-layout" templateInstanceId="tpl-inst-grid">

<fields :fixed="false" :readOnly="false">

<block is="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: gridBlock
```

<fields slotId="schema-tabs" />

</block>

<block is="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./index.md
:block: gridBlock
:as: json
```

<fields slotId="json-data-tabs" />

</block>

<block is="codeExample" slotId="rendering">

### React

```{literalinclude} ../examples/react/GridBlock.jsx
:language: jsx
```

<fields slotId="rendering-tabs" />

### Vue

```{literalinclude} ../examples/vue/GridBlock.vue
:language: vue
```

<fields slotId="rendering-tabs" />

### Svelte

```{literalinclude} ../examples/svelte/GridBlock.svelte
:language: svelte
```

<fields slotId="rendering-tabs" />

</block>

</fields>

</defaults>
