---
"@type": Document
UID: docs-frontend-guide-installation-01
allow_discussion: false
contributors: []
creators:
  - admin
description: Get the Inka bridge into your project — prerequisites, getting and
  loading hydra.js, and the minimal initBridge() call that makes a page
  editable.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
review_state: published
rights: ""
subjects:
  - frontend
title: Installation
id: installation
is_folderish: false
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

- A running Inka admin and content backend for editors to log into (the hosted demo at [admin.inka.sh](https://admin.inka.sh) works while you develop).
- A frontend that renders your content — any framework, or none. The bridge only runs when the page is opened inside the admin's edit iframe.

## Get the bridge

The bridge is one JavaScript file, `hydra.js`. It is not published to npm, so build it from the Inka repository:

### Shell

```shell
git clone https://github.com/Inkaengine/inka.git
cd inka
make install
pnpm -F @volto-hydra/hydra-js build
```

This writes `packages/hydra-js/hydra.js`: a single ES module with its dependencies bundled in. Copy it into your front end. The [Nuxt example](https://github.com/Inkaengine/inka/tree/main/examples/nuxt-blog-starter) does this in its `sync-hydra` script before every build.

The render helpers used on some pages, such as `expandListingBlocks` and `expandTemplates`, are in `packages/helpers/index.js`, a single ES module with no dependencies. Copy it too if you use them. It is safe to import on the server.

These docs import the two files as `@hydra-js/hydra.js` and `@hydra-js/helpers`. Those are names you give them yourself, with an alias in your bundler (the Nuxt example sets both in `nuxt.config.ts`), or import the files by path instead.

The `hydra` name in the file, the `hydra-edit:` and `hydra-view:` iframe names and the `<!-- hydra -->` comments is Inka's former name, kept for compatibility.

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
