import { test, expect } from '../fixtures';

/**
 * The INIT handshake: the bridge posts INIT once, and INITIAL_DATA is its only
 * acknowledgement.
 *
 * It used to re-post INIT until acknowledged, to recover an INIT the admin
 * dropped before it could answer. The admin no longer drops one — it holds an
 * INIT that arrives before the content type schema and answers it when the
 * schema lands (View.jsx) — and the re-posts did harm of their own: under load
 * the admin answered every copy, and a late answer rebuilt the page from the
 * form as it was when that copy arrived, over edits made since. An emptied
 * region came back full. So an INIT is posted once, and an INIT nobody answers
 * is a broken editor, reported as one.
 */

// Count the INITs that reach the parent; hold the first for `holdMs`, or drop
// every one when `holdMs` is null. Capture phase, installed before the mock
// parent's own listener, so stopImmediatePropagation keeps it from the parent.
const watchInits = (holdMs: number | null) => {
  (window as any).__initsSeen = 0;
  window.addEventListener(
    'message',
    (e: MessageEvent) => {
      if ((e as any).data?.type !== 'INIT' || (e as any).__replayed) return;
      (window as any).__initsSeen += 1;
      if (holdMs === null) {
        e.stopImmediatePropagation();
        return;
      }
      if ((window as any).__initsSeen !== 1) return;
      e.stopImmediatePropagation();
      setTimeout(() => {
        const again = new MessageEvent('message', { data: e.data, origin: e.origin, source: e.source });
        (again as any).__replayed = true;
        window.dispatchEvent(again);
      }, holdMs);
    },
    true,
  );
};

const bridgeInitialized = (frame: ReturnType<import('@playwright/test').Page['frameLocator']>) =>
  frame
    .locator('body')
    .evaluate(() => (window as any).__hydraBridge?.initialized === true)
    .catch(() => false);

test('posts INIT once, even when the answer is slow', async ({ page, urls }) => {
  // Slower than every interval the old retry used (250ms, then 500ms…).
  await page.addInitScript(watchInits, 1500);
  await page.goto(
    `${urls.testFrontend}/mock-parent.html?frontend=${encodeURIComponent(urls.testFrontend)}`,
  );
  const frame = page.frameLocator('#previewIframe');
  await frame.locator('body').waitFor({ state: 'attached', timeout: 15000 });

  await expect.poll(() => bridgeInitialized(frame), { timeout: 20000 }).toBe(true);
  expect(await page.evaluate(() => (window as any).__initsSeen), 'INIT is posted once').toBe(1);
});

test('an INIT nobody answers is reported, not re-posted', async ({ page, urls }) => {
  await page.addInitScript(watchInits, null);
  await page.goto(
    `${urls.testFrontend}/mock-parent.html?frontend=${encodeURIComponent(urls.testFrontend)}`,
  );
  const frame = page.frameLocator('#previewIframe');
  await frame.locator('body').waitFor({ state: 'attached', timeout: 15000 });

  // The diagnostic is what an author sees of a broken handshake.
  await expect(frame.locator('#hydra-bridge-diagnostic')).toBeVisible({ timeout: 15000 });
  expect(await bridgeInitialized(frame)).toBe(false);
  expect(await page.evaluate(() => (window as any).__initsSeen), 'INIT is posted once').toBe(1);

  // Expected here, so taken down: the fixture fails any test that ends with
  // a diagnostic showing, which is right everywhere but this one test.
  await frame.locator('body').evaluate(() => document.getElementById('hydra-bridge-diagnostic')?.remove());
});
