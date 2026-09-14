---
"@type": Plone Site
UID: plone_site_root
allow_discussion: null
contributors: []
creators:
  - admin
description: Design-system-first page building. Strike the right balance for
  your site — make it easy for editors to create engagement while staying
  compliant.
effective: null
exclude_from_nav: false
expires: null
id: Plone
is_folderish: true
language: "##DEFAULT##"
review_state: null
rights: ""
subjects: []
table_of_contents: null
title: Inka
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="separator" _="${hr}" styles={"align":"full"} />
  <block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="image" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
blocks-tagged: |
  <block type="gridBlock" headline="${h/text}">
    <region name="items" widget="blocks_layout">
      <block type="teaser" title="${h/text}" description="${p/text}" />
    </region>
  </block>
  <block type="slider">
    <region name="slides" widget="object_list">
      <block type="slide" title="${h/text}" head_title="${strong?/text}" description="${p/text}" buttonText="${p[2]/text}" href="${p[2]/link}" preview_image="${img/link}" />
    </region>
  </block>
order:
  - templates
  - images
  - docs
  - search
blobs:
  - file: image.png
    uid: a5bf990b119747c4b2855fedc1ea0185
    id: plone-foundation.png
    title: Plone Foundation Logo
    exclude_from_nav: false
---

<block type="slate">

# Design-system-first page building

</block>

Strike the right balance for your site. Make it easy for editors to create engagement — while staying compliant.

<block type="slate">

