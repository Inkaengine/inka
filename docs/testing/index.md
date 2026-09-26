---
"@type": Document
UID: docs-testing-000000000000001
allow_discussion: false
creators:
  - admin
description: Author content as Markdown, serve it through the mock API, and
  check that every block renders — the local loop for content and blocks.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
review_state: published
is_folderish: true
layout: document_view
title: Testing & the mock API
id: testing
order:
  - blockmd
  - testing-content
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
---

# Testing & the mock API

Inka content is authored as Markdown and served locally through a mock API, so you can preview and test a whole site without a running backend. The block [Examples](../examples/index.md) and the frontend [Quick Start](../frontend-guide/index.md#quick-start) are real, testable content that runs the same way — a smoke test that every block still renders.

## In this section

<block type="listing" data-json='{"headlineTag":"h2","variation":"summary","querystring":{"query":[{"i":"path","o":"plone.app.querystring.operation.string.relativePath","v":".::1"},{"i":"exclude_from_nav","o":"plone.app.querystring.operation.boolean.isFalse","v":""}],"sort_on":"getObjPositionInParent","depth":1},"fieldMapping":{"@id":"href","title":"title","description":"description","image":"image"}}' />
