---
"@type": Event
UID: a2f2c6a524094c9482cc5384883fd8e7
allow_discussion: false
attendees: []
changeNote: null
contact_email: null
contact_name: null
contact_phone: null
contributors: []
creators:
  - admin
description: Events can have recurrence :)
effective: 2024-03-07T17:09:00
end: 2024-02-29T19:00:00+00:00
event_url: null
exclude_from_nav: false
expires: null
id: copy_of_event
is_folderish: true
language: "##DEFAULT##"
layout: event_view
location: null
open_end: false
preview_caption: null
preview_image: null
recurrence: |-
  DTSTART:20240228T230000Z
  RRULE:FREQ=MONTHLY;INTERVAL=1;COUNT=12;WKST=MO;BYDAY=-1TH
review_state: published
rights: ""
start: 2024-02-28T23:00:00+00:00
subjects:
  - events
sync_uid: null
title: Another Event
whole_day: true
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
---

<fields templateId="/templates/event-view" templateInstanceId="tpl-ev-def">

<block type="title">

# Another Event

<fields slotId="title" data-json='{"fixed":true,"readOnly":true}' />

</block>

<fields slotId="content">

<block type="introduction" data-json='{"value":[{"children":[{"text":"Wings fair wings doppio sit irish americano galão eu variety affogato."}],"type":"p"}]}' />

<block type="slate" data-json='{"value":[{"children":[{"text":""}],"type":"p"}]}' />

Percolator and extraction press luwak press aroma foam eu panna spoon espresso iced sit americano. Saucer beans kopi froth to au lait dark panna café iced cup instant au lait. Id origin decaffeinated aromatic in rich sit mocha caramelization café doppio spoon. Strong steamed crema mountain ristretto coffee sweet black aromatic white beans shop. Id pumpkin extraction robusta est white extra organic panna as turkish.

</fields>

<block type="eventMetadata" slotId="event-metadata" data-json='{"fixed":true,"required":true}' />

<block type="slate" slotId="content" />

</fields>
