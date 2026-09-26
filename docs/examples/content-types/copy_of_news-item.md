---
"@type": News Item
UID: af85ff98cd6446eebcba56305ed89fed
allow_discussion: false
changeNote: null
contributors: []
creators:
  - admin
description: Cinnamon skinny medium panna americano spice affogato froth frappuccino that.
effective: 2024-03-07T17:09:00
exclude_from_nav: false
expires: null
id: copy_of_news-item
image:
  blob_path: examples/content-types/copy_of_news-item/image/sergio-martinez-rhNJJ4eD2zk-unsplash.jpg
  content-type: image/jpeg
  filename: sergio-martinez-rhNJJ4eD2zk-unsplash.jpg
  height: 3456
  size: 2231807
  width: 5184
image_caption: null
is_folderish: true
language: "##DEFAULT##"
layout: newsitem_view
review_state: published
rights: ""
subjects:
  - news
title: Another News Item
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
blocks-tagged: |
  <block type="introduction" value="${p,h*/slate}" />
---

<fields templateId="/templates/newsitem-view" templateInstanceId="tpl-ni-def">

<fields data-json='{"fixed":true,"readOnly":true}'>

<block type="dateField" data-json='{"dateField":"effective","slotId":"date","showTime":false}' />

<block type="title">

# Another News Item

<fields slotId="title" />

</block>

</fields>

<fields data-json='{"readOnly":false}'>

<block type="introduction">

Cinnamon skinny medium panna americano spice affogato froth frappuccino that.

<fields slotId="content" data-json='{"fixed":false}' />

</block>

<block type="leadimage" data-json='{"align":"center","slotId":"lead-image","fixed":true}' />

<block type="slate">

Ristretto so chicory skinny ristretto au decaffeinated sugar that spoon shop crema ut pot lungo. Flavour that milk brewed flavour whipped kopi black and robusta. Bar sugar americano eu froth variety brewed acerbic steamed. Aroma est milk doppio frappuccino half cream filter french froth luwak. Acerbic plunger au barista flavour in froth trade.

<fields slotId="content" data-json='{"fixed":false}' />

</block>

</fields>

</fields>
