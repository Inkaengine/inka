---
"@type": Document
UID: docs-testing-content-001
allow_discussion: false
contributors: []
creators:
  - admin
description: Preview content locally by serving the Markdown through the mock
  API, and check it with the block sanity test — which discovers every block on
  the served content and verifies it renders across frontends.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: testing-content
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - content
  - testing
title: Previewing and Testing Content
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Previewing and Testing Content

Content is authored as Markdown — see [Content as Markdown](./blockmd.md). To see how it renders and to check that every block works, you serve those same files through the mock API and run the block sanity test. Both read the content directly, so there is nothing to generate first.

## Serving content with the mock API

The mock API turns a content tree into a Plone REST API. It reads the `.md` files live, with no build step, so editing a page and refreshing the admin shows the change immediately.

These commands run from a checkout of the Inka repository. By default the mock API mounts Inka's own content:

- **`/docs`** — the documentation pages (this site's own source).
- **`/_test_data`** — fixtures used by the automated tests.
- **`/`** — the demo site root.

To serve your own content instead, set `CONTENT_MOUNTS`, for example `CONTENT_MOUNTS=/:/path/to/your/content`. The scripts take their ports from environment variables and have no defaults, so set them first:

### Shell

```shell
export HYDRA_MOCK_API_PORT=8888 HYDRA_VOLTO_SSR_PORT=3001 HYDRA_TEST_FRONTEND_PORT=8889 \
  HYDRA_NUXT_PORT=3003 HYDRA_NEXTJS_PORT=3007 HYDRA_F7_PORT=3008
```

`pnpm start:mock-api` needs `HYDRA_MOCK_API_PORT`. `pnpm start:test` needs all six: it lists the test frontend, Nuxt, Next.js and F7 example front ends in the editor's front-end switcher, whether or not they are running.

Start the mock API:

### Shell

```shell
pnpm start:mock-api
```

Then start the admin, which is configured to talk to the mock API, and open a page to edit:

### Shell

```shell
pnpm start:test
```

The admin renders the page through whichever frontend you select and updates the live preview as you edit — the same round trip a real editor gets, backed by your local Markdown. The [test suite README](https://github.com/Inkaengine/inka/tree/main/tests-playwright) covers the full harness.

## Testing with the block sanity test

The **block sanity** test is the safety net for content. It does not hard-code a list of blocks to check — instead it **discovers every block on the served content** and, for each one, verifies that it renders, that its sub-blocks render, and that its editable fields carry the annotations the admin needs. Because discovery reads the live content, authoring a new example is all it takes to put a block under test — there is no separate test to write.

That is the working rule: **every block type needs an example somewhere in the content**, and a block type with no example is treated as a gap to fix, not something to skip.

The test runs each discovered block against several frontends. A core set — the mock frontend, Nuxt, and Next.js — is **enforced**: a block that fails to render there fails the suite. The remaining example frontends carry partial coverage on purpose and are checked on a best-effort basis.

Run it from the root of the Inka checkout, with every `HYDRA_*_PORT` variable set (the full list is in the [CI example](./index.md#test-your-blocks-in-your-own-ci)):

### Shell

```shell
pnpm exec playwright test block-sanity
```

A failure names the block and the frontend, and points at the page it was found on, so the fix is usually either the renderer for that block in that frontend or the content that produced an unexpected shape.

To run it against your own front end and content, in your own CI, see [Test your blocks in your own CI](./index.md#test-your-blocks-in-your-own-ci).

## How the pieces fit

You edit a `.md` file; the mock API serves it as block JSON; the admin previews it through a frontend; and the sanity test confirms — across frontends — that every block on it renders and stays editable. One source of content feeds all three, so what you preview is what is tested and what ships.

## Where to look next

- [Content as Markdown](./blockmd.md) — the authoring format itself.
- The block reference under [Examples](../examples/index.md) — a worked example of every block, and the corpus the sanity test discovers.
- The test suite README (linked above) — running the full Playwright harness, ports, and per-frontend projects.
