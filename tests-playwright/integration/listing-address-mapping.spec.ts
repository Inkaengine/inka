/**
 * A listing stores its field mapping on the block, and Plone reads every `@id`
 * in stored block data as a link. A mapping keyed `@id` with a `{ field, type }`
 * value crashed the save ("'dict' object has no attribute 'startswith'"), so a
 * result's address is mapped from `getURL`. These follow what the editor
 * actually saves.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/** The blocks of each PATCH to /test-page, latest last. */
function captureSaves(page) {
  const saves: Record<string, any>[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'PATCH' || !/test-page/.test(req.url())) return;
    const body = req.postDataJSON();
    if (body?.blocks) saves.push(body.blocks);
  });
  return saves;
}

async function savedMapping(saves: Record<string, any>[]) {
  await expect
    .poll(() => saves.length, { message: 'the page was saved', timeout: 10000 })
    .toBeGreaterThan(0);
  return saves[saves.length - 1]['block-9-listing'].fieldMapping;
}

test.describe('a listing saves its result address as getURL', () => {
  test('switching the item type saves the new type\'s mapping without an @id key', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const saves = captureSaves(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-9-listing');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    const variation = page.locator('#sidebar-properties .field-wrapper-variation .react-select__control');
    await variation.click();
    const menu = page.locator('.react-select__menu');
    await menu.locator('.react-select__option', { hasText: 'Image' }).click();
    await expect(page.locator('#blockform-fieldset-inherited_fields')).toBeVisible();

    await helper.saveContent();
    const mapping = await savedMapping(saves);
    expect(Object.keys(mapping)).not.toContain('@id');
    expect(Object.keys(mapping)).toContain('getURL');
  });

  // The widget offers each result field only the item fields it can be
  // converted into, and stores that conversion: no list in a title, no date
  // wrapped as a link, no bare name passed through.
  test('each source is offered only the fields it converts into, and saves the conversion', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const saves = captureSaves(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-9-listing');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    const table = page.locator('#sidebar-properties .field-mapping-table');
    const row = (label: string) =>
      table.locator('tr').filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^${label}$`) }) });
    const menu = page.locator('.react-select__menu');
    const offered = async (label: string) => {
      await row(label).locator('.react-select__control').click();
      const options = await menu.locator('.react-select__option').allInnerTexts();
      // Not Escape: it deselects the block.
      await table.locator('th', { hasText: 'Source' }).click();
      await expect(menu).toHaveCount(0);
      return options;
    };

    // A list (the teaser's text fields take it joined); never a link or image.
    expect(await offered('Categories')).toEqual(['(none)', 'Title', 'Kicker', 'Description']);
    // A date: text only.
    expect(await offered('Created')).toEqual(['(none)', 'Title', 'Kicker', 'Description']);
    // The address: the link, or as text.
    expect(await offered('URL')).toEqual(['(none)', 'Target', 'Title', 'Kicker', 'Description']);

    await row('Categories').locator('.react-select__control').click();
    await menu.locator('.react-select__option', { hasText: /^Kicker$/ }).click();
    await helper.saveContent();
    const mapping = await savedMapping(saves);
    expect(mapping.Subject).toEqual({ field: 'head_title', type: 'string' });
  });

  // The renderer converts by the stored mapping and has none of its own, so a
  // listing added in the editor must save one: the widget's default for the
  // item type picked, every entry with its conversion.
  test('a listing added in the editor saves its mapping', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const saves = captureSaves(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.clickAddBlockButton();
    await helper.selectBlockType('listing');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');
    const variation = page.locator('#sidebar-properties .field-wrapper-variation .react-select__control');
    await variation.click();
    await page.locator('.react-select__menu .react-select__option', { hasText: /^Teaser$/ }).click();
    await expect(page.locator('#sidebar-properties .field-mapping-table')).toBeVisible();

    await helper.saveContent();
    await expect
      .poll(() => saves.length, { message: 'the page was saved', timeout: 10000 })
      .toBeGreaterThan(0);
    const blocks = saves[saves.length - 1];
    const added = Object.values(blocks).filter(
      (b: any) => b['@type'] === 'listing' && b.variation === 'teaser' && !b.headline,
    ) as any[];
    expect(added, 'the added listing was saved').toHaveLength(1);
    const mapping = added[0].fieldMapping;
    expect(mapping?.getURL).toEqual({ field: 'href', type: 'link' });
    for (const entry of Object.values(mapping)) {
      expect(entry).toEqual({ field: expect.any(String), type: expect.any(String) });
    }
  });
});

