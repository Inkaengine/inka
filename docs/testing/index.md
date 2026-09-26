---
"@type": Document
UID: docs-testing-000000000000001
allow_discussion: false
creators:
  - admin
description: Author content as Markdown, serve it through the mock API, and
  check that every block renders — locally, and in your own CI.
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
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Testing & the mock API

Inka's mock API serves content as a Plone-style REST API, from Markdown files or a Plone export, so you can preview and test a whole site without a running CMS. Inka's own block [Examples](../examples/index.md) and the frontend [Quick Start](../frontend-guide/index.md#quick-start) are tested this way: a check that every block still renders.

## In this section

<block type="listing" data-json='{"headlineTag":"h2","variation":"summary","querystring":{"query":[{"i":"path","o":"plone.app.querystring.operation.string.relativePath","v":".::1"},{"i":"exclude_from_nav","o":"plone.app.querystring.operation.boolean.isFalse","v":""}],"sort_on":"getObjPositionInParent","sort_order":"ascending","depth":1},"fieldMapping":{"@id":"href","title":"title","description":"description","image":"image"}}' />

## Test your blocks in your own CI

The same checks can run against your site. The tests live in the Inka repository, so your CI checks out Inka next to your own code and runs them from there. Two pieces do the work:

- **The mock API, serving your content.** Point `CONTENT_MOUNTS` at your content: a Markdown tree (see [Content as Markdown](./blockmd.md)) or a Plone export directory (with `__metadata__.json`). The format is `mountPath:directory`, comma-separated for more than one.
- **The block sanity test, against your front end.** It reads your front end's block schemas through the bridge, finds every block in the served content, and checks each one renders with the annotations the editor needs. It lives in `tests-playwright/bridge/block-sanity.spec.ts`.

What the run needs:

- A checkout of the Inka repository, at the version you use, installed as in Inka's own workflow (Node.js 24, pnpm, `mrs-developer` for the Volto sources, and Playwright's Chromium).
- Your front end running, reading content from the mock API's URL, and loading the bridge.
- A parent page for the front end's iframe. The test uses `mock-parent.html` from Inka's test frontend. Serve it on a port other than `HYDRA_TEST_FRONTEND_PORT`, or the test will also check Inka's own test frontend against your content.
- These variables for the test run: `DISCOVER_BLOCKS_API` (the mock API URL), `FRONTEND_URL` (your front end), `MOCK_PARENT_URL` (the parent page), and `NO_WEBSERVER=true` and `SKIP_VOLTO_CHECK=true`, because the test starts nothing itself and needs no editor.
- Every `HYDRA_*_PORT` variable set. The test code reads them all and has no defaults, even for servers this run doesn't start.
- An example of every block type your front end registers, somewhere in the served content. A registered type with no example fails, by design: nothing would show it has stopped working. A type that only belongs inside a parent container can be marked `restricted` instead.

This GitHub Actions job puts it together. Change the front-end steps and the content path to suit your project.

### GitHub Actions

```text
jobs:
  block-sanity:
    runs-on: ubuntu-latest
    env:
      HYDRA_MOCK_API_PORT: 8888
      HYDRA_TEST_FRONTEND_PORT: 8889   # left unused on purpose
      HYDRA_MOCK_PARENT_PORT: 8891
      HYDRA_VOLTO_SSR_PORT: 3001
      HYDRA_VOLTO_WEBPACK_PORT: 3002
      HYDRA_NUXT_PORT: 3003
      HYDRA_REACT_DOC_PORT: 3004
      HYDRA_VUE_DOC_PORT: 3005
      HYDRA_SVELTE_DOC_PORT: 3006
      HYDRA_NEXTJS_PORT: 3007
      HYDRA_F7_PORT: 3008
      HYDRA_ASTRO_DOC_PORT: 3009
      HYDRA_VANILLA_DOC_PORT: 3010
      HYDRA_SVELTE_QS_PORT: 3011
      HYDRA_ASTRO_QS_PORT: 3012
      PARENT_PORT: 8890
      SITE_PORT: 4000
    steps:
      - uses: actions/checkout@v4
        with: { path: site }
      - uses: actions/checkout@v4
        with: { repository: Inkaengine/inka, ref: main, path: inka }
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - name: Install Inka's test tools
        working-directory: inka
        run: |
          npm install -g corepack && corepack enable
          pnpm dlx mrs-developer missdev --no-config --fetch-https
          pnpm install --frozen-lockfile
          pnpm exec playwright install --with-deps chromium
      - name: Start the mock API on your content, and the parent page
        working-directory: inka
        run: |
          PORT=$HYDRA_MOCK_API_PORT CONTENT_MOUNTS="/:$GITHUB_WORKSPACE/site/content" \
            node tests-playwright/fixtures/mock-api-server.cjs &
          HYDRA_TEST_FRONTEND_PORT=$PARENT_PORT \
            npx vite --config tests-playwright/fixtures/test-frontend/vite.config.js &
      - name: Start your front end against the mock API
        working-directory: site
        run: |
          npm ci
          API_URL=http://localhost:$HYDRA_MOCK_API_PORT npm run dev -- --port $SITE_PORT &
      - name: Wait for the servers
        run: |
          for port in $HYDRA_MOCK_API_PORT $PARENT_PORT $SITE_PORT; do
            for i in $(seq 1 60); do curl -s http://localhost:$port > /dev/null && break; sleep 2; done
          done
      - name: Block sanity
        working-directory: inka
        env:
          CI: true
          NO_WEBSERVER: true
          SKIP_VOLTO_CHECK: true
          DISCOVER_BLOCKS_API: http://localhost:${{ env.HYDRA_MOCK_API_PORT }}
          FRONTEND_URL: http://localhost:${{ env.SITE_PORT }}
          MOCK_PARENT_URL: http://localhost:${{ env.PARENT_PORT }}/mock-parent.html
        run: pnpm exec playwright test block-sanity --project=mock
```

`API_URL` and `npm run dev` stand for however your front end is told where its API is and how it starts. Keep your front end off the ports named above.

To run the mock API and editor from a checkout of Inka itself, see [Previewing and testing content](./testing-content.md).

## The adapter contract

Inka's Playwright suite has an `api-contract` project (`tests-playwright/api`). It checks the API behaviour Inka relies on: content types and their fields, workflow and sharing, navigation, and that block regions save. It runs against the mock API; an adapter has to give the same answers. See the [adapter guide](../adapters/index.md).
