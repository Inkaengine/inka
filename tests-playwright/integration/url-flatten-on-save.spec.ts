/**
 * Integration coverage for Hydra's dynamic publicURL — i.e. the
 * publicUrlSync middleware that updates `settings.publicURL` when the
 * editor switches iframe frontends.
 *
 * Setup registers two reachable frontends, both pointing at the same
 * test-frontend server but addressed by different hostnames so the
 * browser treats them as distinct origins:
 *
 *   Frontend A: http://localhost:<port>   → publishUrl http://www.published-a.example.test
 *   Frontend B: http://127.0.0.1:<port>   → publishUrl http://www.published-b.example.test
 *
 * Both serve real content (the iframe loads), so we can paste-edit-save
 * in each one without hitting a broken iframe. The test:
 *
 *   1. Active = A on load (cookie). Paste A's publishUrl into a link
 *      widget, save, assert the PATCH body's slate node has the
 *      apiPath-prefixed flattened path — A's publish origin is gone.
 *   2. Switch to B via the toolbar switcher (real click on
 *      .frontend-switcher-url-item). Re-enter edit mode. Paste B's
 *      publishUrl, save, assert the same — B's publish origin gone.
 *
 * If publicURL were pinned (RAZZLE_PUBLIC_URL or any static value),
 * exactly one of the two pastes would survive. Both pass only when
 * publicURL follows the active frontend.
 */
import { test, expect, PORTS, URLS } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

const FRONTEND_A_EDIT = `http://localhost:${PORTS.testFrontend}`;
const FRONTEND_A_PUBLISH = 'http://www.published-a.example.test';
const FRONTEND_B_EDIT = `http://127.0.0.1:${PORTS.testFrontend}`;
const FRONTEND_B_PUBLISH = 'http://www.published-b.example.test';

test.describe('publicURL follows the active iframe frontend', () => {
  test.beforeEach(async ({ page }) => {
    // Register both frontends BEFORE Volto loads. iframe_url cookie pins
    // A as the active one on initial render; applyConfig + middleware
    // then derive settings.publicURL = A.publishUrl.
    await page.context().addCookies([
      {
        name: `saved_urls_${PORTS.voltoSsr}`,
        value: [
          `A|${FRONTEND_A_EDIT}|${FRONTEND_A_PUBLISH}`,
          `B|${FRONTEND_B_EDIT}|${FRONTEND_B_PUBLISH}`,
        ].join(','),
        url: URLS.voltoSsr,
      },
      {
        name: `iframe_url_${PORTS.voltoSsr}`,
        value: FRONTEND_A_EDIT,
        url: URLS.voltoSsr,
      },
    ]);
  });

  test('paste-and-save uses the active frontend on load, then follows a UI switch', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    const patchBodies: any[] = [];
    page.on('request', (req) => {
      if (
        req.method() === 'PATCH' &&
        req.url().includes('/_test_data/test-page')
      ) {
        try {
          patchBodies.push(JSON.parse(req.postData() || '{}'));
        } catch {
          // non-JSON PATCH — ignore
        }
      }
    });

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // ---- Step 1: paste A's publishUrl while A is the active frontend.
    const blockA = 'block-1-uuid';
    await helper.editBlockTextInIframe(blockA, 'Click here');
    let editor = await helper.getEditorLocator(blockA);
    await helper.selectAllTextInEditor(editor);
    await helper.clickFormatButton('link');
    await helper.waitForLinkEditorPopup();
    await (await helper.getLinkEditorUrlInput()).fill(
      `${FRONTEND_A_PUBLISH}/_test_data/another-page`,
    );
    await page.keyboard.press('Enter');
    await expect(async () => {
      const html = await editor.innerHTML();
      expect(html).toContain('<a ');
    }).toPass({ timeout: 5000 });
    await helper.saveContent();

    const patchAfterA = patchBodies.at(-1);
    expect(patchAfterA, 'expected a PATCH after first save').toBeTruthy();
    const slateA = JSON.stringify(patchAfterA.blocks?.[blockA]);
    expect(slateA, `slate node for ${blockA} should be in PATCH`).toBeTruthy();
    expect(slateA, 'A publish origin must not survive the first save').not.toContain(
      FRONTEND_A_PUBLISH,
    );
    expect(
      slateA,
      'first save should store the apiPath-prefixed flattened path',
    ).toContain(`${URLS.mockApi}/_test_data/another-page`);

    // ---- Step 2: switch to B in the toolbar, then paste B's publishUrl.
    await helper.navigateToEdit('/test-page');
    await helper.switchFrontend('B', FRONTEND_B_EDIT);

    const blockB = 'block-3-uuid'; // different slate block so block-1's link stays put
    await helper.editBlockTextInIframe(blockB, 'Click here');
    editor = await helper.getEditorLocator(blockB);
    await helper.selectAllTextInEditor(editor);
    await helper.clickFormatButton('link');
    await helper.waitForLinkEditorPopup();
    await (await helper.getLinkEditorUrlInput()).fill(
      `${FRONTEND_B_PUBLISH}/_test_data/another-page`,
    );
    await page.keyboard.press('Enter');
    await expect(async () => {
      const html = await editor.innerHTML();
      expect(html).toContain('<a ');
    }).toPass({ timeout: 5000 });
    await helper.saveContent();

    const patchAfterB = patchBodies.at(-1);
    expect(
      patchAfterB,
      'expected a PATCH after the second save',
    ).toBeTruthy();
    const slateB = JSON.stringify(patchAfterB.blocks?.[blockB]);
    expect(slateB, `slate node for ${blockB} should be in PATCH`).toBeTruthy();
    expect(
      slateB,
      'B publish origin must not survive the post-switch save',
    ).not.toContain(FRONTEND_B_PUBLISH);
    expect(
      slateB,
      'post-switch save should store the apiPath-prefixed flattened path',
    ).toContain(`${URLS.mockApi}/_test_data/another-page`);
  });
});
