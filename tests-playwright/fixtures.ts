/**
 * Playwright test fixtures: everything a spec needs from the harness.
 *
 * All test files should import `test` and `expect` from this file instead of
 * directly from @playwright/test — and `URLS`/`PORTS` from here too, rather
 * than from ports.ts.
 *
 * Usage in test files:
 *   import { test, expect, URLS } from '../fixtures';
 *   // or
 *   import { test, expect } from '../../fixtures';
 */

import { test as playwrightTest, expect } from '@playwright/test';
import { PORTS, URLS } from './ports';

/**
 * Where a test gets an address.
 *
 * A test is HANDED its urls — `async ({ page, urls })` — so it never imports
 * them, never names a port variable, and never learns that ports are
 * configurable at all. It wants "the mock API" and "the admin"; that they come
 * from a block that starts somewhere is the harness's business.
 *
 * `URLS`/`PORTS` are also exported, for the places a fixture cannot reach: a
 * constant built once above the tests, a `test.use()`, a cookie name holding a
 * port number. Those are module scope, and a fixture only exists inside a test
 * body. Inside a test, take the fixture.
 *
 * ports-are-not-hardcoded.test.ts holds the rule: a spec that imports the
 * ports module directly fails. That is the door the numbers came back through
 * before — a suite that decided its own ports, with its own `const PORT`.
 */
export { PORTS, URLS };

export interface HarnessUrls {
  /** Addresses, as `http://host:port`. */
  urls: typeof URLS;
  /** Port numbers, for the few things that need the number itself. */
  ports: typeof PORTS;
}

// Extend test to capture console logs from page and iframe
const test = playwrightTest.extend<HarnessUrls>({
  // Worker-scoped in effect: the same frozen objects every test, no setup cost.
  // Declared as fixtures rather than imported so a spec cannot be written
  // against a port at all — see the note above.
  urls: [async ({}, use) => { await use(URLS); }, { scope: 'worker' }],
  ports: [async ({}, use) => { await use(PORTS); }, { scope: 'worker' }],
  page: async ({ page }, use, testInfo) => {
    // Session isolation is handled via auth tokens - each login generates a unique
    // token (based on timestamp) which the mock API uses as the session identifier.
    // Both admin (Volto) and Nuxt SSR include Authorization headers, so they share
    // the same session when using the same auth token.

    // Set run ID on admin page so parallel/repeated test logs can be filtered.
    // AdminUIHelper.navigateToEdit propagates this to the iframe.
    const runId = testInfo.workerIndex * 1000 + testInfo.repeatEachIndex;
    page.addInitScript((id) => {
      (window as any).__testRunId = id;
    }, runId);

    // Capture main page console logs
    page.on('console', (msg) => {
      console.log(`[log] ${msg.text()}`);
    });

    // Capture page errors
    page.on('pageerror', (error) => {
      console.log(`[BROWSER PAGE ERROR] ${error.message}`);
    });

    await use(page);

    // After the test, fail if hydra.js painted a diagnostic overlay inside
    // the preview iframe. Two overlays exist:
    //   #hydra-bridge-diagnostic — bridge never connected to the admin
    //   #hydra-dev-warning       — e.g. a Slate field with no data-node-id
    // Both mean the editor was broken during the test even if the test's
    // own assertions happened to pass. Only enforced when the test would
    // otherwise pass, so a real failure isn't masked by this check.
    if (testInfo.status === 'passed' && testInfo.expectedStatus === 'passed') {
      try {
        const iframeCount = await page.locator('#previewIframe').count();
        if (iframeCount > 0) {
          const overlays = await page
            .frameLocator('#previewIframe')
            .locator('#hydra-bridge-diagnostic, #hydra-dev-warning')
            .count();
          if (overlays > 0) {
            const text = await page
              .frameLocator('#previewIframe')
              .locator('#hydra-bridge-diagnostic, #hydra-dev-warning')
              .first()
              .innerText()
              .catch(() => '(overlay text unavailable)');
            throw new Error(
              `hydra.js diagnostic overlay appeared during this test — the ` +
                `editor was in a broken state. Overlay text:\n${text}`,
            );
          }
        }
      } catch (err) {
        // Re-throw our own assertion; swallow incidental teardown errors
        // (e.g. page already closed) so they don't mask a green test.
        if (err instanceof Error && err.message.includes('diagnostic overlay appeared')) {
          throw err;
        }
      }
    }
  },
});

export { test, expect };
