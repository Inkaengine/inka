/**
 * Quick Start starter apps: a block is selectable in edit mode.
 *
 * Each docs/quickstart/<framework> app is the exact code shown on the frontend
 * guide page — it detects edit mode (`window.name` starts with "hydra"), calls
 * `initBridge`, renders one block type (card) editable with `data-block-uid` +
 * `data-edit-*`, and shows everything else as raw JSON. That framework-specific
 * wiring is the only thing that decides whether an author can select a block on
 * the canvas, so THAT is what this asserts — not generic block rendering, which
 * block-sanity covers.
 *
 * Runs on the quickstart frontends only (opt-in projects like `vanilla`); the
 * shared bridge/admin projects skip it. The editor is simulated by
 * mock-parent.html (no Volto): `?content=card` feeds it the card fixture, and
 * `?frontend=` frames the quickstart app in the edit iframe.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { getFrontendUrl } from './fixtures';
import { URLS } from '../ports';

// The quickstart frontends this spec runs on, each with the route its app serves
// the snippet at (undefined = mock-parent's default path). vanilla is a dedicated
// blank app served at any path; nuxt reuses the blog starter, which serves the
// snippet at its own /quickstart-card route (so content_path points the iframe
// there while the card fixture still supplies the data).
const QUICKSTART_FRONTENDS: Record<string, { contentPath?: string }> = {
  vanilla: {},
  nuxt: { contentPath: '/quickstart-card' },
  nextjs: { contentPath: '/quickstart-card' },
};
const QUICKSTART_PROJECTS = new Set(Object.keys(QUICKSTART_FRONTENDS));

const CARD = 'card-1';   // rendered editable by the app
const OTHER = 'other-1'; // a non-card block the app shows as JSON — still selectable

const parentUrl = (frontend: string, contentPath?: string) =>
  `${URLS.testFrontend}/mock-parent.html?content=card` +
  `&frontend=${encodeURIComponent(frontend)}` +
  (contentPath ? `&content_path=${encodeURIComponent(contentPath)}` : '');

// The uid the bridge reports as selected, read from the frontend document.
const selectedUid = (helper: AdminUIHelper) =>
  helper
    .getIframe()
    .locator('body')
    .evaluate(
      (node: HTMLElement) =>
        (node.ownerDocument.defaultView as any).__hydraBridge?.selectedBlockUid,
    );

test.describe('Quick Start starter: selecting a block in edit mode', () => {
  test.beforeEach(async ({}, testInfo) => {
    if (!QUICKSTART_PROJECTS.has(testInfo.project.name)) {
      testInfo.skip(
        true,
        `quickstart selection runs only on the quickstart frontends (not ${testInfo.project.name})`,
      );
    }
  });

  test('clicking a block on the canvas selects it', async ({ page }, testInfo) => {
    const helper = new AdminUIHelper(page);
    const frontend = getFrontendUrl(testInfo.project.name);
    expect(frontend, `no frontend URL for project ${testInfo.project.name}`).toBeTruthy();

    await page.goto(parentUrl(frontend!, QUICKSTART_FRONTENDS[testInfo.project.name].contentPath));
    await helper.waitForIframeReady();
    await helper
      .getIframe()
      .locator(`[data-block-uid="${CARD}"]`)
      .waitFor({ state: 'attached', timeout: 10000 });

    // The parent auto-selects the first block on load; wait for that to land so
    // a click that changes the selection isn't racing the initial one.
    await expect.poll(() => selectedUid(helper), { timeout: 15000 }).toBeTruthy();

    // Selecting the non-card block proves a click genuinely changes selection…
    await helper.getIframe().locator(`[data-block-uid="${OTHER}"]`).click();
    await expect.poll(() => selectedUid(helper), { timeout: 5000 }).toBe(OTHER);

    // …and the card block — the one the app renders editable — is selectable too.
    await helper.getIframe().locator(`[data-block-uid="${CARD}"]`).click();
    await expect.poll(() => selectedUid(helper), { timeout: 5000 }).toBe(CARD);
  });
});
