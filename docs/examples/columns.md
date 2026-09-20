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
is_folderish: false
language: "##DEFAULT##"
layout: document_view
review_state: published
rights: ""
subjects:
  - blocks
  - containers
title: Grid Block
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
blocks-tagged: |
  <block type="columns">
    <region name="columns" widget="blocks_layout">
      <block type="column">
        <region name="items" widget="blocks_layout" />
      </block>
    </region>
  </block>
---

# Grid Block

A horizontal multi-column container. The block has one slot — columns — restricted to column children, capped at four. Each column is itself a container holding any of its allowed inner block types (slate, image, …).

<block type="columns" title="Our Services">

<block type="column" title="Design">

We craft beautiful interfaces.

</block>

<block type="column" title="Engineering">

We build robust systems.

</block>

</block>

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-columns" data-json='{"fixed":false,"readOnly":false}'>

<block type="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: columns
```

</block>

<block type="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./columns.md
:block: columns
:as: json
```

</block>

<block type="codeExample" slotId="rendering">

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
