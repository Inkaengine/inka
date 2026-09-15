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
---

# Grid Block

A horizontal multi-column container. The block has one slot — columns — restricted to column children, capped at four. Each column is itself a container holding any of its allowed inner block types (slate, image, …).

<block type="columns" data-json='{"title":"Our Services","blocks":{"col-1":{"@type":"column","title":"Design","blocks":{"text-1":{"@type":"slate","value":[{"type":"p","children":[{"text":"We craft beautiful interfaces."}]}]}},"blocks_layout":{"items":["text-1"]}},"col-2":{"@type":"column","title":"Engineering","blocks":{"text-2":{"@type":"slate","value":[{"type":"p","children":[{"text":"We build robust systems."}]}]}},"blocks_layout":{"items":["text-2"]}}},"blocks_layout":{"columns":["col-1","col-2"]}}' />

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-columns">

<block type="codeExample" slotId="schema" source="columns" format="schema" />

<block type="codeExample" slotId="json-data" source="columns" format="json" />

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
