import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * A frontend's toolbar without the link button (inka#485).
 *
 * The test frontend sends toolbarButtons ['bold', 'separator', 'clearformatting']
 * on this page. volto-slate's link button is a component with hooks, not a
 * factory; the toolbar used to call every listed button during its render to
 * sort them, so leaving link out changed its hook count and crashed the editor
 * ("Rendered fewer hooks than expected"). Mock frontend only (`mock-` prefix).
 */
test.describe('A toolbar without the link button', () => {
  test('a text block can be selected and formatted, and offers no link', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/no-link-toolbar-page');
    await helper.clickBlockInIframe('target');
    await helper.waitForBlockSelectedInAdmin('target');

    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar.locator('[data-toolbar-button="bold"]')).toBeVisible();
    await expect(toolbar.locator('[data-toolbar-button="clearformatting"]')).toBeVisible();
    await expect(toolbar.locator('[data-toolbar-button="link"]')).toHaveCount(0);

    // The editor is alive: selecting text and clearing its bold works.
    const editor = await helper.getEditorLocator('target');
    await helper.selectAllTextInEditor(editor);
    await toolbar.locator('[data-toolbar-button="clearformatting"] a').click();
    await expect(editor.locator(helper.getFormatSelector('bold'))).toHaveCount(0);
  });

  test('arriving from a page whose toolbar has the link button', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/clear-formatting-page');
    await helper.clickBlockInIframe('target');
    await helper.waitForBlockSelectedInAdmin('target');
    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar.locator('[data-toolbar-button="link"]')).toBeVisible();

    await helper.navigateToEdit('/no-link-toolbar-page');
    await helper.clickBlockInIframe('target');
    await helper.waitForBlockSelectedInAdmin('target');
    await expect(toolbar.locator('[data-toolbar-button="bold"]')).toBeVisible();
    await expect(toolbar.locator('[data-toolbar-button="link"]')).toHaveCount(0);
  });
});
