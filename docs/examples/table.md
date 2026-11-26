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
  <block is="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" />
  <block is="title" _="${h1}" />
  <block is="image" description="${p?/textarea}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block is="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block is="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
blocks-tagged: |
  <block is="slateTable">
    <region name="table.rows" idField="key">
      <block is="row" _="${tr}">
        <region name="cells" idField="key" typeField="type">
          <block is="header" value="${th/slate}" />
          <block is="data" value="${td/slate}" />
        </region>
      </block>
    </region>
  </block>
---

# Table

A table with rich text (Slate) content in each cell. Supports adding/removing rows and columns via toolbar actions.

<block is="image">

![The table example block being edited in Inka](../images/table-edit.png)

</block>

<block is="heading" alignment="left" heading="Basic Table" />

<block is="slateTable" table.celled table.fixed>

| Feature | Supported |
| --- | --- |
| **Bold** and *italic* text | Yes |
| A [link](./index.md) | Yes |

</block>

<block is="heading" alignment="left" heading="Stripe alternating rows with colors" />

<block is="slateTable" table.celled table.fixed table.striped>

| Title Tablehead | Title Tablehead | Title Tablehead | Title Tablehead |
| --- | --- | --- | --- |
| Text can be **bold** or *italic* or a [Link](./index.md)&#x20; | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) |
| Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) |
| Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) |
| Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) |

</block>

<fields :styles='{"backgroundColor":"grey"}'>

<block is="heading" alignment="left" heading="Basic Table" />

<block is="slateTable" table.celled table.fixed>

| Title Tablehead | Title Tablehead | Title Tablehead | Title Tablehead |
| --- | --- | --- | --- |
| Text can be **bold** or *italic* or a [Link](./index.md)&#x20; | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) |
| Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) |
| Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) |
| Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) |

</block>

<block is="heading" alignment="left" heading="Stripe alternating rows with colors" />

<block is="slateTable" table.celled table.fixed table.striped>

| Title Tablehead | Title Tablehead | Title Tablehead | Title Tablehead |
| --- | --- | --- | --- |
| Text can be **bold** or *italic* or a [Link](./index.md)&#x20; | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) |
| Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) |
| Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) |
| Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) | Text can be **bold** or *italic* or a [Link](./index.md) |

</block>

</fields>

<defaults templateId="/inka-templates/block-reference-layout" templateInstanceId="tpl-inst-table">

<fields :fixed="false" :readOnly="false">

<block is="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: slateTable
```

<fields slotId="schema-tabs" />

</block>

<block is="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./table.md
:block: slateTable
:as: json
```

<fields slotId="json-data-tabs" />

</block>

<block is="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/TableBlock.jsx
:language: jsx
```

<fields slotId="rendering-tabs" />

### Vue

```{literalinclude} examples/vue/TableBlock.vue
:language: vue
```

<fields slotId="rendering-tabs" />

### Svelte

```{literalinclude} examples/svelte/TableBlock.svelte
:language: svelte
```

<fields slotId="rendering-tabs" />

</block>

</fields>

</defaults>
