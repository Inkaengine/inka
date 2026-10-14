import { test, expect } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { fixtureFor } from './fixtures';
import { seedFor } from './seedFor';
import { browseListing, stableRows, waitForRows } from './steps';

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
  // This drives whichever index the UI presents FIRST, which is enough for the
  // claim it makes: that the control is wired to the CMS at all. The menu's
  // contents are a separate claim — that every index it offers really sorts —
  // and the sibling test below makes it over all of them.
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
    // Settled, not first-paint: see stableRows. Reading straight after the
    // click returned the order from BEFORE the rearrange landed, so the two
    // directions compared equal and this failed on a sort that works.
    return stableRows(page);
  };

  const sorted = await sortBy('descending');
  const resorted = await sortBy('ascending');

  // The two orders must differ from each other. Comparing against the ORIGINAL
  // would be weaker: an ignored sort leaves it untouched and would still pass
  // whichever way the default happened to fall.
  expect(sorted).not.toEqual(resorted);
});

test('the rearrange menu is the CMS\'s own sort keys', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const { root: ROOT } = fixtureFor(testInfo.project.name);

  const helper = new AdminUIHelper(page);
  await helper.login();
  await browseListing(page, helper, ROOT);

  const expected = await page.locator('tbody tr').count();
  expect(expected).toBeGreaterThan(1);

  const configure = page.locator('.dropdown-popup-trigger.configuration-svg');
  await expect(configure).toHaveCount(1, { timeout: 15_000 });

  // Opening is idempotent BY STATE rather than by clicking: the trigger is a
  // toggle, so a second click on an already-open popup closes it, and the
  // items then time out as invisible.
  const anyItem = page.locator('[class*="_descending"]').first();
  const openConfigure = async () => {
    if (await anyItem.isVisible()) return;
    await configure.click({ timeout: 30_000 });
    await anyItem.waitFor({ state: 'visible', timeout: 10_000 });
  };

  await openConfigure();
  const offered = await page
    .locator('[class*="_descending"]')
    .evaluateAll((nodes) =>
      nodes
        .map(
          (n) =>
            /sort_(.+)_descending/.exec(
              [...n.classList].find((c) => c.endsWith('_descending')) ?? '',
            )?.[1],
        )
        .filter((name): name is string => Boolean(name)),
    );

  // NOT EMPTY, which is the regression this guards.
  //
  // The menu is built from `state.querystring.sortable_indexes`, and that was
  // `{}` for every adapter-backed CMS: plonify was handed the intent's whole
  // result (`{ indexes, sortable_indexes }`) while being written for a bare
  // index map, so it looked for a `sortable` flag on the two KEYS and found
  // none. Its unit test passed a bare map — a shape no caller sends — so the
  // split it asserted never happened in production. An empty sort menu reads
  // as a CMS that cannot sort.
  expect(
    offered.length,
    'the rearrange menu offered nothing: the backend\'s sortable_indexes ' +
      'never reached the store',
  ).toBeGreaterThan(1);

  // The names are the BACKEND's, not Plone's. The menu used to hard-code six
  // Plone index names for every CMS — id, sortable_title, EffectiveDate,
  // CreationDate, ModificationDate, portal_type — and send Plone's `sort_on`
  // for each. On anything but Plone most of those did nothing at all: the
  // adapter keyed every row the same and the order came back untouched, with
  // nothing reporting a problem.
  //
  // Asserted as "not Plone's list" rather than against an expected set per
  // project, because the expected set is the ADAPTER's answer and the contract
  // suite already checks it there — including that every key it advertises
  // really reverses the order, which is the claim this cannot make: whether a
  // given key reorders THIS fixture depends on the fixture (a Plone draft has
  // no publication date at all, so ordering by it is legitimately a no-op).
  if (!testInfo.project.name.includes('plone')) {
    expect(offered).not.toContain('EffectiveDate');
    expect(offered).not.toContain('ModificationDate');
    expect(offered).not.toContain('portal_type');
  }

  // And the control is WIRED: picking one reorders the listing and keeps the
  // same rows. A menu of correct names that did nothing when clicked would
  // pass everything above.
  const rearrangeBy = async (index: string, direction: string) => {
    await expect(configure).toHaveCount(1, { timeout: 15_000 });
    await openConfigure();
    const item = page.locator(`.sort_${index}_${direction}`).first();
    await item.waitFor({ state: 'visible', timeout: 10_000 });
    await item.dispatchEvent('click');
    await waitForRows(page);
    const rows = await stableRows(page);
    // A sort that emptied the listing — an adapter answering an error — is a
    // different failure from one that did nothing, and both are failures.
    expect(rows).toHaveLength(expected);
    return rows;
  };

  const reordered = [];
  for (const index of offered) {
    const ascending = await rearrangeBy(index, 'ascending');
    const descending = await rearrangeBy(index, 'descending');
    if (JSON.stringify(ascending) !== JSON.stringify(descending)) {
      reordered.push(index);
    }
  }
  expect(
    reordered,
    `none of the offered sorts (${offered.join(', ')}) changed the order: the ` +
      `menu is not wired to the CMS at all`,
  ).not.toHaveLength(0);
});
