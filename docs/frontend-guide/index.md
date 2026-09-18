---
"@type": Document
UID: docs-frontend-guide-000000000001
allow_discussion: false
contributors: []
creators:
  - admin
description: Build a frontend that Inka can edit — add one small script and a
  few HTML attributes, then wire up blocks, live preview, and templates. Start
  with the Quick Start for your framework.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: frontend-guide
is_folderish: true
language: "##DEFAULT##"
layout: document_view
review_state: published
rights: ""
subjects:
  - frontend
title: Frontend developer guide
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
order:
  - installation
  - build-a-frontend
  - server-rendered-frontends
  - live-preview
  - custom-blocks
  - container-blocks
  - visual-editing
  - listings
  - templates
  - advanced
---

# Frontend developer guide

Inka makes an existing frontend editable. You add a small script and a few HTML attributes, and editors compose pages inside the bounds your design system allows — no React or Vue required in the frontend itself. This guide takes you from a running page to custom blocks, live preview, and templates.

## Quick start

Add Inka to a page in your framework. Each tab is a real, working starter — the same source the test suite runs against.

<block type="codeExample">

### Nuxt.js

```{literalinclude} ../../examples/nuxt-blog-starter/pages/quickstart-card.vue
:language: vue
```

### Next.js

```{literalinclude} ../../examples/hydra-nextjs/src/app/quickstart-card/page.jsx
:language: jsx
```

### SvelteKit

```{literalinclude} ../quickstart/svelte/page.svelte
:language: svelte
```

### HTML/JS

```{literalinclude} ../quickstart/vanilla/index.html
:language: html
```

### Astro

```{literalinclude} ../quickstart/astro/page.astro
:language: astro
```

</block>

Next: [Installation](./installation.md) for the full setup, then [Build a frontend](./build-a-frontend.md) for framework specifics.

## In this guide

<block type="listing" headlineTag="h2" variation="summary" data-json='{"querystring":{"query":[{"i":"path","o":"plone.app.querystring.operation.string.relativePath","v":".::1"},{"i":"exclude_from_nav","o":"plone.app.querystring.operation.boolean.isFalse","v":""}],"sort_on":"getObjPositionInParent","depth":1},"fieldMapping":{"@id":"href","title":"title","description":"description","image":"image"}}' />
