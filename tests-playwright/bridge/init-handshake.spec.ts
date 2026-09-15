import { test, expect } from '@playwright/test';
import { URLS } from '../ports';

/**
 * The INIT handshake has to survive an INIT that does not get through.
 *
 * The bridge posts INIT exactly once and treats INITIAL_DATA as the only
 * acknowledgement, so nothing recovers a lost one: if the admin's message
 * listener is not mounted yet — a real race whenever the admin is slow to
 * hydrate — the editor stays dead until someone reloads the page. All hydra
 * does about it is paint a "Not Connected" diagnostic 5 seconds later, which
 * reports the symptom and fixes nothing.
 *
 * The race is widened by load (it is why block-sanity fails under two workers),
 * so this reproduces it deterministically instead: a capture-phase listener in
 * the parent swallows the FIRST INIT and lets everything after it through. A
 * bridge that retries connects anyway. A bridge that posts once never does.
 */
test('connects even when the first INIT is lost', async ({ page }) => {
  await page.addInitScript(() => {
    // Capture phase, installed before mock-parent's own listener, so
    // stopImmediatePropagation drops the message before the parent sees it.
    (window as any).__initsSeen = 0;
    window.addEventListener(
      'message',
      (e: MessageEvent) => {
        if ((e as any).data?.type !== 'INIT') return;
        (window as any).__initsSeen += 1;
        if ((window as any).__initsSeen === 1) e.stopImmediatePropagation();
      },
      true,
    );
  });

  await page.goto(
    `${URLS.testFrontend}/mock-parent.html?frontend=${encodeURIComponent(URLS.testFrontend)}`,
  );

  const frame = page.frameLocator('#previewIframe');
  await frame.locator('body').waitFor({ state: 'attached', timeout: 15000 });

  await expect
    .poll(
      () =>
        frame
          .locator('body')
          .evaluate(() => (window as any).__hydraBridge?.initialized === true)
          .catch(() => false),
      {
        timeout: 20000,
        message:
          'bridge never initialized after its first INIT was dropped — INIT is posted once with no retry',
      },
    )
    .toBe(true);

  // The retry has to be a retry, not a flood.
  const seen = await page.evaluate(() => (window as any).__initsSeen);
  expect(seen, 'INIT should be retried, and only as often as needed').toBeGreaterThan(1);
  expect(seen, 'INIT retries should back off, not spin').toBeLessThan(8);
});
