---
"@type": Document
UID: docs-examples-slider-001
allow_discussion: false
contributors: []
creators:
  - admin
description: A carousel/slider that cycles through slides. Slides are stored as
  an object_list — each slide has a title, description, image, and optional
  button.
effective: null
exclude_from_nav: false
expires: null
id: slider
is_folderish: false
language: "##DEFAULT##"
layout: document_view
review_state: published
rights: ""
subjects:
  - blocks
  - containers
  - media
title: Slider Block
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Slider Block

A carousel/slider that cycles through slides. Slides are stored as an object\_list — each slide has a title, description, image, and optional button.

<block type="slider" data-json='{"autoplayEnabled":false,"autoplayDelay":5000,"slides":[{"@id":"slide-1","@type":"slide","head_title":"New Release","title":"Product Launch 2025","description":"Discover our latest innovations.","preview_image":[{"@id":"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27800%27 height=%27400%27%3E%3Crect width=%27100%25%27 height=%27100%25%27 fill=%27%235577aa%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 fill=%27white%27 text-anchor=%27middle%27 font-size=%2724%27%3ESlide 1%3C/text%3E%3C/svg%3E"}],"buttonText":"Learn More"},{"@id":"slide-2","@type":"slide","head_title":"Featured","title":"Award-Winning Design","description":"Recognized for excellence in UX.","preview_image":[{"@id":"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27800%27 height=%27400%27%3E%3Crect width=%27100%25%27 height=%27100%25%27 fill=%27%23aa5577%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 fill=%27white%27 text-anchor=%27middle%27 font-size=%2724%27%3ESlide 2%3C/text%3E%3C/svg%3E"}],"buttonText":"See Details","hideButton":true}]}' />

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-slider">

<block type="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: slider
```

</block>

<block type="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./slider.md
:block: slider
:as: json
```

</block>

<block type="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/SliderBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/SliderBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/SliderBlock.svelte
:language: svelte
```

</block>

</fields>
