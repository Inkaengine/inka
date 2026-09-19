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

<block type="contextNavigation" data-json='{"ariaLabel":"Section navigation","blocks":{"nav-1":{"@type":"navItem","label":"Architecture","href":[{"@id":"/docs/architecture","@type":"Document","Title":"How Inka Works","Description":"Instead of combining editing and rendering into one framework and codebase, these are separated and during editing a two way communication channel is opened across an iframe so that the editing UI is no longer part of the frontend code. Instead a small JS file called hydra.js is included in your frontend during editing that handles the iframe bridge communication to Inka which is running in the same browser window.","title":"How Inka Works","head_title":null,"getRemoteUrl":null,"hasPreviewImage":false,"image_field":""}]},"nav-2":{"@type":"navItem","label":"Custom blocks","href":[{"@id":"/docs/frontend-guide/custom-blocks","@type":"Document","Title":"Custom Blocks","Description":"Define custom block types directly in your frontend configuration via the blocks option in initBridge. No Volto plugin deployment required. Each block type needs an id, title, and a blockSchema with its field properties.","title":"Custom Blocks","head_title":null,"getRemoteUrl":null,"hasPreviewImage":false,"image_field":""}]},"nav-3":{"@type":"navItem","label":"Listings","href":[{"@id":"/docs/frontend-guide/listings","@type":"Document","Title":"Listings &amp; Dynamic Blocks","Description":"A listing block fetches content from the server (e.g. latest news) and renders each result as a separate block, repeating each block once per result entry. This means a listing can be moved between containers and reuse normal blocks for what it repeats.","title":"Listings &amp; Dynamic Blocks","head_title":null,"getRemoteUrl":null,"hasPreviewImage":false,"image_field":""}]}},"blocks_layout":{"items":["nav-1","nav-2","nav-3"]}}' />

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-contextNavigation" data-json='{"fixed":false,"readOnly":false}'>

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
