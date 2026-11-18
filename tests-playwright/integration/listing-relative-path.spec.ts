import { test, expect } from '../fixtures';
import type { Locator, Page } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * A relative-path Location criterion keeps its depth. Volto's menu offers only
 * "Current path (./)" and "Parent path (../)", and drew any other stored value
 * — `.::1` (the page's own children), `..` — as an empty "Select…" while the
 * listing still ran it. Inka's QueryWidget shadow shows the path with its depth
 * beside it, as the absolute path has one.
 */

async function openCriteria(page: Page, listingId: string): Promise<Locator> {
  const helper = new AdminUIHelper(page);
  await helper.login();
  await helper.navigateToEdit('/relative-path-listing-page');
  await helper.clickBlockInIframe(listingId);
  const criteria = page.locator('#sidebar .query-widget');
  await expect(criteria).toBeVisible({ timeout: 15000 });
  return criteria;
}

const depthInput = (criteria: Locator) =>
  criteria.locator('.reference-widget-depth input');

test("a listing of the page's own children shows Current path, depth 1", async ({
  page,
}) => {
  const criteria = await openCriteria(page, 'children-listing');
  await expect(
    criteria.locator('.react-select__single-value', {
      hasText: 'Current path (./)',
    }),
  ).toBeVisible();
  await expect(depthInput(criteria)).toHaveValue('1');
  // Nothing in the Location row is left looking unset.
  await expect(
    criteria.locator('.location-object-browser .react-select__placeholder'),
  ).toHaveCount(0);
});

test('a listing of the parent written without its slash shows Parent path, every level', async ({
  page,
}) => {
  const criteria = await openCriteria(page, 'parent-listing');
  await expect(
    criteria.locator('.react-select__single-value', {
      hasText: 'Parent path (../)',
    }),
  ).toBeVisible();
  await expect(depthInput(criteria)).toHaveValue('');
});

test('changing the depth keeps the path, and changing the path keeps the depth', async ({
  page,
}) => {
  const criteria = await openCriteria(page, 'children-listing');
  await depthInput(criteria).fill('2');
  await expect(depthInput(criteria)).toHaveValue('2');
  await expect(
    criteria.locator('.react-select__single-value', {
      hasText: 'Current path (./)',
    }),
  ).toBeVisible();

  await criteria
    .locator('.location-object-browser .react-select__control')
    .click();
  await page
    .locator('.react-select__option', { hasText: 'Parent path (../)' })
    .click();
  await expect(
    criteria.locator('.react-select__single-value', {
      hasText: 'Parent path (../)',
    }),
  ).toBeVisible();
  await expect(depthInput(criteria)).toHaveValue('2');
});
