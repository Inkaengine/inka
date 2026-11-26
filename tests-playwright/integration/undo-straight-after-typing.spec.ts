/**
 * inka#555: Cmd/Ctrl+Z in the page straight after typing undoes the typing.
 *
 * The page sends the typed text and the undo to the admin one after the other.
 * Pressed before the admin had recorded the typing, the undo took back the edit
 * before it (or nothing), and the typing then landed on top.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

const ORIGINAL = 'This is a test paragraph';

for (const mod of ['Control', 'Meta'] as const) {
  test(`${mod}+z straight after typing takes the typing back`, async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const editor = await helper.enterEditMode('block-1-uuid');
    await helper.moveCursorToEnd(editor);
    await editor.pressSequentially(' and more', { delay: 10 });
    await page.keyboard.press(`${mod}+z`);

    await helper.waitForEditorText(editor, new RegExp(`^${ORIGINAL}$`));
    await helper.openSidebarTab('Block');
    await helper.waitForFieldValueToBe('value', ORIGINAL);
  });
}

test('an earlier edit survives undoing the latest one', async ({ page }) => {
  const helper = new AdminUIHelper(page);
  await helper.login();
  await helper.navigateToEdit('/test-page');

  const editor = await helper.enterEditMode('block-1-uuid');
  await helper.moveCursorToEnd(editor);
  await editor.pressSequentially(' first', { delay: 10 });
  await helper.openSidebarTab('Block');
  await helper.waitForFieldValueToBe('value', `${ORIGINAL} first`);

  await editor.pressSequentially(' second', { delay: 10 });
  await page.keyboard.press('Control+z');

  await helper.waitForEditorText(editor, new RegExp(`^${ORIGINAL} first$`));
  await helper.waitForFieldValueToBe('value', `${ORIGINAL} first`);
});
