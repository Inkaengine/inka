---
"@type": Document
UID: f8cd4a2d8d7c4703b4e41d2093b21aed
allow_discussion: false
contributors: []
creators:
  - admin
description: The accordion contains other blocks in an accordion behavior layout.
effective: 2023-09-22T16:09:00
exclude_from_nav: false
expires: null
id: accordion
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - blocks
  - containers
title: Accordion
blocks-matched: |
  <block is="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" />
  <block is="title" _="${h1}" />
  <block is="separator" _="${hr}" :styles='{"align":"full"}' />
  <block is="image" description="${p?/textarea}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block is="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block is="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
blocks-tagged: |
  <block is="teaser" title="${h?/text}" head_title="${strong?/text}" href="${h?/link}" description="${p?/textarea}" />
  <block is="slateTable">
    <region name="table.rows" idField="key">
      <block is="row" _="${tr}">
        <region name="cells" idField="key" typeField="type">
          <block is="header" value="${th/slate}" />
          <block is="data" value="${td/slate}" />
        </region>
      </block>
    </region>
  </block>
  <block is="accordion" right_arrows>
    <region name="panels" widget="object_list" idField="@id" typeField="@type">
      <block is="panel" title="${h/text}" />
    </region>
  </block>
---

# Accordion

A collapsible panel group. Each panel is an object_list item with a title and a content area that holds child blocks.

<block is="image">

![The accordion example block being edited in Inka](../images/accordion-edit.png)

</block>

<block is="accordion">

## What is a block?

A reusable unit of content you can add, edit and reorder.

## Adding a panel

Each panel is an object-list item with a title and a content area that holds child blocks.

</block>

<block is="accordion" :styles='{"backgroundColor":"grey"}'>

## Accordion with text

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

## Accordion with image

<block is="image">

The Image content type can be used to upload an image in various formats (JPG, GIF, PNG, SVG). The uploaded image should always have a high resolution so that it can be used flexibly, for example as a banner image. Plone automatically delivers the images in the best scaling, so there is no need to scale images down manually.

![](./content-types/image-light.jpg "Image - Light")

<fields image_field="image" />

</block>

<block is="separator">

---

<fields :styles='{"align":"left"}' />

</block>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block is="image">

The Image content type can be used to upload an image in various formats (JPG, GIF, PNG, SVG). The uploaded image should always have a high resolution so that it can be used flexibly, for example as a banner image. Plone automatically delivers the images in the best scaling, so there is no need to scale images down manually.

![](./content-types/image-dark "Image")

<fields align="left" image_field="image" />

</block>

<block is="slate">

## Text Heading H3

</block>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block is="separator">

---

<fields :styles='{"align":"left"}' />

</block>

<block is="image">

The Image content type can be used to upload an image in various formats (JPG, GIF, PNG, SVG). The uploaded image should always have a high resolution so that it can be used flexibly, for example as a banner image. Plone automatically delivers the images in the best scaling, so there is no need to scale images down manually.

![](./content-types/image-dark "Image")

<fields align="left" size="m" image_field="image" :styles='{"size:noprefix":"medium"}' />

</block>

<block is="slate">

## Text Heading H3

</block>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block is="image">

The Image content type can be used to upload an image in various formats (JPG, GIF, PNG, SVG). The uploaded image should always have a high resolution so that it can be used flexibly, for example as a banner image. Plone automatically delivers the images in the best scaling, so there is no need to scale images down manually.

![](./content-types/image-light.jpg "Image - Light")

<fields align="right" size="m" image_field="image" :styles='{"size:noprefix":"medium"}' />

</block>

<block is="slate">

## Text Heading H3

</block>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block is="separator">

---

<fields :styles='{"align":"left"}' />

</block>

<block is="image">

The Image content type can be used to upload an image in various formats (JPG, GIF, PNG, SVG). The uploaded image should always have a high resolution so that it can be used flexibly, for example as a banner image. Plone automatically delivers the images in the best scaling, so there is no need to scale images down manually.

![](./content-types/image-dark "Image")

<fields align="left" size="s" image_field="image" :styles='{"size:noprefix":"small"}' />

</block>

<block is="slate">

## Text Heading H3

</block>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block is="image">

The Image content type can be used to upload an image in various formats (JPG, GIF, PNG, SVG). The uploaded image should always have a high resolution so that it can be used flexibly, for example as a banner image. Plone automatically delivers the images in the best scaling, so there is no need to scale images down manually.

![](./content-types/image-dark "Image")

<fields align="right" size="s" image_field="image" :styles='{"size:noprefix":"small"}' />

</block>

<block is="slate">

## Text Heading H3

</block>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

## Accordion with teaser

<block is="teaser">

### [Teaser Title H2](./content-types/page.md)

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo

<fields :styles='{"align":"center"}' />

</block>

<block is="teaser">

### [Teaser Title H2](./content-types/image-light.jpg)

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper

<fields :styles='{"align":"left"}' />

</block>

<block is="teaser">

### [Teaser Title H2](./content-types/page.md)

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper

<fields :styles='{"align":"right"}' />

</block>

## Accordion with listing

<block is="listing" headlineTag="h2" :querystring='{"limit":"3","query":[{"i":"Description","o":"plone.app.querystring.operation.string.contains","v":"block"}],"sort_order":"descending","sort_order_boolean":true}' variation="summary" />

## Accordion with table

<block is="slateTable" :styles='{"backgroundColor":"transparent"}' :table.basic="false" table.celled :table.compact="false" table.fixed :table.hideHeaders="false" :table.inverted="false" table.striped>

| Title Tablehead&#x20; | Title Tablehead&#x20; | Title Tablehead&#x20; |
| --- | --- | --- |
| Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; | Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; | Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; |
| Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; | Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; | Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; |
| Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; | Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; | Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; |

</block>

</block>

<defaults templateId="/inka-templates/block-reference-layout" templateInstanceId="tpl-inst-accordion">

<fields :fixed="false" :readOnly="false">

<block is="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: accordion
```

<fields slotId="schema-tabs" />

</block>

<block is="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./accordion.md
:block: accordion
:as: json
```

<fields slotId="json-data-tabs" />

</block>

<block is="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/AccordionBlock.jsx
:language: jsx
```

<fields slotId="rendering-tabs" />

### Vue

```{literalinclude} examples/vue/AccordionBlock.vue
:language: vue
```

<fields slotId="rendering-tabs" />

### Svelte

```{literalinclude} examples/svelte/AccordionBlock.svelte
:language: svelte
```

<fields slotId="rendering-tabs" />

</block>

</fields>

</defaults>
