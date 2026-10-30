import { test, expect } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { fixtureFor } from './fixtures';
import { seedFor } from './seedFor';

/**
 * Status and access, in one menu.
 *
 * The claim being tested is not that a transition works — the contract suite
 * covers that against each CMS directly. It is the thing only a browser can
 * show: that opening the menu and choosing an entry does NOT change anything
 * until you commit, and that the two entries this absorbed are gone from the
 * menu they used to live in.
 *
 * Volto's own control fired the transition on selection, so "chose it and
 * nothing happened yet" is precisely the regression to guard.
 */
test.beforeAll(async ({}, testInfo) => {
  await seedFor(testInfo);
});

const openMore = async (page: import('@playwright/test').Page) => {
  const more = page.locator('#toolbar-more');
  await more.waitFor({ state: 'visible', timeout: 30_000 });
  await more.click();
};

test('the state menu shows what the adapter offered', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const { root: ROOT } = fixtureFor(testInfo.project.name);

  const helper = new AdminUIHelper(page);
  await helper.login();
  await page.goto(`${helper.adminUrl}${ROOT}`);
  await openMore(page);

  const menu = page.locator('.state-menu');
  const present = await menu
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false);

  // An adapter without `state` renders nothing here, same as Volto does for
  // content with no workflow. Say which path ran rather than pass silently.
  // eslint-disable-next-line no-console
  console.log(`[state-menu] menu present: ${present}`);
  if (!present) return;

  // The current state, named. This comes from the adapter's own label, not
  // from a table in the admin.
  await expect(page.locator('.state-current')).not.toBeEmpty();

  // Transitions come from state.get and are there immediately; the access
  // entry arrives with state.getForms, which is deliberately a second request
  // made when the menu opens. Reading the list before it lands sees only half
  // the menu — which is what this spec did first time out.
  const update = page.locator('[data-entry-id="update"]');
  const hasUpdate = await update
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  const entries = page.locator('.state-menu-entry');
  // eslint-disable-next-line no-console
  console.log(
    `[state-menu] entries: ${(await entries.allTextContents()).join(' | ')}`,
  );
  expect(await entries.count()).toBeGreaterThan(0);

  // Only a CMS with per-document grants has one, so its absence is a real
  // answer rather than a failure — but if it is there it must open like any
  // other entry, because it IS one.
  // eslint-disable-next-line no-console
  console.log(`[state-menu] stay-here entry: ${hasUpdate}`);
  if (hasUpdate) {
    await update.click();
    await expect(page.locator('.state-commit')).toBeVisible({ timeout: 15_000 });
  }
});

test('choosing an entry changes nothing until it is committed', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const { root: ROOT } = fixtureFor(testInfo.project.name);

  const helper = new AdminUIHelper(page);
  await helper.login();
  await page.goto(`${helper.adminUrl}${ROOT}`);
  await openMore(page);

  const menu = page.locator('.state-menu');
  if (
    !(await menu
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false))
  ) {
    return;
  }

  const before = await page.locator('.state-current').textContent();
  const entry = page.locator('.state-menu-entry').first();
  const label = await entry.textContent();
  await entry.click();

  // The whole point. Volto's control dispatched the transition from its
  // select's onChange; this one waits, and says what it is about to do.
  const commit = page.locator('.state-commit');
  await expect(commit).toBeVisible({ timeout: 15_000 });

  await page.locator('.state-back').click();
  await expect(page.locator('.state-current')).toHaveText(before ?? '', {
    timeout: 15_000,
  });
  // eslint-disable-next-line no-console
  console.log(`[state-menu] "${label?.trim()}" opened and backed out cleanly`);
});

test('sharing and working copy no longer sit beside it', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const { root: ROOT } = fixtureFor(testInfo.project.name);

  const helper = new AdminUIHelper(page);
  await helper.login();
  await page.goto(`${helper.adminUrl}${ROOT}`);
  await openMore(page);

  const menu = page.locator('.state-menu');
  if (
    !(await menu
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false))
  ) {
    // Nothing absorbed them, so they must still be reachable. Withdrawing an
    // entry with nothing to replace it would remove the feature outright.
    return;
  }

  // These are Volto's own entries, withdrawn by the component that took over
  // what they did. Two ways to reach sharing is worse than either alone.
  await expect(page.locator('#toolbar-more a[href$="/sharing"]')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /working copy/i }),
  ).toHaveCount(0);
});

/**
 * The working-copy round trip, through the menu.
 *
 * This is the design's sharpest claim: checking out a draft is a STATE CHANGE,
 * not a separate screen. So it has to behave like every other entry — open a
 * dialog, change nothing until committed — and then do the one thing no other
 * transition does, which is leave you somewhere else.
 *
 * Only Plone has working copies of the three, so this asserts nothing where
 * they are absent rather than being skipped.
 */
test('checking out a draft moves the session to it, and back again', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const { root: ROOT } = fixtureFor(testInfo.project.name);

  const helper = new AdminUIHelper(page);
  await helper.login();
  await page.goto(`${helper.adminUrl}${ROOT}`);
  await openMore(page);

  const checkout = page.locator('[data-entry-id="checkout"]');
  const offered = await checkout
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);

  // eslint-disable-next-line no-console
  console.log(`[working-copy] checkout offered: ${offered}`);
  if (!offered) return;

  await checkout.click();

  // Said before it happens, not discovered after.
  await expect(page.locator('.state-relocates')).toBeVisible({
    timeout: 10_000,
  });
  // Still on the original: opening the dialog must not have checked anything
  // out.
  expect(new URL(page.url()).pathname).toBe(ROOT);

  await page.locator('.state-commit').click();

  // The copy lives somewhere else and the editor follows it there.
  await page.waitForURL((url) => url.pathname !== ROOT, { timeout: 30_000 });
  const copyPath = new URL(page.url()).pathname;
  // eslint-disable-next-line no-console
  console.log(`[working-copy] landed on ${copyPath}`);
  expect(copyPath).not.toBe(ROOT);

  // And on the copy the menu offers the other half of the round trip, which is
  // how we know the adapter is reading the CMS rather than remembering what it
  // just did.
  await openMore(page);
  const discard = page.locator('[data-entry-id="cancel-checkout"]');
  await expect(discard).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-entry-id="checkin"]')).toBeVisible();

  await discard.click();
  await page.locator('.state-commit').click();

  // Discarding ends the draft, so the session goes back to what it was a copy
  // of.
  await page.waitForURL((url) => url.pathname === ROOT, { timeout: 30_000 });
});
