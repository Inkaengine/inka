---
"@type": Event
UID: tpl-ct-event-view
id: event-view
title: Event View
review_state: published
description: Layout template for Event content type pages
effective: 2025-01-01T00:00:00
start: 2023-01-01T11:00:00+00:00
end: 2023-12-31T12:00:00+00:00
location: Musterhausener Landstrasse 134 Standort E123 67111 Musterhausen
contact_name: Max Mustermann
contact_phone: +49 1234 567-890
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
---

<fields templateId="/templates/event-view" templateInstanceId="tpl-ev-def">

<fields data-json='{"fixed":true}'>

<block type="title">

# Event View

<fields slotId="title" />

</block>

<block type="eventMetadata" slotId="event-metadata" />

</fields>

<block type="slate" slotId="content" data-json='{"value":[{"type":"p","children":[{"text":""}]}],"fixed":false}' />

</fields>
