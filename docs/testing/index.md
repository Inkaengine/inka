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
layout: document_view
title: Testing & the mock API
id: testing
order:
  - blockmd
  - testing-content
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" plaintext="${p,h*,ul,ol,blockquote,strong,em,a/text}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
---

# Testing & the mock API

Inka's mock API serves content as a Plone-style REST API, from Markdown files or a Plone export, so you can preview and test a whole site without a running CMS. Inka's own block [Examples](../examples/index.md) and the frontend [Quick Start](../frontend-guide/index.md#quick-start) are tested this way: a check that every block still renders.

## In this section

<block type="listing" data-json='{"headlineTag":"h2","variation":"summary","querystring":{"query":[{"i":"path","o":"plone.app.querystring.operation.string.relativePath","v":".::1"},{"i":"exclude_from_nav","o":"plone.app.querystring.operation.boolean.isFalse","v":""}],"sort_on":"getObjPositionInParent","sort_order":"ascending","depth":1},"fieldMapping":{"getURL":{"field":"href","type":"link"},"title":{"field":"title","type":"string"},"description":{"field":"description","type":"textarea"},"image":{"field":"image","type":"image_link"}}}' />

## Test your blocks in your own CI

The same checks can run against your site, from your own repository. Two packages do the work:

- **`@inka/mock-api`** serves your content as a Plone REST API. Its `inka-mock-api` command reads `PORT` and `CONTENT_MOUNTS`: a Markdown tree (see [Content as Markdown](./blockmd.md)) or a Plone export directory (with `__metadata__.json`), as `mountPath:directory`, comma-separated for more than one. `inka-mock-api --check` checks that content the way the mock does before it starts, and exits.
- **`@inka/testing`** is the test harness. Its block sanity suite reads your front end's block schemas through the bridge, finds an example of every block type, variation and text style in the served content, and checks each one renders with the annotations the editor needs. Its `inka-mock-parent` command serves `mock-parent.html`, the stand-in admin page your front end is loaded into for the test.

Neither is published to npm yet. Add them from a checkout of the Inka repository (a git submodule, say) as members of your pnpm workspace, together with the Inka packages they depend on, and depend on them as `workspace:*` (see `pnpm-workspace.yaml` below). The Inka checkout needs no install of its own: the packages carry everything the test uses.

`@inka/testing` takes `@playwright/test` as a peer, so your project depends on Playwright itself, and pins it for the whole workspace with an override (see `pnpm-workspace.yaml` below). pnpm installs a workspace member's own peers for it separately, so without the override `@inka/testing` can get a different Playwright from your config's, and the run stops with "Requiring @playwright/test second time". A package linked from the checkout keeps its own dependencies inside the checkout, so every install that links it (yours, another workspace's, the Inka checkout's own) points them at its own copies, and the last one wins. If you also install the Inka checkout itself, to work on Inka, run your workspace's install after it; otherwise Playwright loads twice and stops with "Requiring @playwright/test second time".

What the run needs:

- Your front end running, reading content from the mock API, and loading the bridge.
- The mock API on your content, and the mock parent, each on a port of your choosing.
- A global setup that runs discovery, a spec that defines the suite, and the coverage reporter, as below. The reporter judges what no single test can: that every text style in the content renders, and renders differently from body text, and that every field and option has an example. Don't pass `--reporter` on the command line: it replaces the config's reporters, the coverage reporter with them.
- `FRONTEND_URL` and `MOCK_PARENT_URL` in the environment as well as passed in. Discovery reads the style menu your front end offers only when both are set, and without it every styled paragraph fails as not an authorable style.
- An example of every block type your front end registers, somewhere in the served content. A registered type with no example fails, by design: nothing would show it has stopped working. A type that only belongs inside a parent container can be marked `restricted` instead.

### pnpm-workspace.yaml

```text
packages:
  - .
  - inka/packages/helpers
  - inka/packages/hydra-js
  - inka/packages/mock-api
  - inka/packages/blockmd
  - inka/packages/content-validator
  - inka/packages/testing

overrides:
  '@playwright/test': 1.61.0   # the version your project depends on
  playwright: 1.61.0
```

### Playwright config

```text
// tests/sanity/sanity.ts: where the servers are, shared by the files below
export const PROJECT = 'block-sanity';
export const API_URL = 'http://localhost:8891';
export const MOCK_PARENT_URL = 'http://localhost:8892/mock-parent.html';
export const FRONTEND_URL = 'http://localhost:3000';
export const DISCOVERY_DIR = import.meta.dirname;

// tests/sanity/global-setup.ts
import { discoverForFrontends } from '@inka/testing/playwright/global-setup';
import { API_URL, DISCOVERY_DIR, FRONTEND_URL, MOCK_PARENT_URL, PROJECT } from './sanity';

export default () => discoverForFrontends({
  discoveryDir: DISCOVERY_DIR,
  frontends: { [PROJECT]: FRONTEND_URL },
  apiUrl: API_URL,
  mockParentUrl: MOCK_PARENT_URL,
});

// tests/sanity/block-sanity.spec.ts
import { defineBlockSanityTests } from '@inka/testing/playwright/sanity';
import { API_URL, DISCOVERY_DIR, FRONTEND_URL, MOCK_PARENT_URL, PROJECT } from './sanity';

defineBlockSanityTests({
  discoveryDir: DISCOVERY_DIR,
  frontends: { [PROJECT]: FRONTEND_URL },
  projects: [PROJECT],
  apiUrl: API_URL,
  mockParentUrl: MOCK_PARENT_URL,
});

// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { API_URL, DISCOVERY_DIR, FRONTEND_URL, MOCK_PARENT_URL, PROJECT } from './tests/sanity/sanity';

process.env.FRONTEND_URL ??= FRONTEND_URL;
process.env.MOCK_PARENT_URL ??= MOCK_PARENT_URL;

export default defineConfig({
  globalSetup: './tests/sanity/global-setup.ts',
  reporter: [
    ['list'],
    ['@inka/testing/playwright/coverage-reporter', { discoveryDir: DISCOVERY_DIR }],
  ],
  projects: [{ name: PROJECT, testDir: './tests/sanity', testMatch: /block-sanity\.spec\.ts/ }],
  webServer: [
    {
      command: 'node_modules/.bin/inka-mock-api',
      env: { PORT: '8891', CONTENT_MOUNTS: '/:content' },
      url: `${API_URL}/health`,
    },
    {
      command: 'node_modules/.bin/inka-mock-parent',
      env: { PORT: '8892', API_URL, FRONTEND_URL },
      url: MOCK_PARENT_URL,
    },
    { command: 'npm run dev -- --port 3000', url: FRONTEND_URL },
  ],
});
```

`npm run dev` stands for however your front end starts, told the mock API's URL as its API. The same module has `defineEmptyRegionTests`, `defineListingContainerTests` and `definePageIntegrityTests`, for the other checks on the rendered page.

### GitHub Actions

```text
jobs:
  block-sanity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { submodules: true }   # the Inka checkout at inka/
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - name: Install
        run: |
          npm install -g corepack && corepack enable
          pnpm install --frozen-lockfile
          pnpm exec playwright install --with-deps chromium
      - name: Block sanity
        run: pnpm exec playwright test --project=block-sanity
```

Playwright starts the three servers from the config, so the job only installs and runs.

To run the mock API and editor from a checkout of Inka itself, see [Previewing and testing content](./testing-content.md).

## The adapter contract

Inka's Playwright suite has an `api-contract` project (`tests-playwright/api`). It checks the API behaviour Inka relies on: content types and their fields, workflow and sharing, navigation, and that block regions save. It runs against the mock API; an adapter has to give the same answers. See the [adapter guide](../adapters/index.md).
