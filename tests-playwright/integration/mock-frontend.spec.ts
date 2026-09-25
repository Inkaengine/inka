/**
 * Tests that read the MOCK frontend's own setup — its allowedBlocks list, and the
 * #render-counter it exposes to count its renders. Other frontends have their own
 * configuration and no counter, so only admin-mock runs this file (the other
 * admin projects ignore mock-*.spec.ts, as they ignore nuxt-*.spec.ts).
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Mock frontend: re-renders while typing', () => {
  test('cursor position remains stable while typing', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('nuxt'), 'Uses #render-counter which only exists in mock frontend');
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const iframe = helper.getIframe();

    // Enter edit mode and get the editor
    const editor = await helper.enterEditMode(blockId);

    // Get initial render count after block is selected and ready
    const initialRenderCount = await iframe.locator('#render-counter').textContent();

    // Clear existing text
    await helper.selectAllTextInEditor(editor);

    // Type text at the end
    await editor.pressSequentially('Hello World', { delay: 20 });
    await helper.waitForEditorText(editor, /Hello World/);

    // Simple text edits should NOT trigger re-render
    const afterTypingCount = await iframe.locator('#render-counter').textContent();
    expect(afterTypingCount).toBe(initialRenderCount);

    // Check cursor is at end after typing (position 11 = length of "Hello World")
    const cursorAfterTyping = await helper.getCursorInfo(editor);
    expect(cursorAfterTyping.cursorOffset, `Cursor should be at end after typing. Got: ${JSON.stringify(cursorAfterTyping)}`).toBe(11);

    // Move cursor to start - NO re-render should happen
    // Note: Home key and Meta+ArrowLeft don't work cross-platform with hydra.js.
    // Using helper that sets selection via JavaScript.
    await helper.moveCursorToStart(editor);
    const renderAfterHome = await iframe.locator('#render-counter').textContent();
    expect(renderAfterHome, `Render count should not change on cursor navigation`).toBe(initialRenderCount);
    const cursorAfterHome = await helper.getCursorInfo(editor);
    expect(cursorAfterHome.cursorOffset, `Cursor should be at 0 after moveCursorToStart. Got: ${JSON.stringify(cursorAfterHome)}`).toBe(0);

    // Move cursor right 6 positions (after "Hello ") - NO re-render should happen
    for (let i = 0; i < 6; i++) {
      await editor.press('ArrowRight');
    }
    const renderAfterArrows = await iframe.locator('#render-counter').textContent();
    expect(renderAfterArrows, `Render count should not change on ArrowRight keys`).toBe(initialRenderCount);
    const cursorAfterArrows = await helper.getCursorInfo(editor);
    expect(cursorAfterArrows.cursorOffset, `Cursor should be at 6 after 6x ArrowRight. Got: ${JSON.stringify(cursorAfterArrows)}`).toBe(6);

    // Type at cursor position
    await page.keyboard.type('Beautiful ');

    // Assert cursor is now at position 16 (6 + 10 chars of "Beautiful ")
    await helper.assertCursorAtPosition(editor, 16, blockId);
    await helper.waitForEditorText(editor, /Hello Beautiful World/);

    // Still no re-render
    const finalRenderCount = await iframe.locator('#render-counter').textContent();
    expect(finalRenderCount).toBe(initialRenderCount);

    // Verify text was inserted at cursor position
    const finalText = await helper.getCleanTextContent(editor);
    expect(finalText).toBe('Hello Beautiful World');
  });

  // This test verifies DOM element identity which may differ in Vue due to reactivity
});

test.describe('Allowed Blocks from Frontend', () => {
  // These tests check the MOCK frontend's own allowedBlocks configuration (no
  // video, a custom block of its own); every other frontend declares its own list.

  test('block chooser hides blocks not in allowedBlocks list', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click a block to select it, then click the add button
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.clickAddBlockButton();

    // Wait for the block chooser to appear
    const chooserVisible = await helper.isBlockChooserVisible();
    expect(chooserVisible).toBe(true);

    // Frontend allows: ['slate', 'image', 'hero'] (configured in test-frontend/index.html)
    // Video block should NOT be visible (not in allowed list)
    expect(await helper.isBlockTypeVisible('video')).toBe(false);
  });

  test('custom block from frontend appears in block chooser', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click a block to select it, then click the add button
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.clickAddBlockButton();

    // Wait for the block chooser to appear
    const chooserVisible = await helper.isBlockChooserVisible();
    expect(chooserVisible).toBe(true);

    // Custom 'hero' block should be visible (defined in test-frontend/index.html)
    expect(await helper.isBlockTypeVisible('hero')).toBe(true);
  });

  test('can add custom block defined by frontend', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const initialCount = await helper.getBlockCount();

    // Click a block to select it, then add a hero block
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.clickAddBlockButton();
    await helper.selectBlockType('hero');

    // Verify block was added
    await helper.waitForBlockCountToBe(initialCount + 1);
    const newCount = await helper.getBlockCount();
    expect(newCount).toBe(initialCount + 1);
  });
});
