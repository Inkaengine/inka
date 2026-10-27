/**
 * After saving, the page is viewed, not edited: nothing the canvas still says
 * about a selection may bring the editing toolbar back.
 *
 * Seen in CI (sidebar-pickers on admin-nuxt): a save landed on the view page
 * and the admin replaced it with "Sorry, something went wrong" —
 * "[SyncedSlateToolbar] form is undefined". A BLOCK_SELECTED that arrived after
 * the switch (the edit canvas re-announces its selection on scroll and resize)
 * gave the view page a selected block, and the toolbar drew for it with no form
 * to edit.
 *
 * The message is posted here from the view canvas, on the frontend's origin,
 * the way a late one arrives.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

const PAGE = '/test-page';
const BLOCK = 'block-1-uuid';

test.describe('saving returns to viewing', () => {
  test('a selection announced after saving does not bring back the editing toolbar', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit(PAGE);

    await helper.clickBlockInIframe(BLOCK);
    await helper.waitForBlockSelectedInAdmin(BLOCK);

    await helper.saveContent();
    await expect(page).not.toHaveURL(/\/edit(\?|$)/);
    await expect(page.locator('.quanta-toolbar')).toHaveCount(0);

    const handled = page.waitForEvent('console', (msg) =>
      /BLOCK_SELECTED (received|ignored)/.test(msg.text()),
    );
    const iframe = helper.getIframe();
    await iframe.locator(`[data-block-uid="${BLOCK}"]`).evaluate((el, uid) => {
      const r = el.getBoundingClientRect();
      window.parent.postMessage(
        {
          type: 'BLOCK_SELECTED',
          src: 'scrollHandler',
          blockUid: uid,
          rect: { top: r.top, left: r.left, width: r.width, height: r.height },
          addDirection: 'bottom',
          editableFields: {},
        },
        '*',
      );
    }, BLOCK);
    await handled;

    await expect(page.getByText('Sorry, something went wrong')).toHaveCount(0);
    await expect(iframe.locator(`[data-block-uid="${BLOCK}"]`)).toBeVisible();
    await expect(page.locator('.quanta-toolbar')).toHaveCount(0);
    await expect(page.locator('.volto-hydra-block-outline')).toHaveCount(0);
  });
});
