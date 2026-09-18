---
"@type": Document
UID: docs-frontend-guide-installation-01
allow_discussion: false
contributors: []
creators:
  - admin
description: Get the Inka bridge into your project — prerequisites, loading
  hydra.js, and the minimal initBridge() call that makes a page editable.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
review_state: published
rights: ""
subjects:
  - frontend
title: Installation
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Installation

Adding Inka to a frontend is a small script and a few HTML attributes — there is no SDK to adopt and no framework to switch to. This page covers getting the bridge in; the [Quick Start](./index.md#quick-start) has a copy-paste starter for each framework.

## Prerequisites

- A running Inka admin and content backend for editors to log into (the hosted demo at <https://hydra.pretagov.com> works while you develop).
- A frontend that renders your content — any framework, or none. The bridge only runs when the page is opened inside the admin's edit iframe.

## Load hydra.js

Pull the bridge into the page — from a bundler, or as a plain module script with no build step.

### Bundler

```js
import { initBridge } from '@hydra-js/hydra.js';
```

### Script tag

```html
<script type="module">
  import { initBridge } from '/static/hydra.js';
</script>
```

## Make a page editable

Call `initBridge()` once during page setup. Outside the editor it is a no-op, so it is safe to leave in every page.

### Js

```js
const bridge = initBridge({
  onEditChange: (updatedPage) => {
    // re-render your page from updatedPage — this is what makes edits live
  },
});
```

That is the whole install. From here:

- [Build a frontend](./build-a-frontend.md) — framework-specific code for Nuxt, Next.js, and more.
- [Live preview](./live-preview.md) — how `onEditChange` and the two-way channel work.
- [Server-rendered frontends](./server-rendered-frontends.md) — the pattern for Astro, PHP, Django and other no-JS stacks.
- [Custom blocks](./custom-blocks.md) — the full `initBridge()` options reference.
