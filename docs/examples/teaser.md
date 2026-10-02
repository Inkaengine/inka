---
"@type": Document
UID: bd2b39d2745847db82ed197a4eb1effc
allow_discussion: false
contributors: []
creators:
  - admin
description: The teaser block allows you to add an element that teases existing
  website content with an image, a title and a description.
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: teaser
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image:
  blob_path: examples/teaser/preview_image/black-starry-night.jpg
  content-type: image/jpeg
  filename: black-starry-night.jpg
  height: 1708
  size: 693013
  width: 2400
review_state: published
rights: ""
subjects:
  - blocks
  - media
title: Teaser
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" plaintext="${p,h*,ul,ol,blockquote,strong,em,a/text}" />
  <block type="title" _="${h1}" />
  <block type="image" description="${p?/textarea}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
blocks-tagged: |
  <block type="teaser" title="${h?/text}" head_title="${strong?/text}" href="${h?/link}" description="${p?/textarea}" />
---

# Teaser

A content preview card that links to another page. Selecting a target page via the object browser auto-fills the title, description, and preview image from that page. Editors can toggle "overwrite" to customize these values.

<block type="image">

![The teaser example block being edited in Inka](../images/teaser-edit.png)

</block>

<block type="teaser">

## [Headline H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum.

<fields styles:align="center" />

</block>

<block type="teaser">

## [Headline H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea.

<fields styles:align="left" />

</block>

<block type="teaser">

## [Headline H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea.

<fields styles:align="right" />

</block>

<block type="teaser">

## [Headline H2](/docs/examples/content-types/page)

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum.

<fields styles:align="center" styles:backgroundColor="grey" />

</block>

<block type="teaser">

## [Headline H2](/docs/examples/content-types/page)

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea.

<fields styles:align="left" styles:backgroundColor="grey" />

</block>

<block type="teaser">

## [Headline H2](/docs/examples/content-types/page)

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea.

<fields styles:align="right" styles:backgroundColor="grey" />

</block>

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-teaser" fixed=false readOnly=false>

<block type="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: teaser
```

</block>

<block type="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./teaser.md
:block: teaser
:as: json
```

</block>

<block type="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/TeaserBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/TeaserBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/TeaserBlock.svelte
:language: svelte
```

</block>

</fields>
