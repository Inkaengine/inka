/**
 * Auto-discovered "empty container region" sanity tests.
 *
 * Reads .discovered-empty-regions.json (written by globalSetup): one entry per
 * blocks_layout region that seeds an `@type:"empty"` placeholder when emptied
 * (no defaultBlockType + >1 allowedBlocks), paired with a real container example.
 *
 * For each, we load that container's page but page.route the fetch to strip the
 * region down to a single seeded `@type:"empty"` — the exact state Hydra leaves
 * a no-default, multi-allowed region in when its last child is deleted — and
 * assert the region still renders a `[data-block-uid]` placeholder rather than
 * throwing or going blank. This catches the class of bug where a custom
 * container renderer rejects a seeded empty child (e.g. a contextNavigation that
 * only expects navItem/listing).
 *
 * Run with:
 *   DISCOVER_BLOCKS_API=<mock-api-url> pnpm exec playwright test empty-region-sanity
 */
import { test as base, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { getFrontendUrl } from './fixtures';
import { URLS } from '../ports';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { requireEnvironment } from '../helpers/preconditions';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface EmptyRegionCase {
  parentType: string;
  field: string;
  pagePath: string;
  blockId: string;
}

const casesPath = path.resolve(__dirname, '../../.discovered-empty-regions.json');
let cases: EmptyRegionCase[] = [];
if (fs.existsSync(casesPath)) {
  cases = JSON.parse(fs.readFileSync(casesPath, 'utf-8'));
}

// Synthetic conversion-test containers (dnd-convert.spec.ts) are rendered only
// by the mock frontend, so they aren't part of the cross-frontend empty-region
// contract — exclude them (same rationale as block-sanity).
cases = cases.filter((c) => !c.parentType.startsWith('conv'));

// Same frontends as block-sanity — the ones with full block coverage.
const SANITY_PROJECTS = new Set(['mock', 'nuxt', 'nextjs']);
const EMPTY_CHILD_ID = 'sanity-empty-child';

/**
 * Find the container `blockId` anywhere in a page's block tree (nested blocks
 * dicts + arrays like accordion panels / slides) and strip its `field` region
 * to a single seeded `@type:"empty"` child. Returns true if found + emptied.
 */
function emptyRegionInPage(node: any, blockId: string, field: string): boolean {
  if (!node || typeof node !== 'object') return false;
  const blocks = node.blocks;
  if (blocks && typeof blocks === 'object') {
    const container = blocks[blockId];
    if (container && typeof container === 'object') {
      container.blocks = container.blocks || {};
      container.blocks[EMPTY_CHILD_ID] = { '@type': 'empty' };
      container.blocks_layout = container.blocks_layout || {};
      container.blocks_layout[field] = [EMPTY_CHILD_ID];
      return true;
    }
    for (const id of Object.keys(blocks)) {
      if (emptyRegionInPage(blocks[id], blockId, field)) return true;
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && emptyRegionInPage(item, blockId, field)) return true;
      }
    }
  }
  return false;
}

base.beforeEach(async ({}, testInfo) => {
  // Scope first, environment second — see block-sanity for why the order matters.
  if (!SANITY_PROJECTS.has(testInfo.project.name)) {
    testInfo.skip(true, `empty-region sanity only runs on mock/nuxt/nextjs (skipping ${testInfo.project.name})`);
  }
  requireEnvironment(
    testInfo,
    cases.length > 0,
    'no .discovered-empty-regions.json — discovery needs DISCOVER_BLOCKS_API=<mock api url> in this job',
  );
});

const test = base.extend<{ helper: AdminUIHelper }>({
  helper: async ({ page }, use) => {
    await use(new AdminUIHelper(page));
  },
});

test.describe('Empty container region renders (auto-discovered)', () => {
  for (const c of cases) {
    test(`${c.parentType}.${c.field} renders a placeholder when its region is empty`, async ({ page, helper }, testInfo) => {
      const frontendUrl = process.env.FRONTEND_URL || getFrontendUrl(testInfo.project.name);
      const frontend = frontendUrl ? `&frontend=${encodeURIComponent(frontendUrl)}` : '';
      const apiOrigin = process.env.DISCOVER_BLOCKS_API || URLS.mockApi;
      const mockParentUrl = process.env.MOCK_PARENT_URL || `${URLS.testFrontend}/mock-parent.html`;
      const apiPath = `${apiOrigin}${c.pagePath}`;

      // Intercept the mock-parent's page fetch and empty the target region.
      let emptied = false;
      await page.route(apiPath, async (route) => {
        const resp = await route.fetch();
        const json = await resp.json();
        emptied = emptyRegionInPage(json, c.blockId, c.field);
        await route.fulfill({ response: resp, json });
      });

      await page.goto(`${mockParentUrl}?api_path=${encodeURIComponent(apiPath)}${frontend}`);
      await helper.waitForIframeReady();
      const iframe = helper.getIframe();

      // Sanity that the fixture actually got emptied (else the assertions below
      // would pass/fail for the wrong reason).
      expect(
        emptied,
        `container ${c.blockId} (${c.parentType}) not found in ${c.pagePath} to empty its ${c.field} region`,
      ).toBe(true);

      // The container must render, and its emptied region must contain the
      // seeded placeholder (with its data-block-uid) — proof the renderer
      // tolerated the empty child rather than throwing or going blank.
      await expect(iframe.locator(`[data-block-uid="${c.blockId}"]`)).toBeAttached({ timeout: 10000 });
      await expect(iframe.locator(`[data-block-uid="${EMPTY_CHILD_ID}"]`)).toBeAttached({ timeout: 10000 });
    });
  }
});
