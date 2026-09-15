---
"@type": Document
UID: 49d22a94521c4883a1bb448ac7863cdd
allow_discussion: false
contributors: []
creators:
  - admin
description: This page has a sample of the typography available in the theme.
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: typography
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - content
title: Typography - Page Title (H1, 48/56px)
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="image" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
blocks-tagged: |
  <block type="button" title="${p/text}" href="${p/link}" />
  <block type="teaser" title="${h/text}" href="${h/link}" description="${p/text}" />
  <block type="slateTable">
    <region name="table.rows">
      <block type="row">
        <region name="cells">
          <block type="cell" value="${td/slate}" />
        </region>
      </block>
    </region>
  </block>
  <block type="gridBlock" headline="${h/text}">
    <region name="items" widget="blocks_layout">
      <block type="teaser" title="${h/text}" description="${p/text}" />
    </region>
  </block>
---

# Typography - Page Title (H1, 48/56px)

<block type="heading" alignment="left" heading="Heading (H2, 33/42px)" tag="h2" />

<block type="gridBlock">

<block type="teaser" description="For grid blocks, the font of the headlines are variable, depending on the number of cells in the grid." title="Teaser Title (H2, 30/36px)" data-json='{"head_title":null,"href":[{"@id":"/docs/examples/content-types","@type":"Document","Description":"This section has a sample of content types available in this site.","Title":"Content Types","getRemoteUrl":null,"hasPreviewImage":null,"head_title":null,"image_field":"image","title":"Content Types"}],"styles":{"align":"left"}}' />

</block>

<block type="gridBlock">

<block type="teaser" head_title="Teaser Headtitle (DIV, 14/18px)" title="Teaser Title (H3, 24/30px)" data-json='{"href":[{"@id":"/docs/examples/content-types","@type":"Document","Description":"This section has a sample of content types available in this site.","Title":"Content Types","getRemoteUrl":null,"hasPreviewImage":null,"head_title":null,"image_field":"image","title":"Content Types"}],"styles":{"align":"left"}}' />

<block type="teaser" description="Paragraph (p, 18px/24px). This section has a sample of content types available in this site." head_title="Teaser Headtitle (DIV, 14/18px)" title="Teaser Title (H3, 24/30px)" data-json='{"href":[{"@id":"/docs/examples/content-types","@type":"Document","Description":"This section has a sample of content types available in this site.","Title":"Content Types","getRemoteUrl":null,"hasPreviewImage":null,"head_title":null,"image_field":"image","title":"Content Types"}],"styles":{"align":"left"}}' />

</block>

## Text Heading H2 (H2, 30/36px)

Paragraph (p, 18px/24px)

- unordered list
- unordered list

1. ordered list
2. ordered list

blockquote

**bold** / italic / ~~strikethrough~~

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

### Text Heading H3 (H3, 24/30px)

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

<block type="introduction" data-json='{"value":[{"children":[{"text":"Text Heading H2 (H2, 36/48px)"}],"type":"h2"}]}' />

Paragraph text (p, 24/33px) -> Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

<block type="listing" block="875e2811-edb6-4842-8cc0-246fa1be6f58" headline="Heading (H2, 33/42px)" headlineTag="h2" variation="default" data-json='{"query":[],"querystring":{"limit":"5","query":[{"i":"portal_type","o":"plone.app.querystring.operation.selection.any","v":["File","Document"]}],"sort_on":"effective","sort_order":"descending","sort_order_boolean":"descending"}}' />

<block type="image" align="center" image_field="image" size="l" title="Caption Title (14/18px). Image" url="/docs/examples/content-types/image-dark" data-json='{"allow_image_download":false,"description":"Caption Description (14/18px). The Image content type can be used to upload an image in various formats (JPG, GIF, PNG, SVG). The uploaded image should always have a high resolution so that it can be used flexibly, for example as a banner image. Plone automatically delivers the images in the best scaling, so there is no need to scale images down manually."}' />

<block type="button" inneralign="left" title="Button text (button, 18/24px)" />

<block type="gridBlock" data-json='{"items":[{"@type":"slate","plaintext":"Text Heading (H2, 30/36px)","value":[{"children":[{"text":"Text Heading (H2, 30/36px)"}],"type":"h2"}]},{"@type":"slate","value":[{"children":[{"text":"For grid blocks, the font of the headlines are variable, depending on the number of cells in the grid."}],"type":"p"}],"plaintext":"For grid blocks, the font of the headlines are variable, depending on the number of cells in the grid."}]}' />

<block type="gridBlock" data-json='{"items":[{"@type":"slate","plaintext":"Text Heading (H3, 24/30px)","value":[{"children":[{"text":"Text Heading (H3, 24/30px)"}],"type":"h2"}]},{"@type":"slate","value":[{"children":[{"text":"Paragraph Text (p, 18/24px)"}],"type":"p"}],"plaintext":"Paragraph Text (p, 18/24px)"},{"@type":"slate","plaintext":"Text Heading (H3, 24/30px)","value":[{"children":[{"text":"Text Heading (H3, 24/30px)"}],"type":"h2"}]},{"@type":"slate","value":[{"children":[{"text":"Paragraph Text (p, 18/24px)"}],"type":"p"}],"plaintext":"Paragraph Text (p, 18/24px)"}]}' />

<block type="toc" variation="default" data-json='{"levels":["h2","h3"]}' />

<block type="slateTable" table.celled table.fixed>

| Table Header (THEAD, 18/24) | Table Header (THEAD, 18/24) |
| --- | --- |
| Table cell (td p, 18/24px) | Table cell (td p, 18/24px) |

</block>

<block type="slate" data-json='{"value":[{"children":[{"text":""}],"type":"p"}]}' />
