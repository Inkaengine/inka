/**
 * Autosaved drafts.
 *
 * Volto autosaves the form to localStorage as you type and offers it back if
 * you return to a page you left mid-edit. Hydra's shadow of Form had dropped
 * the feature entirely — close the tab, lose the work.
 *
 * Restoring it needed one change, not a straight re-add: core drafts the PAGE
 * SCHEMA's fields, and in hydra almost everything an author does lives in
 * `blocks` / `blocks_layout`, which are not schema properties. Drafting only
 * the schema fields would hand back a title and silently drop every block —
 * worse than offering nothing. So the shadowed HOC drafts the blocks too, and
 * this test is about exactly that: block work, not the title.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('save as draft', () => {
  test('block work left unsaved is offered back', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Wait on the BLOCK, not on a page-title element: `#page-title` is the mock
    // frontend's markup, and this feature is admin-side — it has to hold for
    // whichever frontend is in the iframe. Every frontend renders a block with
    // its data-block-uid; that is the readiness signal they share.
    const iframe = helper.getIframe();
    const block = iframe.locator('[data-block-uid="block-1-uuid"]').first();
    await expect(block).toBeVisible({ timeout: 20000 });
    await block.click();
    await page.keyboard.type(' drafted');

    // The draft is debounced; wait for it to reach storage rather than guess.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Object.keys(window.localStorage).some((k) => {
              const v = window.localStorage.getItem(k) || '';
              return v.includes('drafted') && v.includes('blocks');
            }),
          ),
        { timeout: 15000 },
      )
      .toBe(true);

    // Leave without saving, then come back — a reload is the honest version of
    // "closed the tab and came back": the editor is built again from scratch,
    // which is when a draft has to be noticed.
    await page.reload();
    await expect(
      helper.getIframe().locator('[data-block-uid="block-1-uuid"]').first(),
    ).toBeVisible({ timeout: 25000 });

    // The editor offers the autosaved work back.
    await expect(
      page.getByText(/Autosaved content found|autosaved content/i).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('a draft is offered when you navigate back to the page in the editor', async ({
    page,
  }) => {
    // The other way back: not a reload, but moving between pages inside the
    // editor, where the Form is never rebuilt. Without a check on that
    // transition a draft is only ever noticed on a cold load.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    const iframe = helper.getIframe();
    const block = iframe.locator('[data-block-uid="block-1-uuid"]').first();
    await expect(block).toBeVisible({ timeout: 20000 });
    await block.click();
    await page.keyboard.type(' drafted here too');
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Object.keys(window.localStorage).some((k) =>
              (window.localStorage.getItem(k) || '').includes('drafted here too'),
            ),
          ),
        { timeout: 15000 },
      )
      .toBe(true);

    // Away to another page, then back — no reload.
    await helper.navigateToEdit('/example-listings-page');
    await helper.navigateToEdit('/test-page');

    await expect(
      page.getByText(/Autosaved content found|autosaved content/i).first(),
    ).toBeVisible({ timeout: 15000 });
  });
});
