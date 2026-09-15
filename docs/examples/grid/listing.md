---
"@type": Document
UID: 3ac4a2c6c4034a1686bc0ee2d2072fd6
allow_discussion: false
contributors: []
creators:
  - admin
description: >-
  
  The Grid block allows adding multi-column blocks. A grid block can contain
  between one and four columns of different blocks. This is a grid block with
  multiple listing blocks.
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: listing
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image:
  blob_path: examples/grid/listing/preview_image/black-starry-night.jpg
  content-type: image/jpeg
  filename: black-starry-night.jpg
  height: 1708
  size: 693013
  width: 2400
review_state: published
rights: ""
subjects: []
title: Grid-Listing
blocks-matched: |
  <block type="title" _="${h1}" />
blocks-tagged: |
  <block type="gridBlock" headline="${h/text}">
    <region name="items" widget="blocks_layout">
      <block type="teaser" title="${h/text}" description="${p/text}" />
    </region>
  </block>
---

# Grid-Listing

<block type="gridBlock">

<block type="listing" headlineTag="h2" variation="default" data-json='{"querystring":{"limit":"7","query":[{"i":"path","o":"plone.app.querystring.operation.string.absolutePath","v":"/docs/examples/grid"}],"sort_order":"ascending"}}' />

<block type="listing" headlineTag="h2" variation="default" data-json='{"querystring":{"limit":"7","query":[{"i":"path","o":"plone.app.querystring.operation.string.absolutePath","v":"/docs/examples/grid"}],"sort_on":"getId","sort_order":"descending","sort_order_boolean":true}}' />

<block type="slate" data-json='{"value":[{"type":"p","children":[{"text":"A manual block placed after the listings. The listings fill the earlier pages, so reaching this block requires paging the grid — the editor must page forward to reveal it when it is selected."}]}]}' />

</block>
