---
"@type": Event
UID: 7adc12f0e7604982a6cdcb9437bccf66
allow_discussion: false
attendees: []
changeNote: null
contact_email: m.mustermann@plone.com
contact_name: Max Mustermann
contact_phone: +49 1234 567-890
contributors: []
creators:
  - admin
description: The event content type can be used to display an event on the website.
effective: 2023-07-06T18:35:00
end: 2023-12-31T12:00:00+00:00
event_url: http://www.musterevents.com
exclude_from_nav: false
expires: null
id: event
is_folderish: true
language: "##DEFAULT##"
layout: event_view
location: Musterhausener Landstrasse 134 Standort E123 67111 Musterhausen
open_end: false
preview_caption: null
preview_image:
  blob_path: examples/content-types/event/preview_image/event.svg
  content-type: image/svg+xml
  filename: event.svg
  height: 36
  size: 703
  width: 36
recurrence: null
review_state: published
rights: ""
start: 2023-01-01T11:00:00+00:00
subjects:
  - events
sync_uid: null
title: Event
whole_day: false
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
---

<fields templateId="/templates/event-view" templateInstanceId="tpl-ev-def">

<fields data-json='{"fixed":true}'>

<block type="title">

# Event

<fields slotId="title" data-json='{"readOnly":true}' />

</block>

<block type="eventMetadata" slotId="event-metadata" />

</fields>

<block type="slate" slotId="content" data-json='{"value":[{"children":[{"text":""}],"type":"p"}]}' />

</fields>
