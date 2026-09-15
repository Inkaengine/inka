---
"@type": Document
UID: docs-examples-callout-001
allow_discussion: false
contributors: []
creators:
  - admin
description: >-
  A labelled admonition box — note, tip, warning, or important — with a
  rich-text body. Use it for asides, gotchas, and warnings inside a page.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: callout
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - blocks
  - text
title: Callout
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="callout">
    <region name="items" widget="blocks_layout">
      <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
    </region>
  </block>
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Callout

A labelled admonition box — **note**, **tip**, **warning**, or **important** — with a rich-text body. Use it for asides, gotchas, and warnings inside a page.

This is a **custom** block — register it via `initBridge`. The level is the block's `variation`; the body is a region of child blocks, so it holds real markdown — multiple paragraphs, lists, code.

<block type="callout" variation="note">

This is a **note** — the default level. The body takes normal markdown: `code`, [links](../live-preview.md), and multiple paragraphs.

</block>

<block type="callout" variation="tip">

This is a **tip** — for a helpful aside.

</block>

<block type="callout" variation="warning">

This is a **warning** — for something that can bite.

</block>

<block type="callout" variation="important">

This is an **important** — for a must-know gotcha.

</block>

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-callout">

<block type="codeExample" slotId="schema" source="callout" format="schema" />

<block type="codeExample" slotId="json-data" source="callout" format="json" />

<block type="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/CalloutBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/CalloutBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/CalloutBlock.svelte
:language: svelte
```

### Astro

```{literalinclude} examples/astro/CalloutBlock.astro
:language: astro
```

</block>

</fields>
