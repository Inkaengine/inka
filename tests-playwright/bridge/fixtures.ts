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
import type { Locator, Page } from '@playwright/test';
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
  vanilla: URLS.vanillaDoc,
  'svelte-qs': URLS.svelteQs,
  'astro-qs': URLS.astroQs,
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

/**
 * Act like the admin after an inline edit: send the next FORM_DATA — the page as
 * the admin now holds it (with the edit), plus a change to ANOTHER block. The
 * real admin does this whenever anything else changes (a block added, a sidebar
 * field set). Echoes of the edit itself are not re-rendered, so this is what
 * re-renders the edited block; a bug that only shows on the next render (text
 * the bridge typed into a node the frontend didn't render) needs it.
 *
 * `otherBlock` must be a slate block other than the one being edited. Returns
 * once that block shows `marker`, so the re-render has happened.
 */
export async function sendAdminUpdate(
  page: Page,
  helper: AdminUIHelper,
  otherBlock: string,
  marker: string,
): Promise<void> {
  await page.evaluate(
    ({ otherBlock, marker }) => {
      const mockParent = (window as any).mockParent;
      const data = JSON.parse(JSON.stringify(mockParent.getFormData()));
      data.blocks[otherBlock].value = [{ type: 'p', children: [{ text: marker }] }];
      (document.getElementById('previewIframe') as HTMLIFrameElement).contentWindow!.postMessage(
        { type: 'FORM_DATA', data, blockPathMap: mockParent.buildBlockPathMap() },
        '*',
      );
    },
    { otherBlock, marker },
  );
  await expect(helper.getIframe().locator(`[data-block-uid="${otherBlock}"]`)).toContainText(marker);
}

/** The admin's copy of a block's slate text, as the bridge last sent it. */
export function adminText(page: Page, blockId: string): Promise<string> {
  return page.evaluate((id) => {
    const walk = (n: any): string =>
      typeof n?.text === 'string' ? n.text : (n?.children || []).map(walk).join('');
    return ((window as any).mockParent.getBlock(id)?.value || []).map(walk).join('');
  }, blockId);
}

/**
 * A field's text as the reader sees it: the bridge's zero-width characters
 * removed, and a non-breaking space (what the browser inserts for a space typed
 * at the end of a run) read as a space, as the bridge reads it back.
 */
export function visibleText(field: Locator): Promise<string> {
  return field.evaluate((el) =>
    (el.textContent || '').replace(/[\uFEFF\u200B]/g, '').replace(/\u00A0/g, ' '),
  );
}

/**
 * Whether `text` renders bold, judged by its computed font weight — never by
 * markup. Frontends render bold however they like (the mock frontend
 * deliberately uses <span style="font-weight: bold">, not <strong>), so a test
 * must not assume an element.
 */
export function rendersBold(field: Locator, text: string): Promise<boolean> {
  return field.evaluate((el, t) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const plain = (n.textContent || '').replace(/[\uFEFF\u200B]/g, '').replace(/\u00A0/g, ' ');
      if (plain.includes(t)) {
        return Number(getComputedStyle(n.parentElement as Element).fontWeight) >= 600;
      }
    }
    return false;
  }, text);
}

/** The text nodes under a field that contain `text` — one, unless it is shown twice. */
export function textNodesWith(field: Locator, text: string): Promise<string[]> {
  return field.evaluate((el, t) => {
    const found: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.textContent?.includes(t)) found.push(n.textContent);
    }
    return found;
  }, text);
}

export { test, expect };
