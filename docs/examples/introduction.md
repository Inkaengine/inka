---
"@type": Document
UID: 00cef5f245a342958288ace545e3c097
allow_discussion: false
contributors: []
creators:
  - admin
description: >-
  
  The introductory block allows the display of an introductory text, which is
  displayed larger than normal continuous text.
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: introduction
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image:
  blob_path: examples/introduction/preview_image/black-starry-night.jpg
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
title: Introduction
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

# Introduction

Displays the page's title and description as a styled header. The introduction block has no content of its own — it reads title and description from the page metadata.

<block type="image">

![The introduction example block being edited in Volto Hydra](/docs/images/introduction-edit.png)

</block>

---

<block type="introduction" data-json='{"value":[{"children":[{"text":"Highlight Title H2 "}],"type":"h2"}]}' />

Lorem ipsum vitae elit libero, a pharetra augue. Nulla vitae elit libero, a pharetra augue. Duis mollis, est non commodo luctus, nisi erat porttitor ligula, eget lacinia odio sem nec elit. Donec ullamcorper nulla non metus auctor fringilla. Vivamus sagittis lacus vel augue laoreet rutrum faucibus dolor auctor. Vestibulum id ligula porta felis euismod semper.

---

## Headline H2

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-introduction">

<block type="codeExample" slotId="schema" source="introduction" format="schema" />

<block type="codeExample" slotId="json-data" source="introduction" format="json" />

<block type="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/IntroductionBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/IntroductionBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/IntroductionBlock.svelte
:language: svelte
```

</block>

</fields>
