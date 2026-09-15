---
"@type": Document
UID: 99c70917b6894af08dd306fdbc0eff6a
allow_discussion: false
contributors: []
creators:
  - admin
description: >-
  
  The Grid block allows adding multi-column blocks. A grid block can contain
  between one and four columns of different blocks. Teasers and images can be
  added in a grid block.
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: grid
is_folderish: true
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
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
order:
  - grid-image
  - listing
  - teaser
  - text
---

# Grid

A responsive grid that lays out child blocks in equal-width cells. The block uses Volto's standard shared-blocks shape — blocks is the dict of children, blocks\_layout.items is their order — and constrains the allowed types via allowedBlocks.

<block type="listing" block="616b625c-b79f-4881-8536-b67a9e401a7d" headlineTag="h2" variation="default" data-json='{"query":[]}' />

<block type="slate" data-json='{"value":[{"children":[{"text":""}],"type":"p"}]}' />

<block type="gridBlock" data-json='{"blocks":{"cell-1":{"@type":"teaser","title":"Design","description":"We craft beautiful interfaces that users love.","href":[{"@id":"/docs/architecture"}]},"cell-2":{"@type":"image","url":"https://placehold.co/600x400","alt":"Placeholder"},"cell-3":{"@type":"teaser","title":"Learn More","description":"Explore the full documentation.","href":[{"@id":"/docs"}]}},"blocks_layout":{"items":["cell-1","cell-2","cell-3"]}}' />

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-grid">

<block type="codeExample" slotId="schema" source="gridBlock" format="schema" />

<block type="codeExample" slotId="json-data" source="gridBlock" format="json" />

<block type="codeExample" slotId="rendering">

### React

```{literalinclude} ../examples/react/GridBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} ../examples/vue/GridBlock.vue
:language: vue
```

### Svelte

```{literalinclude} ../examples/svelte/GridBlock.svelte
:language: svelte
```

</block>

</fields>
