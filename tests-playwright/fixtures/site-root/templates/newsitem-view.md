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
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
---

<fields templateId="/templates/newsitem-view" templateInstanceId="tpl-ni-def">

<fields data-json='{"fixed":true}'>

<block type="dateField" dateField="effective" slotId="date" data-json='{"showTime":false}' />

<block type="title">

# News Item View

<fields slotId="title" />

</block>

<block type="leadimage" slotId="lead-image" />

</fields>

<block type="slate" slotId="content" data-json='{"value":[{"type":"p","children":[{"text":""}]}],"fixed":false}' />

</fields>
