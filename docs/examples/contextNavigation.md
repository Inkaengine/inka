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
is_folderish: false
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
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" plaintext="${p,h*,ul,ol,blockquote,strong,em/text}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
blocks-tagged: |
  <block type="contextNavigation">
    <region name="items" widget="blocks_layout">
      <block type="navItem" label="${p/text}" href="${p/link}" />
    </region>
  </block>
---

# Context Navigation Block

A vertical navigation list for grouped pages — a left sidebar on desktop and a collapsible disclosure at the top on mobile. Each row is a navItem (hand-added link) and/or a listing (auto-populated from a path query). The active link is detected from the current URL and gets aria-current="page" plus a .current class. Named after Plone's @contextnavigation endpoint, which serves the same purpose.

<block type="contextNavigation" ariaLabel="Section navigation">

<block type="navItem">

[Architecture](/docs/architecture)

</block>

<block type="navItem">

[Custom blocks](/docs/frontend-guide/custom-blocks)

</block>

<block type="navItem">

[Listings](/docs/frontend-guide/listings)

</block>

</block>

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-contextNavigation" fixed=false readOnly=false>

<block type="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: contextNavigation
```

</block>

<block type="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./contextNavigation.md
:block: contextNavigation
:as: json
```

</block>

<block type="codeExample" slotId="rendering">

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
