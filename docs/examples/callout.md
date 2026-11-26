---
"@type": Document
UID: docs-examples-callout-001
allow_discussion: false
contributors: []
creators:
  - admin
description: A labelled admonition box — note, tip, warning, or important — with
  a rich-text body. Use it for asides, gotchas, and warnings inside a page.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: callout
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
  <block is="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" />
  <block is="title" _="${h1}" />
  <block is="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block is="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
blocks-tagged: |
  <block is="callout">
    <region name="items" widget="blocks_layout">
      <block is="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" />
    </region>
  </block>
---

# Callout

A labelled admonition box — **note**, **tip**, **warning**, or **important** — with a rich-text body. Use it for asides, gotchas, and warnings inside a page.

This is a **custom** block — register it via `initBridge`. The level is the block's `variation`; the body is a region of child blocks, so it holds real markdown — multiple paragraphs, lists, code.

<block is="callout">

This is a **note** — the default level. The body takes normal markdown: `code`, [links](../frontend-guide/live-preview.md), and multiple paragraphs.

</block>

<block is="callout" variation="tip">

This is a **tip** — for a helpful aside.

</block>

<block is="callout" variation="warning">

This is a **warning** — for something that can bite.

</block>

<block is="callout" variation="important">

This is an **important** — for a must-know gotcha.

</block>

<defaults templateId="/inka-templates/block-reference-layout" templateInstanceId="tpl-inst-callout">

<fields :fixed="false" :readOnly="false">

<block is="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: callout
```

</block>

<block is="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./callout.md
:block: callout
:as: json
```

</block>

<block is="codeExample" slotId="rendering">

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

</defaults>
