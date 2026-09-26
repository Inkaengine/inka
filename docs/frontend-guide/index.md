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
  - multilingual
  - advanced
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Frontend developer guide

Inka makes an existing frontend editable. You add a small script and a few HTML attributes, and editors compose pages inside the bounds your design system allows — no React or Vue required in the frontend itself. This guide takes you from a running page to custom blocks, live preview, and templates.

## Quick start

Add Inka to a page in your framework. Each tab is a real, working starter — the same source the test suite runs against.

### Nuxt.js

```vue
<!-- pages/[...slug].vue -->
<template>
  <div v-for="id in page?.blocks_layout?.items" :key="id"
       :data-block-uid="editing ? id : undefined">
    <!-- The card block is rendered editable; anything else is shown as raw JSON. -->
    <a v-if="page.blocks[id]['@type'] === 'card'"
       :href="page.blocks[id].link"
       :data-edit-link="editing ? 'link' : undefined">
      <!-- data-edit-media: click to pick/upload image · data-edit-text: edit text in place -->
      <img :src="page.blocks[id].image" :data-edit-media="editing ? 'image' : undefined" />
      <h3 :data-edit-text="editing ? 'title' : undefined">{{ page.blocks[id].title }}</h3>
      <p :data-edit-text="editing ? 'description' : undefined">{{ page.blocks[id].description }}</p>
    </a>
    <pre v-else>{{ JSON.stringify(page.blocks[id], null, 2) }}</pre>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { initBridge } from '@hydra-js/hydra.js'

const page = ref(null)
const editing = ref(false)

onMounted(async () => {
  // Only init the bridge when loaded inside the editor.
  if (window.name.startsWith('hydra')) {
    editing.value = true
    initBridge({
      // Declare the one block type we render richly.
      blocks: { card: { blockSchema: { properties: {
        image: { widget: 'image' },
        title: { type: 'string' },
        description: { type: 'string' },
        link: { widget: 'url' },
      } } } },
      // Re-render on every edit.
      onEditChange: (data) => { page.value = data },
    })
  } else {
    // On the live site: fetch this page and render once.
    page.value = await (await fetch(`/++api++${useRoute().path}`)).json()
  }
})
</script>
```

### Next.js

```jsx
// app/[...slug]/page.jsx
'use client'
import { useState, useEffect } from 'react'
import { initBridge } from '@hydra-js/hydra.js'

export default function Page({ params }) {
  const [page, setPage] = useState(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    // Only init the bridge when loaded inside the editor.
    if (window.name.startsWith('hydra')) {
      setEditing(true)
      initBridge({
        // Declare the one block type we render richly.
        blocks: {
          card: { blockSchema: { properties: {
            image: { widget: 'image' },
            title: { type: 'string' },
            description: { type: 'string' },
            link: { widget: 'url' },
          } } },
        },
        // Re-render on every edit.
        onEditChange: setPage,
      })
    } else {
      // On the live site: fetch this page and render once.
      fetch(`/++api++/${params.slug?.join('/') || ''}`).then((r) => r.json()).then(setPage)
    }
  }, [])

  if (!page) return <div>Loading...</div>

  return page.blocks_layout?.items?.map((id) => {
    const block = page.blocks[id]
    // The card block is rendered editable; anything else is shown as raw JSON.
    if (block['@type'] !== 'card')
      return (
        <pre key={id} data-block-uid={editing ? id : undefined}>
          {JSON.stringify(block, null, 2)}
        </pre>
      )
    return (
      <div key={id} data-block-uid={editing ? id : undefined}>
        <a href={block.link} data-edit-link={editing ? 'link' : undefined}>
          <img src={block.image} data-edit-media={editing ? 'image' : undefined} />
          <h3 data-edit-text={editing ? 'title' : undefined}>{block.title}</h3>
          <p data-edit-text={editing ? 'description' : undefined}>{block.description}</p>
        </a>
      </div>
    )
  })
}
```

### SvelteKit

