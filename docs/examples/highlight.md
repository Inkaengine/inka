---
"@type": Document
UID: 8416628543f146ff9a18d281c03e2399
allow_discussion: false
contributors: []
creators:
  - admin
description: The highlight block allows you to highlight and tease a single
  piece of content. The content is displayed with a large image and a title and
  description in a banderole.
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: highlight
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image:
  blob_path: examples/highlight/preview_image/black-starry-night.jpg
  content-type: image/jpeg
  filename: black-starry-night.jpg
  height: 1708
  size: 693013
  width: 2400
review_state: published
rights: ""
subjects:
  - blocks
  - text
title: Highlight
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
  <block type="highlight" description="${p/slate}" cta_link="${a?/link}" />
---

# Highlight

A prominent content section with a background image, overlay, title, rich text body, and an optional call-to-action link. Used for feature callouts and banners.

<block type="image">

![The highlight example block being edited in Inka](../images/highlight-edit.png)

</block>

<fields title="Highlight-Block" cta_title="Button" image="/docs/examples/content-types/example-image.jpg/@@images/image">

<block type="highlight">

Lorem ipsum dolor sit amet, [consetetur sadipscing](./button.md) elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt.

[](/docs/examples/content-types/page)

<fields styles:descriptionColor="highlight-custom-color-1" />

</block>

<block type="highlight">

Lorem ipsum dolor sit amet, [consetetur sadipscing](./button.md) elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt.

[](/docs/examples/content-types/page)

<fields styles:descriptionColor="highlight-custom-color-2" />

</block>

<block type="highlight">

Lorem ipsum dolor sit amet, [consetetur sadipscing](./button.md) elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt.

[](/docs/examples/content-types/page)

<fields styles:descriptionColor="highlight-custom-color-3" />

</block>

<block type="highlight">

Lorem ipsum dolor sit amet, [consetetur sadipscing](./button.md) elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt.

[](/docs/examples/content-types/page)

<fields styles:descriptionColor="highlight-custom-color-4" />

</block>

<block type="highlight">

Lorem ipsum dolor sit amet, [consetetur sadipscing](./button.md) elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt.

[](/docs/examples/content-types/page)

<fields styles:descriptionColor="highlight-custom-color-5" />

</block>

</fields>

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-highlight" fixed=false readOnly=false>

<block type="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: highlight
```

</block>

<block type="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./highlight.md
:block: highlight
:as: json
```

</block>

<block type="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/HighlightBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/HighlightBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/HighlightBlock.svelte
:language: svelte
```

</block>

</fields>
