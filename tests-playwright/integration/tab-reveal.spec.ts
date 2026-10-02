import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * Selecting an inactive tab should make its content editable.
 *
 * A tab's uid rides TWO elements: the always-visible button in the tab bar, and
 * the panel holding its code, which is display:none unless the tab is active.
 * The bridge asks whether the block is visible, finds the button, and concludes
 * there is nothing to reveal — so an author who picks a tab from the sidebar
 * gets it selected but cannot edit its code until they click the tab in the
 * canvas themselves.
 */
test.describe('Tab reveal', () => {
  test('selecting an inactive tab shows the code it holds', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/code-example-test-page');

    const iframe = helper.getIframe();

    // tab-js is active; tab-py's panel is hidden.
    const pyCode = iframe
      .locator('[data-block-uid="tab-py"]')
      .locator('[data-edit-text="code"]')
      .first();
    await expect(pyCode).toBeAttached({ timeout: 15000 });
    await expect(pyCode).toBeHidden();

    await page.evaluate((uid) => {
      (document.querySelector('iframe') as HTMLIFrameElement).contentWindow!.postMessage(
        { type: 'SELECT_BLOCK', uid }, '*');
    }, 'tab-py');

    await expect(pyCode).toBeVisible({ timeout: 5000 });
  });

  test('the toolbar does not cover the tab label it belongs to', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/code-example-test-page');

    const iframe = helper.getIframe();
    // `~=` — the word-list matcher the attribute is documented with. The button
    // names its tab twice now (`tab-js tab-js#code`: reveal the tab, and reveal
    // where its code is edited), and an exact-match locator sees neither.
    const label = iframe.locator('[data-block-selector~="tab-js"] [data-edit-text="label"]');
    await expect(label).toBeVisible({ timeout: 15000 });

    await helper.clickBlockInIframe('tab-js');
    await helper.waitForBlockSelectedInAdmin('tab-js');

    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 5000 });

    // The label lives on the trigger ABOVE the panel, and the toolbar is placed
    // above the block — so without accounting for the stand-in it lands exactly
    // on the label, and the author cannot click the field they want to rename.
    const [labelBox, toolbarBox] = await Promise.all([
      label.boundingBox(),
      toolbar.boundingBox(),
    ]);
    expect(labelBox, 'label should have a box').not.toBeNull();
    expect(toolbarBox, 'toolbar should have a box').not.toBeNull();
    const overlaps =
      labelBox!.x < toolbarBox!.x + toolbarBox!.width &&
      labelBox!.x + labelBox!.width > toolbarBox!.x &&
      labelBox!.y < toolbarBox!.y + toolbarBox!.height &&
      labelBox!.y + labelBox!.height > toolbarBox!.y;
    expect(overlaps, 'toolbar must not sit on top of the editable label').toBe(false);
  });
});