[Try the demo](https://hydra.pretagov.com/login?return_url=/)  ·  [Source on GitHub](https://github.com/collective/volto-hydra)

<fields data-json='{"styles":{"backgroundColor":"grey"}}' />

</block>

## Why Inka

Compliance or engagement is a false choice. You decide where the dial sits for each site.

<block type="image" align="center" size="l" url="/images/quadrant.svg/@@download/image/quadrant.svg" />

<block type="gridBlock">

**Visual Editing**

True WYSIWYG with drag-and-drop blocks. No special frontend framework required — just HTML attributes.

**Multi frontend, multi backend**

Use React, Vue, Nuxt, Next.js, or any stack. Switch between frontends mid-edit for omni-channel delivery.

Use React, Vue, Nuxt, Next.js or any stack, and switch channels mid-edit.

Your frontend is independent code you own. Upgrade the CMS without rewriting your site; switch frameworks and get the same editing experience.

**Open Source**

Secure, scalable Plone backend. Host anywhere, control your costs and security.

</block>

## Quick Start

### Nuxt.js

```vue
<!-- pages/[...slug].vue -->
<template>
  <!-- data-block-uid: makes block selectable, draggable, and editable -->
  <div v-for="id in page?.blocks_layout?.items" :key="id"
       :data-block-uid="editing ? id : undefined">
    <!-- data-edit-link: click to edit link URL in sidebar -->
    <a :href="page.blocks[id].link"
       :data-edit-link="editing ? 'link' : undefined">
      <!-- data-edit-media: click to pick/upload image in sidebar -->
      <img :src="page.blocks[id].image"
           :data-edit-media="editing ? 'image' : undefined" />
      <!-- data-edit-text: edit text directly in the preview -->
      <h3 :data-edit-text="editing ? 'title' : undefined">
        {{ page.blocks[id].title }}
      </h3>
      <p :data-edit-text="editing ? 'description' : undefined">
        {{ page.blocks[id].description }}
      </p>
    </a>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { initBridge } from 'hydra-js'

const page = ref(null)
const editing = ref(false)

onMounted(async () => {
  // Only init bridge when loaded inside the editor
  if (window.name.startsWith('hydra')) {
    editing.value = true
    initBridge({
      // Register custom block types with their field schemas
      blocks: {
        card: { blockSchema: { properties: {
          image: { widget: 'image' },
          title: { type: 'string' },
          description: { type: 'string' },
          link: { widget: 'url' },
        }}}
      },
      // Receive live updates as editor changes content
      onEditChange: (data) => { page.value = data }
    })
  } else {
    const res = await fetch(`/++api++${useRoute().path}`)
    page.value = await res.json()
  }
})
</script>
```

### Next.js

```jsx
// app/[...slug]/page.jsx
'use client'
import { useState, useEffect } from 'react'
import { initBridge } from 'hydra-js'

export default function Page({ params }) {
  const [page, setPage] = useState(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    // Only init bridge when loaded inside the editor
    if (window.name.startsWith('hydra')) {
      setEditing(true)
      initBridge({
        // Register custom block types with their field schemas
        blocks: {
          card: { blockSchema: { properties: {
            image: { widget: 'image' },
            title: { type: 'string' },
            description: { type: 'string' },
            link: { widget: 'url' },
          }}}
        },
        // Receive live updates as editor changes content
        onEditChange: setPage
      })
    } else {
      fetch(`/++api++/${params.slug?.join('/') || ''}`)
        .then(r => r.json()).then(setPage)
    }
  }, [])

  if (!page) return <div>Loading...</div>

  return page.blocks_layout?.items?.map(id => {
    const block = page.blocks[id]
    return (
      // data-block-uid: makes block selectable, draggable, and editable
      <div key={id} data-block-uid={editing ? id : undefined}>
        {/* data-edit-link: click to edit link URL in sidebar */}
        <a href={block.link}
           data-edit-link={editing ? 'link' : undefined}>
          {/* data-edit-media: click to pick/upload image in sidebar */}
          <img src={block.image}
               data-edit-media={editing ? 'image' : undefined} />
          {/* data-edit-text: edit text directly in the preview */}
          <h3 data-edit-text={editing ? 'title' : undefined}>
            {block.title}
          </h3>
          <p data-edit-text={editing ? 'description' : undefined}>
            {block.description}
          </p>
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
  import { initBridge } from 'hydra-js'

  let page = $state(null)
  let editing = $state(false)

  onMount(async () => {
    // Only init bridge when loaded inside the editor
    if (window.name.startsWith('hydra')) {
      editing = true
      initBridge({
        // Register custom block types with their field schemas
        blocks: {
          card: { blockSchema: { properties: {
            image: { widget: 'image' },
            title: { type: 'string' },
            description: { type: 'string' },
            link: { widget: 'url' },
          }}}
        },
        // Receive live updates as editor changes content
        onEditChange: (data) => { page = data }
      })
    } else {
      const res = await fetch(`/++api++${window.location.pathname}`)
      page = await res.json()
    }
  })
</script>

{#if page}
  {#each page.blocks_layout?.items ?? [] as id}
    <!-- data-block-uid: makes block selectable, draggable, and editable -->
    <div data-block-uid={editing ? id : undefined}>
      <!-- data-edit-link: click to edit link URL in sidebar -->
      <a href={page.blocks[id].link}
         data-edit-link={editing ? 'link' : undefined}>
        <!-- data-edit-media: click to pick/upload image in sidebar -->
        <img src={page.blocks[id].image}
             data-edit-media={editing ? 'image' : undefined} />
        <!-- data-edit-text: edit text directly in the preview -->
        <h3 data-edit-text={editing ? 'title' : undefined}>
          {page.blocks[id].title}
        </h3>
        <p data-edit-text={editing ? 'description' : undefined}>
          {page.blocks[id].description}
        </p>
      </a>
    </div>
  {/each}
{/if}
```

### HTML/JS

```html
<!-- index.html -->
<div id="content"></div>
<script type="module">
  import { initBridge } from 'hydra-js'

  let editing = false

  // Only init bridge when loaded inside the editor
  if (window.name.startsWith('hydra')) {
    editing = true
    initBridge({
      // Register custom block types with their field schemas
      blocks: {
        card: { blockSchema: { properties: {
          image: { widget: 'image' },
          title: { type: 'string' },
          description: { type: 'string' },
          link: { widget: 'url' },
        }}}
      },
      // Receive live updates as editor changes content
      onEditChange: renderPage
    })
  } else {
    const res = await fetch(`/++api++${location.pathname}`)
    renderPage(await res.json())
  }

  function renderPage(page) {
    const el = document.getElementById('content')
    el.innerHTML = page.blocks_layout.items.map(id => {
      const b = page.blocks[id]
      return `
        <!-- data-block-uid: makes block selectable, draggable, and editable -->
        <div ${editing ? `data-block-uid="${id}"` : ''}>
          <!-- data-edit-link: click to edit link URL in sidebar -->
          <a href="${b.link}"
             ${editing ? 'data-edit-link="link"' : ''}>
            <!-- data-edit-media: click to pick/upload image in sidebar -->
            <img src="${b.image}"
                 ${editing ? 'data-edit-media="image"' : ''} />
            <!-- data-edit-text: edit text directly in the preview -->
            <h3 ${editing ? 'data-edit-text="title"' : ''}>
              ${b.title}
            </h3>
            <p ${editing ? 'data-edit-text="description"' : ''}>
              ${b.description}
            </p>
          </a>
        </div>`
    }).join('')
  }
</script>
```

### Astro

```astro
<!-- src/pages/[...slug].astro
     First paint and every subsequent render come from /api/render —
     blocks are rendered server-side by .astro components via Astro's
     Container API. Same pattern works for PHP, Django, Rails, Laravel:
     see docs/server-rendered-frontends.md -->
<!DOCTYPE html>
<html>
  <body>
    <div id="content"></div>
    <script>
      import { initBridge } from 'hydra-js'
      if (window.name.startsWith('hydra')) {
        initBridge({
          // Register custom block types with their field schemas
          blocks: {
            card: { blockSchema: { properties: {
              image: { widget: 'image' },
              title: { type: 'string' },
              description: { type: 'string' },
              link: { widget: 'url' },
            }}}
          },
          // Server-render mode (Storyblok-style): the bridge POSTs each
          // smallest-changed-unit to renderEndpoint and swaps the
          // returned HTML into renderContainer.
          renderEndpoint: '/api/render',
          renderContainer: '#content',
        })
      }
    </script>
  </body>
</html>

// src/pages/api/render.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import BlockRenderer from '../../components/BlockRenderer.astro'

export const POST = async ({ request }) => {
  const { unit, formData } = await request.json()
  const container = await AstroContainer.create()
  // BlockRenderer.astro emits data-block-uid + data-edit-* attributes —
  // same DOM contract as the other tabs, just produced server-side.
  const html = await container.renderToString(BlockRenderer, {
    props: { unit, formData },
  })
  return new Response(html, { headers: { 'Content-Type': 'text/html' } })
}
```

<block type="slider" autoplayDelay=4000>

## You can use this site to test Inka

**Welcome to Inka**

You can log in and experience currently working features (Volto like but on any frontend)

[See all Content Types](./docs/examples/content-types/index.md)

![](/images/penguin1.jpg)

<fields flagAlign="left" />

## You are enjoying one of many possible frontends

**Welcome to Inka's many frontends**

Frontend freedom makes it easy to create beautiful and fast experiences

[See all blocks](./docs/examples/index.md)

![](/images/penguin2.jpg)

<fields flagAlign="right" />

</block>

<block type="gridBlock">

<block type="slate" data-json='{"value":[{"children":[{"text":""},{"children":[{"text":""}],"type":"strong"},{"text":"You can use this site to test Inka Edit."}],"type":"p"}]}' />

**Disclaimer**: This instance is reset every night, so all changes will be lost afterwards.

You can **log in** and use it as an admin user using these **credentials**:

username: **admin**

password: **admin**

This site uses some recommended **add-ons**:

- Some blocks that are suitable to be used with volto-light-theme.
- [volto-form-block](https://github.com/collective/volto-form-block)

</block>

---

## View this site in other frameworks

- [NUXT.js Example](https://hydra-nuxt-flowbrite.netlify.app/)
- [Framework7 Example (mobile app)](https://hydra-vue-f7.netlify.app/)
- [Next.js Example](https://hydra-blogsite-nextjs.vercel.app)
- [Edit either of these frontends: hydra.pretagov.com](https://hydra.pretagov.com)

## Find out more about Inka

- [Inka on GitHub — source code, issues, and documentation](https://github.com/collective/volto-hydra)
- [Plone 6 Documentation](https://6.docs.plone.org)
- [Plone Community Forum](https://community.plone.org)
