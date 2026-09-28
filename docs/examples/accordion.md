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
is_folderish: true
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
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="separator" _="${hr}" styles={"align":"full"} />
  <block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
blocks-tagged: |
  <block type="teaser" title="${h?/text}" head_title="${strong?/text}" href="${h?/link}" description="${p?/text}" />
  <block type="slateTable">
    <region name="table.rows" idField="key">
      <block type="row">
        <region name="cells" idField="key">
          <block type="cell" value="${td/slate}" />
        </region>
      </block>
    </region>
  </block>
  <block type="accordion" right_arrows=true>
    <region name="panels" widget="object_list" idField="@id" typeField="@type">
      <block type="panel" title="${h/text}" />
    </region>
  </block>
---

# Accordion

A collapsible panel group. Each panel is an object\_list item with a title and a content area that holds child blocks.

<block type="image">

![The accordion example block being edited in Inka](../images/accordion-edit.png)

</block>

<block type="accordion">

## What is a block?

A reusable unit of content you can add, edit and reorder.

## Adding a panel

Each panel is an object-list item with a title and a content area that holds child blocks.

</block>

<block type="accordion" styles:backgroundColor="grey">

## Accordion with text

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

## Accordion with image

<block type="image">

The Image content type can be used to upload an image in various formats (JPG, GIF, PNG, SVG). The uploaded image should always have a high resolution so that it can be used flexibly, for example as a banner image. Plone automatically delivers the images in the best scaling, so there is no need to scale images down manually.

![](./content-types/image-light.jpg "Image - Light")

<fields image_field="image" />

</block>

<block type="separator">

---

<fields styles:align="left" />

</block>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="image">

The Image content type can be used to upload an image in various formats (JPG, GIF, PNG, SVG). The uploaded image should always have a high resolution so that it can be used flexibly, for example as a banner image. Plone automatically delivers the images in the best scaling, so there is no need to scale images down manually.

![](./content-types/image-dark "Image")

<fields align="left" image_field="image" />

</block>

<block type="slate">

## Text Heading H3

</block>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="separator">

---

<fields styles:align="left" />

</block>

<block type="image">

The Image content type can be used to upload an image in various formats (JPG, GIF, PNG, SVG). The uploaded image should always have a high resolution so that it can be used flexibly, for example as a banner image. Plone automatically delivers the images in the best scaling, so there is no need to scale images down manually.

![](./content-types/image-dark "Image")

<fields align="left" size="m" image_field="image" styles:size:noprefix="medium" />

</block>

<block type="slate">

## Text Heading H3

</block>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="image">

The Image content type can be used to upload an image in various formats (JPG, GIF, PNG, SVG). The uploaded image should always have a high resolution so that it can be used flexibly, for example as a banner image. Plone automatically delivers the images in the best scaling, so there is no need to scale images down manually.

![](./content-types/image-light.jpg "Image - Light")

<fields align="right" size="m" image_field="image" styles:size:noprefix="medium" />

</block>

<block type="slate">

## Text Heading H3

</block>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="separator">

---

<fields styles:align="left" />

</block>

<block type="image">

The Image content type can be used to upload an image in various formats (JPG, GIF, PNG, SVG). The uploaded image should always have a high resolution so that it can be used flexibly, for example as a banner image. Plone automatically delivers the images in the best scaling, so there is no need to scale images down manually.

![](./content-types/image-dark "Image")

<fields align="left" size="s" image_field="image" styles:size:noprefix="small" />

</block>

<block type="slate">

## Text Heading H3

</block>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="image">

The Image content type can be used to upload an image in various formats (JPG, GIF, PNG, SVG). The uploaded image should always have a high resolution so that it can be used flexibly, for example as a banner image. Plone automatically delivers the images in the best scaling, so there is no need to scale images down manually.

![](./content-types/image-dark "Image")

<fields align="right" size="s" image_field="image" styles:size:noprefix="small" />

</block>

<block type="slate">

## Text Heading H3

</block>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

## Accordion with teaser

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo

<fields styles:align="center" />

</block>

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/image-light.jpg)

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper

<fields styles:align="left" />

</block>

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper

<fields styles:align="right" />

</block>

## Accordion with listing

<block type="listing" data-json='{"headlineTag":"h2","querystring":{"limit":"3","query":[{"i":"Description","o":"plone.app.querystring.operation.string.contains","v":"block"}],"sort_order":"descending","sort_order_boolean":true},"variation":"summary"}' />

## Accordion with table

<block type="slateTable" styles:backgroundColor="transparent" table.celled table.fixed table.striped>

| Title Tablehead&#x20; | Title Tablehead&#x20; | Title Tablehead&#x20; |
| --- | --- | --- |
| <h2>Heading H3</h2><h3>Heading H2</h3>Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; | <h2>Heading H3</h2><h3>Heading H2</h3>Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; | <h2>Heading H3</h2><h3>Heading H2</h3>Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; |
| <h2>Heading H3</h2><h3>Heading H2</h3>Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; | <h2>Heading H3</h2><h3>Heading H2</h3>Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; | <h2>Heading H3</h2><h3>Heading H2</h3>Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; |
| <h2>Heading H3</h2><h3>Heading H2</h3>Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; | <h2>Heading H3</h2><h3>Heading H2</h3>Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; | <h2>Heading H3</h2><h3>Heading H2</h3>Text can be **bold** or *italic* or a [Link](./content-types/image-dark.md)&#x20; |

</block>

</block>

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-accordion" fixed=false>

<block type="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: accordion
```

</block>

<block type="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./accordion.md
:block: accordion
:as: json
```

</block>

<block type="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/AccordionBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/AccordionBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/AccordionBlock.svelte
:language: svelte
```

</block>

</fields>
