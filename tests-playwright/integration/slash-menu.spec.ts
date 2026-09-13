/**
 * Tests for slash menu (/) block chooser in inline editing.
 *
 * When a user types "/" in an empty slate block, a dropdown appears
 * showing available block types. Typing more letters filters the list.
 * Arrow keys navigate, Enter selects, Escape dismisses.
 *
 * The slash menu is rendered in the admin UI (positioned under the
 * iframe field), not inside the iframe itself.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Slash Menu', () => {
  test('typing / in empty slate block shows slash menu', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const editor = await helper.enterEditMode(blockId);

    // Clear existing text and type /
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('/', { delay: 10 });

    // Slash menu should appear in the admin page (not iframe)
    const slashMenu = page.locator('.power-user-menu');
    await expect(slashMenu).toBeVisible({ timeout: 5000 });

    // Should show block type options
    const menuItems = slashMenu.locator('.ui.menu .item');
    await expect(menuItems.first()).toBeVisible({ timeout: 3000 });
  });

  test('typing /her filters to show Hero block', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const editor = await helper.enterEditMode(blockId);

    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('/her', { delay: 10 });

    const slashMenu = page.locator('.power-user-menu');
    await expect(slashMenu).toBeVisible({ timeout: 5000 });

    // Should show Hero in the filtered results
    const heroItem = slashMenu.locator('.ui.menu .item', { hasText: 'Hero' });
    await expect(heroItem).toBeVisible({ timeout: 3000 });
  });

  test('Enter selects block type from slash menu', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const iframe = helper.getIframe();
    const editor = await helper.enterEditMode(blockId);

    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('/her', { delay: 10 });

    const slashMenu = page.locator('.power-user-menu');
    await expect(slashMenu).toBeVisible({ timeout: 5000 });

    // Press Enter to select the first (Hero) item
    await editor.press('Enter');

    // Slash menu should close
    await expect(slashMenu).not.toBeVisible({ timeout: 5000 });

    // Block should now be a hero block. Assert the block's OWN class, not a child
    // field element: a freshly converted hero has no field data, and fields are
    // data-driven (issue #296), so `.hero-heading` no longer renders. The wrapper
    // is the direct signal for "this block is a hero" anyway.
    await expect(
      iframe.locator(`[data-block-uid="${blockId}"]`),
      'block should have been converted to a hero',
    ).toHaveClass(/hero-block/, { timeout: 5000 });
  });

  test('Escape dismisses slash menu', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const editor = await helper.enterEditMode(blockId);

    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('/', { delay: 10 });

    const slashMenu = page.locator('.power-user-menu');
    await expect(slashMenu).toBeVisible({ timeout: 5000 });

    // Press Escape to dismiss
    await editor.press('Escape');

    await expect(slashMenu).not.toBeVisible({ timeout: 5000 });

    // Same block should still be selected (sidebar shows its settings)
    const iframe = helper.getIframe();
    const blockOutline = iframe.locator(`[data-block-uid="${blockId}"]`);
    await expect(blockOutline).toBeVisible();

    // Editor should still be focused — typing should work
    await editor.pressSequentially('hello', { delay: 10 });
    await helper.waitForEditorText(editor, /hello/, 5000);
  });

  test('ArrowDown navigates through slash menu items', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const editor = await helper.enterEditMode(blockId);

    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('/', { delay: 10 });

    const slashMenu = page.locator('.power-user-menu');
    await expect(slashMenu).toBeVisible({ timeout: 5000 });

    // First item should be active initially
    const items = slashMenu.locator('.ui.menu .item');
    await expect(items.first()).toHaveClass(/active/, { timeout: 3000 });

    // Arrow down should move to second item
    await editor.press('ArrowDown');
    await expect(items.nth(1)).toHaveClass(/active/, { timeout: 3000 });

    // Arrow up should move back to first item
    await editor.press('ArrowUp');
    await expect(items.first()).toHaveClass(/active/, { timeout: 3000 });
  });

  test('non-slash text does not show slash menu', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const editor = await helper.enterEditMode(blockId);

    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('hello world', { delay: 10 });

    // Slash menu should NOT appear
    const slashMenu = page.locator('.power-user-menu');
    await expect(slashMenu).not.toBeVisible({ timeout: 2000 });
  });

  test('deleting back to non-slash text hides slash menu', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const editor = await helper.enterEditMode(blockId);

    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('/', { delay: 10 });

    const slashMenu = page.locator('.power-user-menu');
    await expect(slashMenu).toBeVisible({ timeout: 5000 });

    // Delete the "/" character
    await editor.press('Backspace');

    // Slash menu should hide
    await expect(slashMenu).not.toBeVisible({ timeout: 5000 });
  });

  test('clicking outside the menu closes it', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const editor = await helper.enterEditMode(blockId);

    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('/', { delay: 10 });

    const slashMenu = page.locator('.power-user-menu');
    await expect(slashMenu).toBeVisible({ timeout: 5000 });

    // Click in the sidebar (outside the menu but also outside the iframe)
    await page.locator('.sidebar-container').click();

    await expect(slashMenu).not.toBeVisible({ timeout: 5000 });
  });

  test('clicking a menu item selects that block type', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const iframe = helper.getIframe();
    const editor = await helper.enterEditMode(blockId);

    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('/her', { delay: 10 });

    const slashMenu = page.locator('.power-user-menu');
    await expect(slashMenu).toBeVisible({ timeout: 5000 });

    // Click the Hero item
    const heroItem = slashMenu.locator('.ui.menu .item', { hasText: 'Hero' });
    await heroItem.click();

    // Slash menu should close
    await expect(slashMenu).not.toBeVisible({ timeout: 5000 });

    // Block should now be a hero block. Assert the block's OWN class, not a child
    // field element — see the Enter-selects test above for why.
    await expect(
      iframe.locator(`[data-block-uid="${blockId}"]`),
      'block should have been converted to a hero',
    ).toHaveClass(/hero-block/, { timeout: 5000 });
  });
});
