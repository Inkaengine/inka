---
"@type": Document
UID: 102f648399914851951ffa3fefc8665c
allow_discussion: false
contributors: []
creators:
  - admin
description: The Table block allows you to add a table to a page.
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: table
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image:
  blob_path: examples/table/preview_image/black-starry-night.jpg
  content-type: image/jpeg
  filename: black-starry-night.jpg
  height: 1708
  size: 693013
  width: 2400
review_state: published
rights: ""
subjects:
  - blocks
title: Table
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

# Table

A table with rich text (Slate) content in each cell. Supports adding/removing rows and columns via toolbar actions.

<block type="image">

![The table example block being edited in Volto Hydra](/docs/images/table-edit.png)

</block>

<block type="heading" alignment="left" heading="Basic Table" tag="h2" />

<block type="slateTable" table.celled table.fixed>

| Feature | Supported |
| --- | --- |
| **Bold** and *italic* text | Yes |
| A [link](./index.md) | Yes |

</block>

<block type="heading" alignment="left" heading="Stripe alternating rows with colors" tag="h2" />

<block type="slateTable" table.celled table.fixed table.striped>

| Title Tablehead | Title Tablehead | Title Tablehead | Title Tablehead |
| --- | --- | --- | --- |
| Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md)&#x20; | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) |
| Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) |
| Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) |
| Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) |

</block>

<fields data-json='{"styles":{"backgroundColor":"grey"}}'>

<block type="heading" alignment="left" heading="Basic Table" tag="h2" />

<block type="slateTable" table.celled table.fixed>

| Title Tablehead | Title Tablehead | Title Tablehead | Title Tablehead |
| --- | --- | --- | --- |
| Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md)&#x20; | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) |
| Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) |
| Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) |
| Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) |

</block>

<block type="heading" alignment="left" heading="Stripe alternating rows with colors" tag="h2" />

<block type="slateTable" table.celled table.fixed table.striped>

| Title Tablehead | Title Tablehead | Title Tablehead | Title Tablehead |
| --- | --- | --- | --- |
| Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md)&#x20; | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) |
| Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) |
| Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) |
| Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) | Heading H2Heading H3Text can be **bold** or *italic* or a [Link](./index.md) |

</block>

</fields>

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-table">

<block type="codeExample" slotId="schema" source="slateTable" format="schema" />

<block type="codeExample" slotId="json-data" source="slateTable" format="json" />

<block type="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/TableBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/TableBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/TableBlock.svelte
:language: svelte
```

</block>

</fields>
