/**
 * Shared fixtures for bridge tests.
 *
 * Provides a `helper` fixture that navigates to mock-parent.html with the
 * correct frontend based on the project name, waits for the iframe,
 * and selects the first block.
 *
 * Usage:
 *   import { test, expect } from './fixtures';
 *   test('my test', async ({ helper, page }) => { ... });
 */
import { test as base, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';
import { getFrontendUrl } from '../frontends';

export { FRONTEND_URLS, getFrontendUrl, SANITY_PROJECTS } from '../frontends';
export {
  sendAdminUpdate,
  adminText,
  visibleText,
  rendersBold,
  textNodesWith,
} from '@inka/testing/playwright/mock-parent';

const test = base.extend<{ helper: AdminUIHelper }>({
  helper: async ({ page }, use, testInfo) => {
    const helper = new AdminUIHelper(page);
    const url = getFrontendUrl(testInfo.project.name);
    const frontend = url ? `?frontend=${encodeURIComponent(url)}` : '';
    await page.goto(`${URLS.testFrontend}/mock-parent.html${frontend}`);
    await helper.waitForIframeReady();
    await helper.waitForIframeBlockHandle('mock-block-1');
    await use(helper);
  },
});

export { test, expect };
