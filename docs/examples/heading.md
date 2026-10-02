---
"@type": Document
UID: 2f69aa417e894fd3bf23d393287b369e
allow_discussion: false
contributors: []
creators:
  - admin
description: The heading block allows you to display headings to group multiple
  blocks under one topic.
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: heading
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: null
subjects:
  - blocks
  - text
title: Heading
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" plaintext="${p,h*,ul,ol,blockquote,strong,em,a/text}" />
  <block type="title" _="${h1}" />
  <block type="separator" _="${hr}" styles={"align":"full"} />
  <block type="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
blocks-tagged: |
  <block type="teaser" title="${h?/text}" head_title="${strong?/text}" href="${h?/link}" description="${p?/textarea}" />
  <block type="introduction" value="${p,h*/slate}" />
  <block type="gridBlock" headline="${h/text}">
    <region name="items" widget="blocks_layout">
      <block type="teaser" title="${h/text}" head_title="${strong?/text}" href="${h/link}" description="${p?/textarea}" />
    </region>
  </block>
---

# Heading

A standalone heading block that renders as h1–h6 based on a configurable tag field. Unlike headings inside a slate block, this is a dedicated block type with its own heading text field.

<block type="separator">

---

<fields styles:align="full" styles:backgroundColor="transparent" styles:noLine=false />

</block>

<block type="introduction">

Lorem ipsum vitae elit libero, a pharetra augue. Nulla vitae elit libero, a pharetra augue. Duis mollis, est non commodo luctus, nisi erat porttitor ligula, eget lacinia odio sem nec elit. Donec ullamcorper nulla non metus auctor fringilla. Vivamus sagittis lacus vel augue laoreet rutrum faucibus dolor auctor. Vestibulum id ligula porta felis euismod semper.

</block>

---

<block type="introduction">

## Highlight Title H2&#x20;

</block>

Lorem ipsum vitae elit libero, a pharetra augue. Nulla vitae elit libero, a pharetra augue. Duis mollis, est non commodo luctus, nisi erat porttitor ligula, eget lacinia odio sem nec elit. Donec ullamcorper nulla non metus auctor fringilla. Vivamus sagittis lacus vel augue laoreet rutrum faucibus dolor auctor. Vestibulum id ligula porta felis euismod semper.

---

## Headline H2

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

### Headline H3

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

---

<block type="gridBlock">

## Block Title

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<fields styles:align="left" />

</block>

</block>

<block type="heading" heading="Getting Started" tag="h2" />

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-heading" fixed=false readOnly=false>

<block type="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: heading
```

</block>

<block type="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./heading.md
:block: heading
:as: json
```

</block>

<block type="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/HeadingBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/HeadingBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/HeadingBlock.svelte
:language: svelte
```

</block>

</fields>
