/**
 * Save validation sees an edit typed on the canvas a moment ago.
 *
 * Text typed into the iframe reaches the admin's form after a short debounce.
 * Saving flushes that pending edit before the PATCH — but the save's
 * validation used to read the form BEFORE the flush, so a required field typed
 * on the canvas and saved straight away was refused as empty ("Required input
 * is missing"), even though the sidebar showed the value a moment later. A
 * block that already had a value passed only because its old value was there.
 *
 * A navItem's `label` is required and inline-editable, and a new one starts
 * empty: the exact case.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

test.describe('save validation', () => {
  test('a required field typed on the canvas and saved at once is not refused', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/context-navigation-test-page');
    const iframe = helper.getIframe();
    const nav = iframe.locator('[data-block-uid="nav-1"]');
    await expect(nav.locator('[data-block-uid="item-test-page"]')).toBeVisible({
      timeout: 15000,
    });

    // Add a navItem after an existing one; it starts with no label. Found by
    // the bridge's block map, not by markup — each frontend draws it its own way.
    const navItems = () =>
      iframe.locator('body').evaluate(() => {
        const map = (window as any).__hydraBridge?.blockPathMap || {};
        return Object.keys(map).filter(
          (uid) => map[uid]?.blockType === 'navItem' && map[uid]?.parentId === 'nav-1',
        );
      });
    const before = await navItems();
    await helper.clickBlockInIframe('item-test-page');
    await helper.clickAddBlockButton();
    await helper.selectBlockType('navItem');
    await expect.poll(navItems).toHaveLength(before.length + 1);
    const added = (await navItems()).find((uid) => !before.includes(uid))!;

    // Type the required label on the canvas… Select what's there first only if
    // something is: a frontend may draw a placeholder as text (the test
    // frontend's "New navigation item"), and Ctrl+A in an EMPTY field selects
    // the whole block instead, as an author would find.
    const label = await helper.enterEditMode(added, 'label');
    if (await helper.getCleanTextContent(label)) {
      await page.keyboard.press('ControlOrMeta+a');
    }
    await page.keyboard.type('Contact us');
    await expect(label).toHaveText('Contact us');

    // …and save straight away, inside the debounce. It saves.
    await page
      .locator('#toolbar-save, button:has-text("Save")')
      .first()
      .click();
    await expect(page).not.toHaveURL(/\/edit(\?|$)/, { timeout: 15000 });

    // …with the label typed. The mock keeps a save in the session of the token
    // that sent it, so read back with the admin's token.
    const token = (await page.context().cookies()).find(
      (c) => c.name === 'auth_token',
    )?.value;
    expect(token, 'the admin is logged in and holds a token').toBeTruthy();
    const res = await page.request.get(
      `${URLS.mockApi}/_test_data/context-navigation-test-page`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      },
    );
    expect(res.ok()).toBeTruthy();
    const saved = (await res.json()).blocks['nav-1'].blocks[added];
    expect(saved?.label).toBe('Contact us');
  });
});
