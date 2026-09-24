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

    // Add a navItem after an existing one; it starts with no label, so it
    // shows the renderer's placeholder.
    await helper.clickBlockInIframe('item-test-page');
    await helper.clickAddBlockButton();
    await helper.selectBlockType('navItem');
    const fresh = nav.locator('a[data-block-uid]', {
      hasText: 'New navigation item',
    });
    await expect(fresh).toHaveCount(1);
    const added = (await fresh.getAttribute('data-block-uid'))!;

    // Type the required label on the canvas…
    await helper.enterEditMode(added, 'label');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Contact us');
    await expect(
      iframe.locator(`[data-block-uid="${added}"] [data-edit-text="label"]`),
    ).toHaveText('Contact us');

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
