/**
 * The mock parent must merge templates the way the real admin does.
 *
 * View.jsx runs `mergeTemplatesIntoPage` before it posts INITIAL_DATA — that is
 * what stamps a forced layout's blocks onto the page and mints the
 * `templateInstanceId` that template edit mode unlocks by. The mock parent used
 * to post the raw page JSON straight from the API, so any page with a forced
 * region (a site footer, a global announcement) reached the bridge WITHOUT its
 * chrome: the frontend still rendered the footer (frontends expand templates
 * themselves), but the bridge's blockPathMap had no entry for it, so the block
 * on screen could not be resolved, selected or unlocked.
 *
 * That gap made every mock-parent-driven test — block sanity above all — assert
 * against a data model the real editor never has. These tests pin the fidelity.
 */
import { test as base, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

const test = base.extend<{ helper: AdminUIHelper }>({
  helper: async ({ page }, use) => {
    await use(new AdminUIHelper(page));
  },
});

// The fixture: /_test_data/another-page is the one page whose page schema
// declares `footer: { allowedLayouts: ['/_test_data/templates/footer-layout'] }`
// (test-frontend/index.html), i.e. a forced footer, exactly like a real site's.
const PAGE = '/_test_data/another-page';

interface TemplateBlock {
  uid: string;
  type: string;
  templateId?: string;
  templateInstanceId?: string;
  readOnly?: boolean;
}

test.describe('Forced-layout merge (mock parent ↔ admin fidelity)', () => {
  test.beforeEach(async ({ page, helper }, testInfo) => {
    // Only the mock test-frontend declares the forced footer layout in the
    // `page` schema it sends on INIT; the other frontends under test render
    // their own fixtures and have no forced region to merge.
    testInfo.skip(
      testInfo.project.name !== 'mock',
      `forced-layout merge is declared by the mock test-frontend (skipping ${testInfo.project.name})`,
    );
    await page.goto(
      `${URLS.testFrontend}/mock-parent.html?api_path=${encodeURIComponent(`${URLS.mockApi}${PAGE}`)}`,
    );
    await helper.waitForIframeReady();
    await helper.waitForBridgeConnected();
  });

  /** Every block the merge stamped onto the page, read from the bridge's own data. */
  async function mergedTemplateBlocks(page: import('@playwright/test').Page) {
    const frame = page.frames().find((f) => f !== page.mainFrame())!;
    return frame.evaluate<TemplateBlock[]>(() => {
      const bridge = (window as any).__hydraBridge;
      const found: TemplateBlock[] = [];
      const walk = (blocks: Record<string, any>) => {
        for (const [uid, block] of Object.entries(blocks || {})) {
          if (!block || typeof block !== 'object') continue;
          if (block.templateId || block.templateInstanceId) {
            found.push({
              uid,
              type: block['@type'],
              templateId: block.templateId,
              templateInstanceId: block.templateInstanceId,
              readOnly: block.readOnly,
            });
          }
          for (const [key, value] of Object.entries<any>(block)) {
            if (key === 'blocks' && value && typeof value === 'object') walk(value);
            else if (value && typeof value === 'object' && value.blocks) walk(value.blocks);
          }
        }
      };
      walk(bridge?.formData?.blocks || {});
      return found;
    });
  }

  test('a forced footer layout reaches the bridge as page blocks', async ({ page }) => {
    const blocks = await mergedTemplateBlocks(page);

    // The footer-layout template contributes branding + a columns tree; without
    // the merge the bridge sees none of it.
    expect(
      blocks.map((b) => b.type),
      'forced footer blocks missing from the data the bridge received',
    ).toContain('columns');

    // The unlock key. isBlockInEditedTemplate() reads templateInstanceId, so a
    // merged block without one can never be edited, on any page.
    for (const block of blocks) {
      expect(block.templateInstanceId, `${block.uid} (${block.type}) has no templateInstanceId`).toBeTruthy();
    }
  });

  test('the merged blocks are in the blockPathMap, so the bridge can resolve them', async ({
    page,
  }) => {
    const blocks = await mergedTemplateBlocks(page);
    // Guard against passing vacuously: with no merged blocks the comparison
    // below is [] vs [] — which is exactly the broken state this pins.
    expect(blocks.length, 'no merged template blocks to look up').toBeGreaterThan(0);
    const frame = page.frames().find((f) => f !== page.mainFrame())!;
    const known = await frame.evaluate(
      (uids: string[]) => {
        const bridge = (window as any).__hydraBridge;
        return uids.filter((uid) => !!bridge?.blockPathMap?.[uid]);
      },
      blocks.map((b) => b.uid),
    );

    expect(known.sort(), 'merged blocks are absent from the blockPathMap').toEqual(
      blocks.map((b) => b.uid).sort(),
    );
  });

  test('a template definition page keeps its own blocks', async ({ page, helper }) => {
    // The other side of the same rule: a page is never merged against its OWN
    // template. footer-layout is forced into the `footer` region while its
    // definition blocks live in `items`, so the merge used to see a templateId
    // that was not among that region's allowedLayouts, drop those blocks and
    // re-insert nothing — the one page where the footer is authored came up
    // empty. (Confirmed in the real admin too, before the fix: 2 blocks, no
    // branding text.)
    await page.goto(
      `${URLS.testFrontend}/mock-parent.html?api_path=${encodeURIComponent(`${URLS.mockApi}/_test_data/templates/footer-layout`)}`,
    );
    await helper.waitForIframeReady();
    await helper.waitForBridgeConnected();

    const frame = page.frames().find((f) => f !== page.mainFrame())!;
    const own = await frame.evaluate(() =>
      Object.keys((window as any).__hydraBridge?.formData?.blocks || {}),
    );

    expect(own, 'the definition page lost its own blocks').toContain('fixed-branding');
  });

  test('a locked template block becomes editable when its instance is unlocked', async ({
    page,
  }) => {
    const blocks = await mergedTemplateBlocks(page);
    const locked = blocks.find((b) => b.readOnly);
    expect(locked, 'no readOnly block in the merged footer to unlock').toBeTruthy();
    const frame = page.frames().find((f) => f !== page.mainFrame())!;

    // Locked to begin with: this is the state an author sees on an ordinary page.
    expect(
      await frame.evaluate((uid) => (window as any).__hydraBridge.isBlockReadonly(uid), locked!.uid),
    ).toBe(true);

    // Unlocking the template instance is what the admin's editTemplate control
    // does — one TEMPLATE_EDIT_MODE message carrying the instance id.
    await page.evaluate((instanceId) => {
      (document.getElementById('previewIframe') as HTMLIFrameElement).contentWindow!.postMessage(
        { type: 'TEMPLATE_EDIT_MODE', instanceIds: [instanceId] },
        '*',
      );
    }, locked!.templateInstanceId!);

    await expect
      .poll(
        () => frame.evaluate((uid) => (window as any).__hydraBridge.isBlockReadonly(uid), locked!.uid),
        { message: 'block stayed readonly after its template instance was unlocked' },
      )
      .toBe(false);
  });
});
