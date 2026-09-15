/**
 * The object browser says when it is fetching a level.
 *
 * Without it, "this folder is empty" and "the listing is still on its way" look
 * exactly the same: an empty panel. The browser opens on the level of the page
 * being edited, which is often a leaf with no children of its own, so an author
 * cannot tell whether to wait or to click Back — and neither can a test, which
 * is how a doc-video recording came to navigate off a level that was about to
 * fill.
 *
 * The flag was already in props — `searchSubrequests[block-mode].loading`, read
 * for other decisions in this same component — and simply was not rendered.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('object browser loading state', () => {
  test('says it is loading, and stops when the level arrives', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/deep-link-page');

    // Slow, not stopped: long enough that the loading state is observable rather
    // than a flash, short enough that the request still completes. The delay IS
    // the subject — it makes a real state visible, it does not paper over a race.
    await page.route(/@search.*path\.depth=1/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    // Opened the way the working specs open it: the button's link editor in the
    // canvas toolbar, then its browse control.
    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="btn"] [data-edit-link="href"]').click();
    await page.locator('.quanta-toolbar button[title*="Edit link"]').click();
    (await helper.getLinkEditorBrowseButton()).click();

    // While the query is out, the browser says so rather than showing an empty
    // panel that reads as "nothing here".
    await expect(page.locator('.ob-listing-loading')).toBeVisible({ timeout: 10000 });

    // And it stops saying so once the level lands. What the level then CONTAINS
    // is the fixture's business, not this test's — a level with no children is a
    // perfectly good answer, and the whole point is that it no longer looks the
    // same as one still loading.
    await expect(page.locator('.ob-listing-loading')).toBeHidden({ timeout: 10000 });
  });
});
