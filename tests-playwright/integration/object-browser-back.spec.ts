/**
 * Back goes UP one level, from the first click.
 *
 * The browser opens on the level of the page being edited. That page is usually
 * a leaf with no children, so Back is the first thing an author reaches for —
 * and it took them to the site root instead of the folder the page lives in,
 * every time, because `parentFolder` starts empty and is only ever written BY a
 * navigation. `navigateTo('')` is `navigateTo('/')`.
 *
 * Landing at the root is not merely one level too far: it is a different tree.
 * Anything reached from there is a same-named folder somewhere else — which is
 * exactly what happened to the preview_image test, which climbed to the root,
 * opened the root's "Images" and looked for a fixture image that lives in
 * /_test_data/images.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('object browser Back button', () => {
  test('first click goes to the parent folder, not the site root', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    // A page one level down: /_test_data/deep-link-page. Its parent level,
    // /_test_data, holds the fixture content; the site root holds the docs
    // content. The two are told apart by what the listing contains.
    await helper.navigateToEdit('/deep-link-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="btn"] [data-edit-link="href"]').click();
    await page.locator('.quanta-toolbar button[title*="Edit link"]').click();
    (await helper.getLinkEditorBrowseButton()).click();

    await helper.waitForObjectBrowserLevel();
    await page.locator('button[aria-label="Back"]').first().click();
    await helper.waitForObjectBrowserLevel();

    const listing = page.locator('.object-listing');
    // The parent level: a sibling of the page being edited.
    await expect(listing.locator('li').filter({ hasText: /Test Page/ }).first())
      .toBeVisible({ timeout: 10000 });
    // Not the site root, which is a different tree entirely.
    await expect(listing.locator('li').filter({ hasText: /Volto Hydra Documentation/ }))
      .toHaveCount(0);
  });
});
