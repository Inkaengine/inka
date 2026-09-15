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

/**
 * Map project names to frontend URLs.
 * The default (mock) uses the test frontend embedded on port 8888.
 */
// The frontends block-sanity ENFORCES. Others (react, svelte, vue, f7) ship
// partial block coverage on purpose and skip the render contract — so nothing
// discovered for them is ever asserted. Discovery reads this too: scanning a
// frontend whose cases can only skip cost the react/svelte/vue/astro job ~1736
// entries EACH and pushed it past the 30m CI limit.
export const SANITY_PROJECTS = new Set(['mock', 'nuxt', 'nextjs']);

export const FRONTEND_URLS: Record<string, string> = {
  nuxt: URLS.nuxt,
  react: URLS.reactDoc,
  svelte: URLS.svelteDoc,
  vue: URLS.vueDoc,
  nextjs: URLS.nextjs,
  f7: URLS.f7,
  astro: URLS.astroDoc,
};

export function getFrontendUrl(projectName: string): string | undefined {
  return FRONTEND_URLS[projectName];
}

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
