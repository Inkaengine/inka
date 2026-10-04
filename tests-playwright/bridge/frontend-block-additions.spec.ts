/**
 * A frontend that sends an entry for a block the admin already has, WITHOUT a
 * schema of its own, adds to that block — it does not replace it. The admin
 * does this (a frontend's slate entry carrying only `fieldRules` keeps the
 * admin's slate schema); the mock parent must too, or every harness that runs
 * on it (block-sanity) sees a slate block with no slate field: no node ids
 * rendered, and slate no longer allowed on the page.
 *
 * The test frontend's /block-formats-page sends exactly that: a slate entry
 * with only a schemaEnhancer (a warning about Heading 5).
 */
import { test, expect } from './fixtures';
import { URLS } from '../ports';

const PAGE = '/_test_data/block-formats-page';

test.describe('A frontend adding to a block the admin has', () => {
  test.beforeEach(async ({ page, helper }, testInfo) => {
    testInfo.skip(
      testInfo.project.name !== 'mock',
      `the partial slate entry is sent by the mock test-frontend (skipping ${testInfo.project.name})`,
    );
    await page.goto(
      `${URLS.testFrontend}/mock-parent.html?api_path=${encodeURIComponent(`${URLS.mockApi}${PAGE}`)}`,
    );
    await helper.waitForIframeReady();
    await helper.waitForBridgeConnected();
  });

  test('keeps the block\'s own schema and gains the frontend\'s rules', async ({ page }) => {
    const slate = await page.evaluate(() => {
      const cfg = (window as any).mockParent.getBlocksConfig().slate;
      return {
        valueWidget: cfg?.blockSchema?.properties?.value?.widget,
        rules: JSON.stringify(cfg?.schemaEnhancer ?? null),
      };
    });
    expect(slate.valueWidget, 'the slate field the admin\'s slate block has').toBe('slate');
    expect(slate.rules, 'the frontend\'s rule, added').toContain('Heading 5');
  });

  test('a slate block on that page still renders its node ids', async ({ helper }) => {
    await expect(
      helper.getIframe().locator('[data-block-uid="target"] [data-node-id], [data-block-uid="target"][data-node-id]').first(),
    ).toBeAttached();
  });
});
