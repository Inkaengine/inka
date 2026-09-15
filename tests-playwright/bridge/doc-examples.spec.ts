/**
 * Parameterized tests for doc example components.
 *
 * Renders each block in the handcrafted examples.json fixture via the hydra.js
 * bridge (INIT → INITIAL_DATA → render) and asserts the expected text, against
 * a curated baseline that also exercises sub-block checks.
 *
 * Coverage of every block on the REAL served pages (render + edit annotations +
 * containment + integrity) is NOT here — it is block-sanity.spec.ts, which
 * discovers blocks dynamically from the live API (`@search`) across all mounts,
 * so it can never silently drift as content changes. This file is only the
 * curated-fixture smoke test.
 */
import { test as base, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { verifyBlockRendering } from '../helpers/BlockVerificationHelper';
import { getFrontendUrl } from './fixtures';
import { URLS } from '../ports';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { requireEnvironment } from '../helpers/preconditions';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Doc-example tests run on frontends that render blocks from fixture data.
// Skip mock/nuxt (different block handling). Skip nextjs/f7 unless their
// servers are running (they're opt-in — only started with --project=nextjs/f7).
base.beforeEach(async ({}, testInfo) => {
  const project = testInfo.project.name;
  if (project === 'mock' || project === 'nuxt') {
    testInfo.skip(true, `Doc-examples only run on doc-example frontends (not ${project})`);
  }
  // Opt-in frontends locally; started by the workflow on CI. Unreachable is a
  // skip on a laptop running one project, and a FAILURE on CI — otherwise a
  // dead frontend reports green having tested nothing.
  if (project === 'nextjs' || project === 'f7' || project === 'astro') {
    const url = getFrontendUrl(project);
    if (url) {
      let reachable = false;
      let detail = 'not reachable';
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
        reachable = resp.ok;
        if (!resp.ok) detail = `responded ${resp.status}`;
      } catch {
        reachable = false;
      }
      requireEnvironment(testInfo, reachable, `${project} server on ${url} ${detail}`);
    }
  }
});

// Load examples.json to get block data for sub-block checks
const examplesJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../fixtures/test-frontend/examples.json'), 'utf-8'),
);

const test = base.extend<{ helper: AdminUIHelper }>({
  helper: async ({ page }, use, testInfo) => {
    const helper = new AdminUIHelper(page);
    const frontendUrl = getFrontendUrl(testInfo.project.name);
    const frontend = frontendUrl ? `&frontend=${encodeURIComponent(frontendUrl)}` : '';
    await page.goto(
      `${URLS.testFrontend}/mock-parent.html?content=examples${frontend}`,
    );
    await helper.waitForIframeReady();
    await use(helper);
  },
});

/**
 * Block examples to test. Each entry describes a block in the examples fixture.
 */
const examples = [
  {
    type: 'hero',
    blockId: 'ex-hero',
    expectedText: 'Welcome to Our Site',
  },
  {
    type: 'slate',
    blockId: 'ex-slate',
    expectedText: 'Welcome',
  },
  {
    type: 'image',
    blockId: 'ex-image',
    expectedText: null,
  },
  {
    type: 'teaser',
    blockId: 'ex-teaser',
    expectedText: 'Custom Title',
  },
  {
    type: 'table',
    blockId: 'ex-table',
    expectedText: 'Name',
  },
  {
    type: 'columns',
    blockId: 'ex-columns',
    expectedText: 'Design',
  },
  {
    type: 'accordion',
    blockId: 'ex-accordion',
    expectedText: 'Frequently Asked Questions',
  },
  {
    type: 'slider',
    blockId: 'ex-slider',
    expectedText: 'Product Launch 2025',
  },
  {
    type: 'listing',
    blockId: 'ex-listing',
    expectedText: null,
    isListing: true,
  },
  {
    type: 'search',
    blockId: 'ex-search',
    expectedText: 'Filter by',
  },
  {
    type: 'form',
    blockId: 'ex-form',
    expectedText: 'Contact Us',
  },
  {
    type: 'introduction',
    blockId: 'ex-introduction',
    expectedText: null,
  },
  {
    type: 'heading',
    blockId: 'ex-heading',
    expectedText: 'Getting Started',
  },
  {
    type: 'separator',
    blockId: 'ex-separator',
    expectedText: null,
  },
  {
    type: 'button',
    blockId: 'ex-button',
    expectedText: 'Learn More',
  },
  {
    type: 'highlight',
    blockId: 'ex-highlight',
    expectedText: 'Featured Content',
  },
  {
    type: 'video',
    blockId: 'ex-video',
    expectedText: null,
  },
  {
    type: 'toc',
    blockId: 'ex-toc',
    expectedText: 'Getting Started',
  },
  {
    type: 'maps',
    blockId: 'ex-maps',
    expectedText: null,
  },
  {
    type: 'codeExample',
    blockId: 'ex-codeExample',
    expectedText: 'Hello, World!',
  },
];

test.describe('Doc example blocks', () => {
  for (const example of examples) {
    test(`${example.type} block renders`, async ({ helper, page }) => {
      const iframe = helper.getIframe();
      const blockData = examplesJson.blocks?.[example.blockId];
      await verifyBlockRendering(page, iframe, example.blockId, blockData, {
        expectedText: example.expectedText,
        isListing: example.isListing,
      });
    });
  }
});
