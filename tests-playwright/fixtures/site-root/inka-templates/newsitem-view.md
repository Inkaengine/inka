---
"@type": News Item
UID: tpl-ct-newsitem-view
id: newsitem-view
title: News Item View
review_state: published
description: Layout template for News Item content type pages
effective: 2025-01-01T00:00:00
preview_image:
  blob_path: templates/newsitem-view/preview_image/newsitem.svg
  content-type: image/svg+xml
  filename: newsitem.svg
  height: 36
  size: 703
  width: 36
blocks-matched: |
  <block is="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block is="title" _="${h1}" />
---

<fields templateId="/inka-templates/newsitem-view" templateInstanceId="tpl-ni-def">

<fields data-json='{"fixed":true,"readOnly":false}'>

<block is="dateField" dateField="effective" slotId="date" data-json='{"showTime":false}' />

<block is="title">

# News Item View

<fields slotId="title" />

</block>

<block is="leadimage" slotId="lead-image" />

</fields>

<block is="slate" slotId="default" data-json='{"value":[{"type":"p","children":[{"text":""}]}],"fixed":false}' />

</fields>
