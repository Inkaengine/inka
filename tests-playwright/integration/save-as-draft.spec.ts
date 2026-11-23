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

  test('the last field changed is in the draft', async ({ page }) => {
    // The sidebar drafted the form as it was BEFORE each change, so the last
    // one, often the only one, was never in the draft.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(helper.contentUrl('', '/add?type=Document'));
    const title = page.locator('#field-title input, input[name="title"]').first();
    await expect(title).toBeVisible({ timeout: 20000 });
    await title.fill('A title typed and left');
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Object.keys(window.localStorage).some((k) =>
              (window.localStorage.getItem(k) || '').includes('A title typed and left'),
            ),
          ),
        { timeout: 15000 },
      )
      .toBe(true);

    await page.reload();
    await expect(page.getByText(/Autosaved content found|autosaved content/i).first()).toBeVisible({
      timeout: 15000,
    });
  });

  // Saving ends the draft, as Volto's own form does: a draft is work that was
  // never saved. Left behind, it was offered on the next edit as if someone
  // else had changed the page, so authors learned to dismiss the offer.
  test('a saved edit is not offered back as autosaved content', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    const block = helper.getIframe().locator('[data-block-uid="block-1-uuid"]').first();
    await expect(block).toBeVisible({ timeout: 20000 });
    await block.click();
    await page.keyboard.type(' saved now');
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Object.keys(window.localStorage).some((k) =>
              (window.localStorage.getItem(k) || '').includes('saved now'),
            ),
          ),
        { timeout: 15000 },
      )
      .toBe(true);
    await helper.saveContent();

    // Edit it again. The offer is made as the form opens, before the
    // iframe's blocks appear: once they show the saved text, it would be there.
    await page.reload();
    await helper.navigateToEdit('/test-page');
    await expect(
      helper.getIframe().locator('[data-block-uid="block-1-uuid"]').first(),
    ).toContainText('saved now', { timeout: 20000 });
    await expect(page.getByText(/Autosaved content found|autosaved content/i)).toHaveCount(0);
  });

  test('a new page is not offered the last saved new page as autosaved content', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    const title = page.locator('#field-title input, input[name="title"]').first();

    await page.goto(helper.contentUrl('', '/add?type=Document'));
    await expect(title).toBeVisible({ timeout: 20000 });
    await title.fill('First added page');
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Object.keys(window.localStorage).some((k) =>
              (window.localStorage.getItem(k) || '').includes('First added page'),
            ),
          ),
        { timeout: 15000 },
      )
      .toBe(true);
    await helper.saveContent();

    // The add form's draft is gone, so there is nothing to offer the next page
    // added here. (The offer is that stored draft; an empty add form has
    // nothing visible that would show it had been and gone.)
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Object.keys(window.localStorage).some((k) => k.endsWith('/add-Document')),
          ),
        { timeout: 15000 },
      )
      .toBe(false);
    await page.goto(helper.contentUrl('', '/add?type=Document'));
    await expect(title).toBeVisible({ timeout: 20000 });
    await expect(title).toHaveValue('');
    await expect(page.getByText(/Autosaved content found|autosaved content/i)).toHaveCount(0);
  });
});
