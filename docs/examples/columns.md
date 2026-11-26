---
"@type": Document
UID: docs-examples-columns-001
allow_discussion: false
contributors: []
creators:
  - admin
description: A responsive grid layout container. Each cell is a child block
  (teaser, slate, image, etc.) rendered inside the grid. This is the built-in
  Volto grid block (gridBlock).
effective: null
exclude_from_nav: false
expires: null
id: columns
language: "##DEFAULT##"
layout: document_view
review_state: published
rights: ""
subjects:
  - blocks
  - containers
title: Grid Block
blocks-matched: |
  <block is="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" />
  <block is="title" _="${h1}" />
  <block is="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block is="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
blocks-tagged: |
  <block is="columns">
    <region name="columns" widget="blocks_layout">
      <block is="column">
        <region name="items" widget="blocks_layout" />
      </block>
    </region>
  </block>
---

# Grid Block

A horizontal multi-column container. The block has one slot — columns — restricted to column children, capped at four. Each column is itself a container holding any of its allowed inner block types (slate, image, …).

<block is="columns" title="Our Services">

<block is="column" title="Design">

We craft beautiful interfaces.

</block>

<block is="column" title="Engineering">

We build robust systems.

</block>

</block>

<defaults templateId="/inka-templates/block-reference-layout" templateInstanceId="tpl-inst-columns">

<fields :fixed="false" :readOnly="false">

<block is="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: columns
```

</block>

<block is="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./columns.md
:block: columns
:as: json
```

</block>

<block is="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/ColumnsBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/ColumnsBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/ColumnsBlock.svelte
:language: svelte
```

</block>

</fields>

</defaults>
