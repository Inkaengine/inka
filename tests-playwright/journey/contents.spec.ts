import { test, expect } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { fixtureFor } from './fixtures';
import { seedFor } from './seedFor';
import { browseListing, waitForRows } from './steps';

/**
 * The contents view's own behaviour: listing, filtering, sorting.
 *
 * It had no spec of its own. The journey browses it and moves things within
 * it, but nothing covered what an editor actually does there — which is a
 * pointed gap, because /contents is the route that renders NO preview iframe.
 * It is the one place the admin works with no editor present, and the reason
 * the proxy frame exists at all.
 *
 * The contract already proves search and sort at the ADAPTER level against all
 * three CMSes. What only a browser test can show is that the contents UI wires
 * its controls to those intents correctly — a different claim, and the one
 * that catches a control sending a query no CMS but Plone understands.
 */

test.beforeAll(async ({}, testInfo) => {
  await seedFor(testInfo);
});

test('filtering the listing narrows it to the match', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const { root: ROOT, target: TARGET } = fixtureFor(testInfo.project.name);

  const helper = new AdminUIHelper(page);
  await helper.login();
  await browseListing(page, helper, ROOT);

  const before = await page.locator('tbody tr').count();
  expect(before).toBeGreaterThan(1);

  // The word to filter on comes from the fixture's own target rather than a
  // literal: each CMS names its seed content, and hard-coding one CMS's title
  // would make this a single-CMS test.
  const word = TARGET.split('/').pop()!.split('-')[0];

  const filterBox = page
    .locator('.top-menu-searchbox input[type="text"]')
    .first();
  await expect(filterBox).toBeVisible({ timeout: 20_000 });
  await filterBox.fill(word);

  // Narrowed, and to the RIGHT thing. A count that merely went down would also
  // pass if the filter returned nothing at all — which is exactly what a query
  // the CMS cannot parse produces.
  await expect
    .poll(() => page.locator('tbody tr').count(), { timeout: 30_000 })
    .toBeLessThan(before);
  await expect(
    page.locator('tbody tr').filter({ hasText: new RegExp(word, 'i') }),
  ).toHaveCount(await page.locator('tbody tr').count());
});

test('the listing can be sorted', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const { root: ROOT } = fixtureFor(testInfo.project.name);

  const helper = new AdminUIHelper(page);
  await helper.login();
  await browseListing(page, helper, ROOT);

  const original = await page.locator('tbody tr').allInnerTexts();
  expect(original.length).toBeGreaterThan(1);

  // Sorting lives behind the header's configuration popup ("Rearrange by"),
  // which has to be opened before any sort item exists in the DOM — hence a
  // bare [class*="sort_"] finding nothing.
  //
  // The indexes it offers are a FIXED Plone list — id, sortable_title,
  // EffectiveDate, CreationDate, ModificationDate, portal_type — hard-coded in
  // Volto's contents view rather than taken from querystring.getIndexes. So
  // this drives whichever the UI presents rather than naming one, and the
  // Plone-shaped index list is noted as a separate finding, not asserted here.
  // The CONFIGURATION trigger specifically. `.dropdown-popup-trigger` is worn
  // by three different controls — this one, the selected-items menu, and one
  // per row — so `.first()` picked whichever the DOM happened to order first
  // and then resolved to a different (or detached) element once the listing
  // re-rendered, which read as the trigger disappearing mid-test.
  const configure = page.locator('.dropdown-popup-trigger.configuration-svg');
  await expect(configure).toHaveCount(1, { timeout: 15_000 });

  const sortBy = async (direction: 'ascending' | 'descending') => {
    await configure.click({ timeout: 30_000 });
    const item = page.locator(`[class*="_${direction}"]`).first();
    await item.waitFor({ state: 'visible', timeout: 10_000 });

    // dispatchEvent, not click, and NOT a forced click.
    //
    // The popup this item lives in overlays the table. A forced click skips
    // the "does this element receive the event" check and fires at the
    // coordinates regardless — which landed on the ROW BEHIND the menu and
    // navigated to /news/draft-post, so the next step found no listing and no
    // trigger, and the failure surfaced as the sort control vanishing. A
    // normal click has the opposite problem: the item never registers as
    // receiving events, so it waits out its timeout.
    //
    // The element IS the intended target; only the hit-testing is unreliable.
    // Dispatching the event calls its handler directly and leaves the page
    // where it is.
    await item.dispatchEvent('click');
    await waitForRows(page);
    return page.locator('tbody tr').allInnerTexts();
  };

  const sorted = await sortBy('descending');
  const resorted = await sortBy('ascending');

  // The two orders must differ from each other. Comparing against the ORIGINAL
  // would be weaker: an ignored sort leaves it untouched and would still pass
  // whichever way the default happened to fall.
  expect(sorted).not.toEqual(resorted);
});
