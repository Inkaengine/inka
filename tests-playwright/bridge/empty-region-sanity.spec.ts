/**
 * Auto-discovered "empty container region" sanity tests.
 *
 * Reads .discovered-empty-regions.json (written by globalSetup): every region of
 * every container block type (blocks_layout, and object_list items that hold
 * blocks), paired with a real container example, plus the page's own regions.
 *
 * For each, load that container's page in the mock parent and empty the region
 * the way an editor's delete does — the admin's own deleteBlockFromContainer +
 * ensureEmptyBlockIfEmpty (mockParent.emptyRegion). When the region names no
 * default and allows more than one type, the admin seeds the special
 * `@type:"empty"` placeholder: the editor's only way to add the first block.
 * Assert it is drawn, visible, with a size to click. This catches the class of
 * bug where a container renderer rejects the empty child (e.g. a
 * contextNavigation that only expects navItem/listing) or draws it with no size.
 *
 * A region that seeds an ordinary block (its default, or its single allowed
 * type) is skipped: that block renders like any other, which block-sanity
 * covers. The admin's seeding decides which regions those are, so no copy of
 * that rule lives here.
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
import { revealBlock } from '../helpers/BlockVerificationHelper';
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
    const what = c.field === '*' ? `every ${c.parentType} region` : `${c.parentType}.${c.field}`;
    test(`${what} renders a placeholder when its region is empty`, async ({ page, helper }, testInfo) => {
      const frontendUrl = process.env.FRONTEND_URL || getFrontendUrl(testInfo.project.name);
      const frontend = frontendUrl ? `&frontend=${encodeURIComponent(frontendUrl)}` : '';
      const apiOrigin = process.env.DISCOVER_BLOCKS_API || URLS.mockApi;
      const mockParentUrl = process.env.MOCK_PARENT_URL || `${URLS.testFrontend}/mock-parent.html`;
      await page.goto(`${mockParentUrl}?api_path=${encodeURIComponent(`${apiOrigin}${c.pagePath}`)}${frontend}`);
      await helper.waitForIframeReady();
      await helper.waitForBridgeConnected();
      const iframe = helper.getIframe();
      // The page itself is no block element; a container is.
      if (c.blockId !== '_page') {
        await expect(iframe.locator(`[data-block-uid="${c.blockId}"]`).first(), `container ${c.blockId} did not render on ${c.pagePath}`)
          .toBeAttached({ timeout: 10000 });
      }

      const regions: string[] = c.field === '*'
        ? (await page.evaluate((id) => (window as any).mockParent.listRegions(id), c.blockId)).map((r: { region: string }) => r.region)
        : [c.field];
      expect(regions.length, `${c.parentType} [${c.blockId}] lists no regions`).toBeGreaterThan(0);

      let checked = 0;
      for (const region of regions) {
        const where = `${c.parentType} [${c.blockId}] region "${region}" on ${c.pagePath}`;
        // Empty it with the admin's own code — delete each child, then seed.
        const result: { skipped?: string; seeded?: { uid: string; type: string | null }[] } = await page.evaluate(
          ([id, r]) => (window as any).mockParent.emptyRegion(id, r), [c.blockId, region] as const,
        );
        if (result.skipped) {
          testInfo.annotations.push({ type: 'region-skipped', description: `${where}: ${result.skipped}` });
          continue;
        }
        const seeded = result.seeded ?? [];
        expect.soft(seeded.length, `${where}: emptying it left nothing to click`).toBeGreaterThan(0);
        const placeholders = seeded.filter((b) => b.type === 'empty');
        if (seeded.length && !placeholders.length) {
          testInfo.annotations.push({
            type: 'region-skipped',
            description: `${where}: seeds ${seeded.map((b) => b.type).join(', ')}, not the empty placeholder`,
          });
          continue;
        }
        checked++;
        for (const { uid, type } of placeholders) {
          const el = iframe.locator(`[data-block-uid="${uid}"]`).first();
          // Show it first: it may sit in a collapsed panel or an inactive slide,
          // or in a region a frontend draws only once asked (a search's answer).
          await revealBlock(iframe, uid);
          await expect.soft(el, `${where}: the frontend did not draw the seeded ${type} placeholder (${uid})`)
            .toBeAttached({ timeout: 10000 });
          if ((await iframe.locator(`[data-block-uid="${uid}"]`).count()) === 0) continue;
          const box = await el.boundingBox();
          expect.soft(
            !!box && box.width > 0 && box.height > 0,
            `${where}: the seeded ${type} placeholder (${uid}) has no size to click, got ${JSON.stringify(box)}`,
          ).toBe(true);
        }
      }
      test.skip(checked === 0, `no region of ${c.parentType} [${c.blockId}] seeds the empty placeholder`);
    });
  }
});
