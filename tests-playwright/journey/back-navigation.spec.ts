import { test, expect, type Page } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { fixtureFor } from './fixtures';
import { nameLike } from './steps';
import { seedWordPress } from './seedWordPress';

/**
 * Browser history, on its own.
 *
 * This used to be a step inside the main journey, which made it the flakiest
 * thing in the suite for reasons that had nothing to do with the journey: a
 * back hop reloads the iframe, and the adapter runs INSIDE that iframe, so its
 * in-flight reads are aborted mid-navigation. The listing then rendered empty
 * even though its data had been fetched correctly — the failure was a sibling
 * read dying, not the listing being wrong.
 *
 * Asked directly here, that becomes the assertion rather than the noise: go
 * somewhere, come back, and the restored route shows its content again.
 *
 * Whether that content is refetched or served from what the adapter already
 * holds is deliberately NOT asserted — it is an implementation detail, and the
 * adapter retains reads precisely so a revisit need not cost a round trip. The
 * observable requirement is that the listing is there.
 */

// Real WordPress boots empty; the mocks do not. Seeded here rather than in a
// shared global setup so the cost lands only on the project that needs it.
test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'journey-wordpress') return;
  // Seeding real WordPress is dozens of writes at ~1.1s each on PHP-WASM,
  // comfortably past the suite's 45s default, which applies to hooks too.
  testInfo.setTimeout(240_000);
  await seedWordPress();
});

async function waitForRows(page: Page, timeout = 60_000) {
  await expect
    .poll(() => page.locator('tbody tr').count(), { timeout })
    .toBeGreaterThan(0);
}

test('going back restores a route and its content', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const { root: ROOT, target: TARGET } = fixtureFor(testInfo.project.name);

  const helper = new AdminUIHelper(page);
  await helper.login();

  const listingUrl = new RegExp(`${ROOT}/contents$`);
  await page.goto(`${helper.adminUrl}${ROOT}/contents`);
  await waitForRows(page);
  // The row we will come back to. Asserting THIS rather than a row count:
  // the count is still filling while the first row exists, so comparing
  // before/after counts races the listing rather than testing the restore.
  // Rows are labelled by TITLE ("First Post"), while fixtures name paths
  // ("/news/first-post"). Matching the path found nothing at all — the failure
  // read as "the restore lost the row" when the row had never been matched.
  const targetRow = page
    .locator('tbody tr')
    .filter({ hasText: nameLike(TARGET.split('/').filter(Boolean).pop()) });
  await expect(targetRow).toHaveCount(1, { timeout: 25_000 });

  // Into a child, client-side, so the history entry we come back to is a real
  // SPA entry rather than a fresh document load.
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, TARGET);
  await expect(page).toHaveURL(new RegExp(`${TARGET}$`), { timeout: 25_000 });

  await page.goBack();

  // The restored entry must come back with its data. Volto renders the listing
  // from the store, and in bridge mode nothing is prefetched server-side, so
  // arriving here without a refetch shows an empty table — which is exactly
  // the symptom this guards against.
  await expect(page).toHaveURL(listingUrl, { timeout: 25_000 });
  await waitForRows(page);
  await expect(targetRow).toHaveCount(1, { timeout: 25_000 });
});
