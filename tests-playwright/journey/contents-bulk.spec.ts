import { test, expect, type Page } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { fixtureFor } from './fixtures';
import { seedFor } from './seedFor';
import { createPage } from './steps';

/**
 * Acting on a SELECTION in the contents view.
 *
 * Single-item cut and paste is already walked by move-page and journey, which
 * go through the row's own menu. What nothing covered is the bulk path: tick
 * several rows, act once, and have it land on all of them. That is a different
 * code path in the admin and a different shape at the adapter — N writes, where
 * a partial failure leaves the selection half-moved and says nothing.
 */
test.beforeAll(async ({}, testInfo) => {
  await seedFor(testInfo);
});

/**
 * The checkbox is the SECOND cell — the first is the drag handle, whose button
 * looks identical to a selector until you click it and nothing is selected.
 *
 * Volto's label on it is also inverted: it reads "Checked" while the row is
 * unselected and "Unchecked" once it is. So this asserts the transition rather
 * than trusting either name to mean what it says.
 */
const selectRow = async (page: Page, name: RegExp) => {
  const row = page.locator('tbody tr').filter({ hasText: name });
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  const box = row.locator('td').nth(1).locator('button');
  await box.click();
  await expect(box).toHaveAttribute('aria-label', 'Unchecked', {
    timeout: 10_000,
  });
  return row;
};

const goToContents = async (page: Page, folder: string) => {
  // Client-side, because the clipboard lives in the store and a full load
  // resets it — the same hop moveViaCutPaste makes for the same reason.
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `${folder}/contents`);
  await expect(page).toHaveURL(new RegExp(`${folder}/contents$`), {
    timeout: 30_000,
  });
};

test('cut and paste a selection of several documents', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const { root: ROOT, moveTarget } = fixtureFor(testInfo.project.name);
  const target = moveTarget ?? ROOT;

  const helper = new AdminUIHelper(page);
  await helper.login();
  await page.goto(`${helper.adminUrl}${ROOT}`);

  const stamp = Date.now();
  const first = `Bulk one ${stamp}`;
  const second = `Bulk two ${stamp}`;
  await createPage(page, helper, ROOT, first);
  await page.goto(`${helper.adminUrl}${ROOT}`);
  await createPage(page, helper, ROOT, second);

  await page.goto(`${helper.adminUrl}${ROOT}/contents`);
  await selectRow(page, new RegExp(first, 'i'));
  await selectRow(page, new RegExp(second, 'i'));

  await page.getByRole('button', { name: 'Cut', exact: true }).click();
  await goToContents(page, target);
  await page.getByRole('button', { name: 'Paste', exact: true }).click();

  // BOTH, not just the first. A bulk action that half-lands is the failure
  // worth catching: the listing looks plausible either way.
  for (const title of [first, second]) {
    await expect(
      page.locator('tbody tr').filter({ hasText: new RegExp(title, 'i') }),
      `${title} should have moved`,
    ).toHaveCount(1, { timeout: 30_000 });
  }
});

test('rename a selection, changing every one of them', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const { root: ROOT } = fixtureFor(testInfo.project.name);

  const helper = new AdminUIHelper(page);
  await helper.login();
  await page.goto(`${helper.adminUrl}${ROOT}`);

  const stamp = Date.now();
  const first = `Rename one ${stamp}`;
  const second = `Rename two ${stamp}`;
  await createPage(page, helper, ROOT, first);
  await page.goto(`${helper.adminUrl}${ROOT}`);
  await createPage(page, helper, ROOT, second);

  await page.goto(`${helper.adminUrl}${ROOT}/contents`);
  await selectRow(page, new RegExp(first, 'i'));
  await selectRow(page, new RegExp(second, 'i'));

  await page.getByRole('button', { name: 'Rename', exact: true }).click();

  // One title field per selected item — the modal is a form over the whole
  // selection, not one document at a time.
  const titles = page.locator('.modal input[id$="_title"], input[id$="_title"]');
  await expect(titles).toHaveCount(2, { timeout: 20_000 });

  const renamedFirst = `${first} renamed`;
  const renamedSecond = `${second} renamed`;
  await titles.nth(0).fill(renamedFirst);
  await titles.nth(1).fill(renamedSecond);

  await page.getByRole('button', { name: /^(Rename|Save|OK)$/ }).last().click();

  for (const title of [renamedFirst, renamedSecond]) {
    await expect(
      page.locator('tbody tr').filter({ hasText: new RegExp(title, 'i') }),
      `${title} should have been renamed`,
    ).toHaveCount(1, { timeout: 30_000 });
  }
});
