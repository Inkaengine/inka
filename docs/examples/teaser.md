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
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="image" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
blocks-tagged: |
  <block type="teaser" title="${h/text}" href="${h/link}" description="${p/text}" />
---

# Teaser

A content preview card that links to another page. Selecting a target page via the object browser auto-fills the title, description, and preview image from that page. Editors can toggle "overwrite" to customize these values.

<block type="image">

![The teaser example block being edited in Volto Hydra](/docs/images/teaser-edit.png)

</block>

<fields title="Headline H2" data-json='{"href":[{"@id":"/docs/examples/content-types/page","@type":"Document","Description":"The Page content type can be used to display content on a single page of the website. Pages can be structured using text, images and blocks.","Title":"Page","getRemoteUrl":null,"hasPreviewImage":true,"head_title":null,"image_field":"preview_image","title":"Page"}]}'>

<fields head_title="Head title">

<block type="teaser" data-json='{"description":"Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum.","styles":{"align":"center"}}' />

<fields data-json='{"description":"Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea."}'>

<block type="teaser" data-json='{"styles":{"align":"left"}}' />

<block type="teaser" data-json='{"styles":{"align":"right"}}' />

</fields>

</fields>

<block type="teaser" data-json='{"description":"Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum.","styles":{"align":"center","backgroundColor":"grey"}}' />

<fields data-json='{"description":"Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea."}'>

<block type="teaser" data-json='{"styles":{"align":"left","backgroundColor":"grey"}}' />

<block type="teaser" data-json='{"styles":{"align":"right","backgroundColor":"grey"}}' />

</fields>

</fields>

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-teaser">

<block type="codeExample" slotId="schema" source="teaser" format="schema" />

<block type="codeExample" slotId="json-data" source="teaser" format="json" />

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
