---
"@type": Document
UID: docs-examples-contextNavigation-001
allow_discussion: false
contributors: []
creators:
  - admin
description: A vertical navigation list for grouped pages — a left sidebar on
  desktop and a collapsible disclosure at the top on mobile. Each row is a
  navItem (hand-added link) and/or a listing (auto-populated from a path query).
  The active link is detected from the current URL and gets aria-current="page"
  plus a .current class. Named after Plone's @contextnavigation endpoint, which
  serves the same purpose.
effective: null
exclude_from_nav: false
expires: null
id: contextNavigation
language: "##DEFAULT##"
layout: document_view
review_state: published
rights: ""
subjects:
  - blocks
  - navigation
  - templates
title: Context Navigation Block
blocks-matched: |
  <block is="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" />
  <block is="title" _="${h1}" />
  <block is="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block is="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
blocks-tagged: |
  <block is="contextNavigation">
    <region name="items" widget="blocks_layout">
      <block is="navItem" label="${a/text}" href="${a/link}" />
    </region>
  </block>
---

# Context Navigation Block

A vertical navigation list for grouped pages — a left sidebar on desktop and a collapsible disclosure at the top on mobile. Each row is a navItem (hand-added link) and/or a listing (auto-populated from a path query). The active link is detected from the current URL and gets aria-current="page" plus a .current class. Named after Plone's @contextnavigation endpoint, which serves the same purpose.

<block is="contextNavigation">

<block is="navItem">

[Architecture](../architecture.md)

</block>

<block is="navItem">

[Custom blocks](../frontend-guide/custom-blocks.md)

</block>

<block is="navItem">

[Listings](../frontend-guide/listings.md)

</block>

</block>

<defaults templateId="/inka-templates/block-reference-layout" templateInstanceId="tpl-inst-contextNavigation">

<fields :fixed="false" :readOnly="false">

<block is="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: contextNavigation
```

</block>

<block is="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./contextNavigation.md
:block: contextNavigation
:as: json
```

</block>

<block is="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/ContextNavigationBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/ContextNavigationBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/ContextNavigationBlock.svelte
:language: svelte
```

</block>

</fields>

</defaults>
