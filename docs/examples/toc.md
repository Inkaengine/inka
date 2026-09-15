---
"@type": Document
UID: 3906609d0456404ca7146f6aa1f12f32
allow_discussion: false
contributors: []
creators:
  - admin
description: The table of contents block automatically generates a table of
  contents with links to the corresponding positions on the page from the
  headings used.
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: toc
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image:
  blob_path: examples/toc/preview_image/black-starry-night.jpg
  content-type: image/jpeg
  filename: black-starry-night.jpg
  height: 1708
  size: 693013
  width: 2400
review_state: published
rights: ""
subjects:
  - blocks
  - navigation
title: Table of Contents
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="separator" _="${hr}" styles={"align":"full"} />
  <block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="image" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Table of Contents

Renders a table of contents generated from heading blocks on the current page. It scans sibling blocks for headings and builds a navigation list.

<block type="image">

![The toc example block being edited in Volto Hydra](/docs/images/toc-edit.png)

</block>

<block type="toc" title="Inhaltsverzeichnis" variation="default" />

---

<block type="image" align="wide" copyright_and_sources="Copyright: unsplash.com" description="Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt." size="l" title="Title Image" url="/docs/examples/content-types/image-dark" data-json='{"styles":{"size:noprefix":"large"}}' />

<block type="introduction" data-json='{"value":[{"children":[{"text":"Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. "}],"type":"p"}]}' />

---

## Text Heading H2&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

### Text Heading H3

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

## Lists

1. Ordered List Bullett Point One&#x20;
2. Ordered List Bullett Point Two&#x20;
3. Ordered List Bullett Point Three
4. Ordered List Bullett Point Four

- Ordered List Bullett Point One&#x20;
- Ordered List Bullett Point Two&#x20;
- Ordered List Bullett Point Three
- Ordered List Bullett Point Four

### Inline Styles

Text can be **bold** or *italic*.

[Link internal](./heading.md)

[Link external](https://www.google.com/)

<block type="separator">

---

<fields data-json='{"styles":{"align":"left"}}' />

</block>

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-toc">

<block type="codeExample" slotId="schema" source="toc" format="schema" />

<block type="codeExample" slotId="json-data" source="toc" format="json" />

<block type="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/TocBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/TocBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/TocBlock.svelte
:language: svelte
```

</block>

</fields>
