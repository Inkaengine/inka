---
"@type": Document
UID: docs-folder-001
allow_discussion: false
contributors: []
creators:
  - admin
description: A design-system-first page-builder toolkit for any CMS. Guides for
  building a frontend, deploying and securing Inka, editing content, testing,
  adapters, and rules.
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
  - deploy-and-secure
  - frontend-guide
  - editor-guide
  - compliance
  - adapters
  - testing
  - examples
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" plaintext="${p,h*,ul,ol,blockquote,strong,em,a/text}" />
  <block type="title" _="${h1}" />
---

# Docs

Inka is an open-source, design-system-first page builder for any CMS. It ships as a blank slate: your components are your blocks, and you decide what editors can build. Inka is ready for production and in use on NSW Government sites; see the [case studies](https://inka.sh/case-studies).

The docs are a set of guides by audience — build a frontend, deploy it, edit content, test it, connect a content store, and set the rules editors work within.

<block type="video" align="full" url="./static/hydra-demo.mp4" autoplay=true loop=true muted=true controls=false />

## The guides

<block type="listing" data-json='{"headlineTag":"h2","variation":"summary","querystring":{"query":[{"i":"path","o":"plone.app.querystring.operation.string.relativePath","v":".::1"},{"i":"exclude_from_nav","o":"plone.app.querystring.operation.boolean.isFalse","v":""}],"sort_on":"getObjPositionInParent","sort_order":"ascending","depth":1},"fieldMapping":{"@id":"href","title":"title","description":"description","image":"image"}}' />

## Why Inka?

- **Compliance and engagement, not a trade-off** — you decide where the dial sits for each site, instead of choosing between locking editors down and letting the design system drift
- **Design-system-first** — components declare what they tolerate, so off-system output can't be produced
- **Multi frontend, multi backend** — Next.js, Nuxt.js, Astro, plus server-only stacks (PHP, Django, Rails, Laravel) via the [server-render pattern](./frontend-guide/server-rendered-frontends.md); switch channels mid-edit
- **AI under the same rules** — AI agents connect through MCP and [work within the same rules as editors](./editor-guide/ai-agents.md)
- **Evidence, not just warnings** — rules run while people edit; [Inka Assure](https://inka.sh/plugins/inka-assure), in development and planned for late 2026, will record what was checked and signed off on each published version (see [Rules and checks](./compliance/index.md))
- **Quick to adopt** — enable visual editing with simple HTML data attributes, no React or Vue required in your frontend
- **A toolkit, not a CMS** — good out of the box with zero configuration, extensible when you need more; open source (MIT) and self-hostable

## Try the online demo

The fastest way to feel what Inka does is to edit a real page against a real frontend in the hosted demo.

Press **Try editing now** on [inka.sh](https://inka.sh), or open [admin.inka.sh/login?demo](https://admin.inka.sh/login?demo\&return_url=/edit): you are signed in as a demo account, with nothing to register for, and nothing it changes is kept. Then:

- Open user preferences (bottom-left).
- Pick one of the preset frontends, or paste in your own frontend URL.
- Edit any page — every change updates the live preview.

See [Build a frontend › Deployment patterns](./frontend-guide/build-a-frontend.md#deployment-patterns), or to run Inka locally see **Run locally for development** in the [project README](https://github.com/Inkaengine/inka#run-locally-for-development).
