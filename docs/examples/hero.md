---
"@type": Document
UID: docs-examples-hero-001
allow_discussion: false
contributors: []
creators:
  - admin
description: "A full-width hero section with heading, subheading, image, rich
  text description, and a call-to-action button. Demonstrates multiple field
  types in a single block: string, textarea, slate, image, and object_browser."
effective: null
exclude_from_nav: false
expires: null
id: hero
is_folderish: false
language: "##DEFAULT##"
layout: document_view
review_state: published
rights: ""
subjects:
  - blocks
  - media
title: Hero Block
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" plaintext="${p,h*,ul,ol,blockquote,strong,em,a/text}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
blocks-tagged: |
  <block type="hero" heading="${h1/text}" subheading="${strong?/textarea}" description="${p?/slate}" buttonText="${a?/text}" buttonLink="${a?/link}" image="${img?/src}" />
---

# Hero Block

A full-width hero section with heading, subheading, image, rich text description, and a call-to-action button. Demonstrates multiple field types in a single block: string, textarea, slate, image, and object\_browser.

<block type="hero">

# Welcome to Our Site

**Discover amazing content\
across multiple lines**

We build tools that make content editing delightful.

[Get Started](/docs/frontend-guide/build-a-frontend)

![](<data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27800%27 height=%27400%27%3E%3Crect width=%27100%25%27 height=%27100%25%27 fill=%27%234a90d9%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 fill=%27white%27 text-anchor=%27middle%27 font-size=%2724%27%3EHero Image%3C/text%3E%3C/svg%3E>)

</block>

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-hero" fixed=false readOnly=false>

<block type="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: hero
```

</block>

<block type="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./hero.md
:block: hero
:as: json
```

</block>

<block type="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/HeroBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/HeroBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/HeroBlock.svelte
:language: svelte
```

</block>

</fields>
