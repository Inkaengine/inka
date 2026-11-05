/**
 * Playwright test fixtures: everything a spec needs from the harness.
 *
 * `test` is Playwright's own, with the page wired the way every harness suite
 * wants it: browser console and page errors in the test output, a run id on
 * the page so parallel runs' logs can be told apart, and a failure when hydra.js
 * painted a diagnostic overlay during an otherwise passing test.
 *
 * `withAddresses` adds a suite's own addresses to it:
 *
 *   const { PORTS, URLS } = definePorts({ myFrontend: 5 });
 *   export const test = withAddresses(URLS, PORTS);
 *   test('…', async ({ page, urls }) => { await page.goto(urls.myFrontend); });
 */
import { test as playwrightTest, expect } from '@playwright/test';

const test = playwrightTest.extend({
  page: async ({ page }, use, testInfo) => {
    // Session isolation is handled via auth tokens - each login generates a unique
    // token (based on timestamp) which the mock API uses as the session identifier.
    // The admin (Volto) and a frontend's SSR both include Authorization headers, so they share
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

export interface Addresses<Urls, Ports> {
  /** Addresses, as `http://host:port`. */
  urls: Urls;
  /** Port numbers, for the few things that need the number itself. */
  ports: Ports;
}

/**
 * The harness `test`, handing every test its addresses.
 *
 * A test is HANDED its urls — `async ({ page, urls })` — so it never imports
 * them, never names a port variable, and never learns that ports are
 * configurable at all. It wants "the mock API" and "the admin"; that they come
 * from a block that starts somewhere is the harness's business.
 */
export function withAddresses<Urls, Ports>(urls: Urls, ports: Ports) {
  return test.extend<{}, Addresses<Urls, Ports>>({
    // The same frozen objects every test, no setup cost.
    urls: [async ({}, use) => { await use(urls); }, { scope: 'worker' }],
    ports: [async ({}, use) => { await use(ports); }, { scope: 'worker' }],
  });
}

export { test, expect };
