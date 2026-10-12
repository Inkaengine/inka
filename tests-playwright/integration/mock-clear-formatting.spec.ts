import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * Clear formatting (Tx).
 *
 * volto-slate's default toolbar has no Clear formatting; a frontend adds it to
 * settings.slate.toolbarButtons. The mock test frontend offers it on
 * clear-formatting-page, so these run against the mock frontend only (the
 * `mock-` prefix): the example frontends do not offer the button.
 */
test.describe('Clear formatting', () => {
  test('Clear formatting removes the formats from the selection', async ({ page }) => {
    // volto-slate's default toolbar has no Clear formatting; the test frontend
    // offers it on this page, as a design system's frontend does.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/clear-formatting-page');
    const blockId = 'target';
    await helper.clickBlockInIframe(blockId);
    await helper.waitForBlockSelectedInAdmin(blockId);
    const editor = await helper.getEditorLocator(blockId);
    await expect(editor.locator(helper.getFormatSelector('bold'))).toHaveText('Bold words');

    await helper.selectAllTextInEditor(editor);
    await helper.assertTextSelection(editor, 'Bold words and plain words', {
      shouldExist: true,
      shouldBeCollapsed: false,
      message: 'the whole line is selected before clearing',
    });
    const clear = page.locator('.quanta-toolbar [data-toolbar-button="clearformatting"] a');
    await expect(clear, 'there is bold to clear').not.toHaveClass(/disabled/);
    await clear.click();

    await expect(editor.locator(helper.getFormatSelector('bold'))).toHaveCount(0);
    expect(await helper.getCleanTextContent(editor)).toBe('Bold words and plain words');
  });

  test('Clear formatting is disabled when the selection has nothing to clear', async ({ page }) => {
    // Volto's button is always enabled, so on plain text a click does nothing
    // and says nothing. Inka disables it there.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/clear-formatting-page');
    await helper.clickBlockInIframe('plain');
    await helper.waitForBlockSelectedInAdmin('plain');
    const editor = await helper.getEditorLocator('plain');
    await helper.selectAllTextInEditor(editor);
    await helper.assertTextSelection(editor, 'Only plain words', {
      shouldExist: true,
      shouldBeCollapsed: false,
      message: 'the plain line is selected',
    });
    const clear = page.locator('.quanta-toolbar [data-toolbar-button="clearformatting"] a');
    await expect(clear).toHaveClass(/disabled/);
    // Its name still says what it would do.
    await expect(clear).toHaveAttribute('title', 'Clear formatting');
  });
});