```svelte
<!-- src/routes/[...slug]/+page.svelte -->
<script>
  import { onMount } from 'svelte'
  import { initBridge } from '@hydra-js/hydra.js'

  let page = $state(null)
  let editing = $state(false)

  onMount(async () => {
    // Only init the bridge when loaded inside the editor.
    if (window.name.startsWith('hydra')) {
      editing = true
      initBridge({
        // Declare the one block type we render richly.
        blocks: { card: { blockSchema: { properties: {
          image: { widget: 'image' },
          title: { type: 'string' },
          description: { type: 'string' },
          link: { widget: 'url' },
        } } } },
        // Re-render on every edit.
        onEditChange: (data) => { page = data },
      })
    } else {
      // On the live site: fetch this page and render once.
      const res = await fetch(`/++api++${window.location.pathname}`)
      page = await res.json()
    }
  })
</script>

{#if page}
  {#each page.blocks_layout?.items ?? [] as id}
    {#if page.blocks[id]['@type'] === 'card'}
      <!-- The card block is rendered editable. -->
      <div data-block-uid={editing ? id : undefined}>
        <a href={page.blocks[id].link} data-edit-link={editing ? 'link' : undefined}>
          <img src={page.blocks[id].image} data-edit-media={editing ? 'image' : undefined} />
          <h3 data-edit-text={editing ? 'title' : undefined}>{page.blocks[id].title}</h3>
          <p data-edit-text={editing ? 'description' : undefined}>{page.blocks[id].description}</p>
        </a>
      </div>
    {:else}
      <!-- Everything else is shown as raw JSON. -->
      <pre data-block-uid={editing ? id : undefined}>{JSON.stringify(page.blocks[id], null, 2)}</pre>
    {/if}
  {/each}
{/if}
```

### HTML/JS

```html
<!-- index.html -->
<div id="content"></div>
<script type="module">
  import { initBridge } from '@hydra-js/hydra.js'

  const editing = window.name.startsWith('hydra')

  if (editing) {
    // In the editor: declare the one block we render richly, and re-render on every edit.
    initBridge({
      blocks: { card: { blockSchema: { properties: {
        image: { widget: 'image' },
        title: { type: 'string' },
        description: { type: 'string' },
        link: { widget: 'url' },
      } } } },
      onEditChange: render,
    })
  } else {
    // On the live site: fetch this page and render once.
    render(await (await fetch(`/++api++${location.pathname}`)).json())
  }

  function render(page) {
    document.getElementById('content').innerHTML =
      page.blocks_layout.items.map((id) => {
        const block = page.blocks[id]
        const uid = editing ? ` data-block-uid="${id}"` : ''
        // The card block is rendered editable; anything else is shown as raw JSON.
        if (block['@type'] !== 'card')
          return `<pre${uid}>${JSON.stringify(block, null, 2)}</pre>`
        return `
          <div${uid}>
            <a href="${block.link}"${editing ? ' data-edit-link="link"' : ''}>
              <img src="${block.image}"${editing ? ' data-edit-media="image"' : ''} />
              <h3${editing ? ' data-edit-text="title"' : ''}>${block.title}</h3>
              <p${editing ? ' data-edit-text="description"' : ''}>${block.description}</p>
            </a>
          </div>`
      }).join('')
  }
</script>
```

### Astro

```astro
---
// src/pages/[...slug].astro
// First paint and every subsequent render come from /api/render — blocks are
// rendered server-side by .astro components via Astro's Container API. The same
// pattern works for PHP, Django, Rails, Laravel: see server-rendered-frontends.md
---
<!DOCTYPE html>
<html>
  <body>
    <div id="content"></div>
    <script>
      import { initBridge } from '@hydra-js/hydra.js'
      if (window.name.startsWith('hydra')) {
        initBridge({
          // Declare the one block type we render richly.
          blocks: { card: { blockSchema: { properties: {
            image: { widget: 'image' },
            title: { type: 'string' },
            description: { type: 'string' },
            link: { widget: 'url' },
          } } } },
          // Server-render mode: the bridge POSTs each smallest-changed-unit to
          // renderEndpoint and swaps the returned HTML into renderContainer.
          renderEndpoint: '/api/render',
          renderContainer: '#content',
        })
      }
    </script>
  </body>
</html>
```

### Astro — /api/render

```typescript
// src/pages/api/render.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import BlockRenderer from '../../components/BlockRenderer.astro'

export const POST = async ({ request }) => {
  const { unit, formData } = await request.json()
  const container = await AstroContainer.create()
  // BlockRenderer.astro emits data-block-uid + data-edit-* attributes — the same
  // DOM contract as the other tabs, just produced server-side.
  const html = await container.renderToString(BlockRenderer, { props: { unit, formData } })
  return new Response(html, { headers: { 'Content-Type': 'text/html' } })
}
```

Next: [Installation](./installation.md) for the full setup, then [Build a frontend](./build-a-frontend.md) for framework specifics.

## In this guide

<block type="listing" data-json='{"headlineTag":"h2","variation":"summary","querystring":{"query":[{"i":"path","o":"plone.app.querystring.operation.string.relativePath","v":".::1"},{"i":"exclude_from_nav","o":"plone.app.querystring.operation.boolean.isFalse","v":""}],"sort_on":"getObjPositionInParent","depth":1},"fieldMapping":{"@id":"href","title":"title","description":"description","image":"image"}}' />
