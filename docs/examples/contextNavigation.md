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
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Context Navigation Block

A vertical navigation list for grouped pages — a left sidebar on desktop and a collapsible disclosure at the top on mobile. Each row is a navItem (hand-added link) and/or a listing (auto-populated from a path query). The active link is detected from the current URL and gets aria-current="page" plus a .current class. Named after Plone's @contextnavigation endpoint, which serves the same purpose.

<block type="contextNavigation" data-json='{"ariaLabel":"Section navigation","blocks":{"nav-1":{"@type":"navItem","label":"Architecture","href":[{"@id":"/docs/architecture"}]},"nav-2":{"@type":"navItem","label":"Custom blocks","href":[{"@id":"/docs/custom-blocks"}]},"nav-3":{"@type":"navItem","label":"Listings","href":[{"@id":"/docs/listings"}]}},"blocks_layout":{"items":["nav-1","nav-2","nav-3"]}}' />

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-contextNavigation">

<block type="codeExample" slotId="schema" source="contextNavigation" format="schema" />

<block type="codeExample" slotId="json-data" source="contextNavigation" format="json" />

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
