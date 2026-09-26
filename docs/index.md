---
"@type": Document
UID: docs-folder-001
allow_discussion: false
contributors: []
creators:
  - admin
description: A design-system-first page-builder toolkit. Guides for building a
  frontend, editing content, testing, adapters, and compliance.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: docs
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects: []
title: Docs
order:
  - architecture
  - frontend-guide
  - editor-guide
  - compliance
  - adapters
  - testing
  - examples
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
---

# Docs

Inka ships as a blank slate: your components are your blocks, and you decide what editors can build. The docs are a set of guides by audience — build a frontend, edit content, test it, connect a content store, and put compliance checks in front of editors.

<block type="video" data-json='{"align":"full","url":"./static/hydra-demo.mp4","autoplay":true,"loop":true,"muted":true,"controls":false}' />

## The guides

<block type="listing" data-json='{"headlineTag":"h2","variation":"summary","querystring":{"query":[{"i":"path","o":"plone.app.querystring.operation.string.relativePath","v":".::1"},{"i":"exclude_from_nav","o":"plone.app.querystring.operation.boolean.isFalse","v":""}],"sort_on":"getObjPositionInParent","depth":1},"fieldMapping":{"@id":"href","title":"title","description":"description","image":"image"}}' />

## Why Inka?

- **Compliance and engagement, not a trade-off** — you decide where the dial sits for each site, instead of choosing between locking editors down and letting the design system drift
- **Design-system-first** — components declare what they tolerate, so off-system output can't be produced
- **Multi frontend, multi backend** — Next.js, Nuxt.js, Astro, plus server-only stacks (PHP, Django, Rails, Laravel) via the [server-render pattern](./frontend-guide/server-rendered-frontends.md); switch channels mid-edit
- **AI under the same constraints** — everyone's AI can build you a page; ours can't build one that breaks your design system
- **Evidence, not just warnings** — rules a machine can't decide go to the people who can, and the determination is recorded against that version of the content
- **Quick to adopt** — enable visual editing with simple HTML data attributes, no React or Vue required in your frontend
- **A toolkit, not a CMS** — good out of the box with zero configuration, extensible when you need more; open source and self-hostable

## Try the online demo

The fastest way to feel what Inka does is to log into the hosted demo and edit a real page against a real frontend.

<block type="slate" data-json='{"value":[{"type":"p","children":[{"text":"Open <https://admin.inka.sh>, log in, then:"}]}]}' />

- Open user preferences (bottom-left).
- Pick one of the preset frontends, or paste in your own frontend URL.
- Edit any page — every change updates the live preview.

See [Build a frontend › Deployment patterns](./frontend-guide/build-a-frontend.md#deployment-patterns), or to run Inka locally see the **Run Locally** section of the [project README](https://github.com/Inkaengine/inka#run-locally).
