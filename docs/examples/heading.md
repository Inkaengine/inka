---
"@type": Document
UID: 2f69aa417e894fd3bf23d393287b369e
allow_discussion: false
contributors: []
creators:
  - admin
description: >-
  
  The heading block allows you to display headings to group multiple blocks
  under one topic.
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
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="separator" _="${hr}" styles={"align":"full"} />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
blocks-tagged: |
  <block type="teaser" title="${h/text}" href="${h/link}" description="${p/text}" />
  <block type="gridBlock" headline="${h/text}">
    <region name="items" widget="blocks_layout">
      <block type="teaser" title="${h/text}" description="${p/text}" />
    </region>
  </block>
---

# Heading

A standalone heading block that renders as h1–h6 based on a configurable tag field. Unlike headings inside a slate block, this is a dedicated block type with its own heading text field.

<block type="separator">

---

<fields data-json='{"styles":{"align":"full","backgroundColor":"transparent","noLine":false}}' />

</block>

<block type="introduction" data-json='{"value":[{"children":[{"text":"Lorem ipsum vitae elit libero, a pharetra augue. Nulla vitae elit libero, a pharetra augue. Duis mollis, est non commodo luctus, nisi erat porttitor ligula, eget lacinia odio sem nec elit. Donec ullamcorper nulla non metus auctor fringilla. Vivamus sagittis lacus vel augue laoreet rutrum faucibus dolor auctor. Vestibulum id ligula porta felis euismod semper."}],"type":"p"}]}' />

---

<block type="introduction" data-json='{"value":[{"children":[{"text":"Highlight Title H2 "}],"type":"h2"}]}' />

Lorem ipsum vitae elit libero, a pharetra augue. Nulla vitae elit libero, a pharetra augue. Duis mollis, est non commodo luctus, nisi erat porttitor ligula, eget lacinia odio sem nec elit. Donec ullamcorper nulla non metus auctor fringilla. Vivamus sagittis lacus vel augue laoreet rutrum faucibus dolor auctor. Vestibulum id ligula porta felis euismod semper.

---

## Headline H2

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

### Headline H3

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

---

<block type="gridBlock">

## Block Title

<block type="teaser" title="Teaser Title H2" data-json='{"description":"Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.","head_title":null,"href":[{"@id":"/docs/examples/content-types/page","@type":"Document","Description":"The Page content type can be used to display content on a single page of the website. Pages can be structured using text, images and blocks.","Title":"Page","getRemoteUrl":null,"hasPreviewImage":true,"head_title":null,"image_field":"preview_image","title":"Page"}],"styles":{"align":"left"}}' />

</block>

<block type="heading" data-json='{"heading":"Getting Started","tag":"h2"}' />

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-heading">

<block type="codeExample" slotId="schema" source="heading" format="schema" />

<block type="codeExample" slotId="json-data" source="heading" format="json" />

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
