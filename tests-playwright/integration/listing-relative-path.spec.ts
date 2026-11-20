import { test, expect } from '../fixtures';
import type { Locator, Page } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * A listing's Location: where to look, how deep, and whether the place itself
 * is listed ("Children only"). A Relative path is a place counted from the
 * page -- Here, Parent, or the section it is in at the 2nd, 3rd or 4th level
 * of the site; an Absolute path is a folder picked. The widget writes the
 * listing location's ending (`/` the place too, `/*` children only).
 *
 * Volto's own values (`.::1`, `..`, `uid::1`) mean what Plone makes of them
 * (the place is listed except at depth 1), and the widget shows them so: an
 * edit keeps what the listing lists.
 *
 * Fixture: /relative-path-listing-page -- `.::1` (children-listing), `..`
 * (parent-listing), and a folder by its UID at depth 1 (folder-listing).
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
const childrenOnly = (criteria: Locator) =>
  criteria.locator('.location-children-only input[type="checkbox"]');
const place = (criteria: Locator, label: string) =>
  criteria.locator('.react-select__single-value', { hasText: label });

test("a listing of the page's own children shows Here, depth 1, children only", async ({
  page,
}) => {
  const criteria = await openCriteria(page, 'children-listing');
  await expect(place(criteria, 'Here')).toBeVisible();
  await expect(depthInput(criteria)).toHaveValue('1');
  await expect(childrenOnly(criteria)).toBeChecked();
  // Nothing in the Location row is left looking unset.
  await expect(
    criteria.locator('.location-object-browser .react-select__placeholder'),
  ).toHaveCount(0);
});

test('a listing of the parent written without its slash shows Parent, every level, the parent too', async ({
  page,
}) => {
  const criteria = await openCriteria(page, 'parent-listing');
  await expect(place(criteria, 'Parent')).toBeVisible();
  await expect(depthInput(criteria)).toHaveValue('');
  await expect(childrenOnly(criteria)).not.toBeChecked();
});

test('the places offered are the 2nd, 3rd and 4th level, Parent and Here', async ({
  page,
}) => {
  const criteria = await openCriteria(page, 'parent-listing');
  await criteria
    .locator('.location-object-browser .react-select__control')
    .click();
  await expect(page.locator('.react-select__option')).toHaveText([
    '2nd level',
    '3rd level',
    '4th level',
    'Parent',
    'Here',
  ]);
  await page.locator('.react-select__option', { hasText: '2nd level' }).click();
  await expect(place(criteria, '2nd level')).toBeVisible();
  await expect(childrenOnly(criteria)).not.toBeChecked();
});

test('changing the depth keeps the place and children only, and changing the place keeps both', async ({
  page,
}) => {
  const criteria = await openCriteria(page, 'children-listing');
  // `.::1` is children only because of its depth; at depth 2 it must stay so.
  await depthInput(criteria).fill('2');
  await expect(depthInput(criteria)).toHaveValue('2');
  await expect(place(criteria, 'Here')).toBeVisible();
  await expect(childrenOnly(criteria)).toBeChecked();

  await criteria
    .locator('.location-object-browser .react-select__control')
    .click();
  await page.locator('.react-select__option', { hasText: 'Parent' }).click();
  await expect(place(criteria, 'Parent')).toBeVisible();
  await expect(depthInput(criteria)).toHaveValue('2');
  await expect(childrenOnly(criteria)).toBeChecked();
});

test('a folder picked lists its children only until children only is unticked, then the folder too', async ({
  page,
}) => {
  const criteria = await openCriteria(page, 'folder-listing');
  await expect(depthInput(criteria)).toHaveValue('1');
  await expect(childrenOnly(criteria)).toBeChecked();

  // A teaser links to its page twice (title and button): one link per page.
  const listing = page
    .frameLocator('#previewIframe')
    .locator('[data-block-uid="folder-listing"]');
  const linkTo = (path: string) =>
    listing.locator(`a[href$="${path}"]`).first();
  const folderLinks = listing.locator(
    'a[href$="/context-navigation-forced-folder"]',
  );
  await expect(
    linkTo('/context-navigation-forced-folder/page-a'),
  ).toBeVisible();
  await expect(folderLinks).toHaveCount(0);

  await childrenOnly(criteria).click({ force: true });
  await expect(childrenOnly(criteria)).not.toBeChecked();
  await expect(depthInput(criteria)).toHaveValue('1');
  await expect(linkTo('/context-navigation-forced-folder')).toBeVisible();
  await expect(
    linkTo('/context-navigation-forced-folder/page-a'),
  ).toBeVisible();
});
