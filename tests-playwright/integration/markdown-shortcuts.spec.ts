/**
 * Tests for markdown shortcut support in inline editing.
 *
 * Volto's Slate editor supports markdown-like autoformat shortcuts:
 * - Block-level: "## " → H2, "### " → H3, "* " → UL, "1. " → OL, "> " → blockquote
 * - Inline: "**text** " → bold, "*text* " → italic, "~~text~~ " → strikethrough
 *
 * In Hydra, hydra.js detects these patterns on Space keystroke and sends
 * a SLATE_TRANSFORM_REQUEST with transformType: 'markdown' to the admin.
 * The admin's SyncedSlateToolbar triggers editor.insertText(' ') which
 * fires Volto's withAutoformat plugin.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Markdown Shortcuts', () => {
  test.describe('Block-level shortcuts', () => {
    test('## space converts to H2 heading', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      const blockId = 'block-1-uuid';
      const editor = await helper.enterEditMode(blockId);

      // Clear existing text and type markdown prefix
      await helper.selectAllTextInEditor(editor);
      await editor.pressSequentially('##', { delay: 10 });

      // Press space to trigger the markdown transform
      await editor.press(' ');

      // Wait for H2 element to appear (transform roundtrip)
      const h2 = helper.getIframe().locator(`[data-block-uid="${blockId}"] h2`);
      await expect(h2).toBeVisible({ timeout: 5000 });

      // Now type the content text after the transform is complete
      await editor.pressSequentially('Hello Heading', { delay: 10 });

      await expect(h2).toContainText('Hello Heading', { timeout: 5000 });
    });

    test('### space converts to H3 heading', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      const blockId = 'block-1-uuid';
      const editor = await helper.enterEditMode(blockId);

      await helper.selectAllTextInEditor(editor);
      await editor.pressSequentially('###', { delay: 10 });
      await editor.press(' ');

      const h3 = helper.getIframe().locator(`[data-block-uid="${blockId}"] h3`);
      await expect(h3).toBeVisible({ timeout: 5000 });

      await editor.pressSequentially('Hello H3', { delay: 10 });
      await expect(h3).toContainText('Hello H3', { timeout: 5000 });
    });

    test('* space converts to unordered list', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      const blockId = 'block-1-uuid';
      const editor = await helper.enterEditMode(blockId);

      await helper.selectAllTextInEditor(editor);
      await editor.pressSequentially('*', { delay: 10 });
      await editor.press(' ');

      const li = helper.getIframe().locator(`[data-block-uid="${blockId}"] ul li`);
      await expect(li).toBeVisible({ timeout: 5000 });

      await editor.pressSequentially('List item', { delay: 10 });
      await expect(li).toContainText('List item', { timeout: 5000 });
    });

    test('- space converts to unordered list', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      const blockId = 'block-1-uuid';
      const editor = await helper.enterEditMode(blockId);

      await helper.selectAllTextInEditor(editor);
      await editor.pressSequentially('-', { delay: 10 });
      await editor.press(' ');

      const li = helper.getIframe().locator(`[data-block-uid="${blockId}"] ul li`);
      await expect(li).toBeVisible({ timeout: 5000 });

      await editor.pressSequentially('Dash list', { delay: 10 });
      await expect(li).toContainText('Dash list', { timeout: 5000 });
    });

    test('1. space converts to ordered list', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      const blockId = 'block-1-uuid';
      const editor = await helper.enterEditMode(blockId);

      await helper.selectAllTextInEditor(editor);
      await editor.pressSequentially('1.', { delay: 10 });
      await editor.press(' ');

      const li = helper.getIframe().locator(`[data-block-uid="${blockId}"] ol li`);
      await expect(li).toBeVisible({ timeout: 5000 });

      await editor.pressSequentially('Ordered item', { delay: 10 });
      await expect(li).toContainText('Ordered item', { timeout: 5000 });
    });

    test('> space converts to blockquote', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      const blockId = 'block-1-uuid';
      const editor = await helper.enterEditMode(blockId);

      await helper.selectAllTextInEditor(editor);
      await editor.pressSequentially('>', { delay: 10 });
      await editor.press(' ');

      const bq = helper.getIframe().locator(`[data-block-uid="${blockId}"] blockquote`);
      await expect(bq).toBeVisible({ timeout: 5000 });

      await editor.pressSequentially('Quote text', { delay: 10 });
      await expect(bq).toContainText('Quote text', { timeout: 5000 });
    });
  });

  test.describe('Inline shortcuts', () => {
    test('inline markdown patterns apply formatting with trailing space', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      const blockId = 'block-1-uuid';
      const iframe = helper.getIframe();
      const block = iframe.locator(`[data-block-uid="${blockId}"]`);
      const editor = await helper.enterEditMode(blockId);
      const boldSelector = helper.getFormatSelector('bold');
      const italicSelector = helper.getFormatSelector('italic');
      const strikeSelector = 'del, s, span[style*="text-decoration: line-through"]';

      // Helper to clear editor content between sub-tests.
      // selectAll + Backspace triggers a delete transform when formatted content
      // spans element nodes, so we must wait for it to complete before typing.
      const clearEditor = async () => {
        await helper.selectAllTextInEditor(editor);
        await editor.press('Backspace');
        await helper.waitForEditorText(editor, /^[\s\uFEFF\u200B]*$/);
      };

      // **bold** — with preceding text like real usage
      await clearEditor();
      await editor.pressSequentially('some text **bold**', { delay: 10 });
      await editor.press(' ');
      await expect(block.locator(boldSelector)).toContainText('bold', { timeout: 5000 });
      expect(await editor.textContent()).toMatch(/some text bold\s/);

      // __bold__
      await clearEditor();

      await editor.pressSequentially('some text __under__', { delay: 10 });
      await editor.press(' ');
      await expect(block.locator(boldSelector)).toContainText('under', { timeout: 5000 });
      expect(await editor.textContent()).toMatch(/some text under\s/);

      // ~~strikethrough~~
      await clearEditor();
      await editor.pressSequentially('some text ~~strike~~', { delay: 10 });
      await editor.press(' ');
      await expect(block.locator(strikeSelector)).toContainText('strike', { timeout: 5000 });
      expect(await editor.textContent()).toMatch(/some text strike\s/);

      // *italic*
      await clearEditor();
      await editor.pressSequentially('some text *italic*', { delay: 10 });
      await editor.press(' ');
      await expect(block.locator(italicSelector)).toContainText('italic', { timeout: 5000 });
      expect(await editor.textContent()).toMatch(/some text italic\s/);

      // _italic_
      await clearEditor();
      await editor.pressSequentially('some text _emphasis_', { delay: 10 });
      await editor.press(' ');
      await expect(block.locator(italicSelector)).toContainText('emphasis', { timeout: 5000 });
      expect(await editor.textContent()).toMatch(/some text emphasis\s/);
    });
  });

  test.describe('New block shortcuts', () => {
    test('- space converts to bullet list in a newly created block', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      const blockId = 'block-1-uuid';
      const iframe = helper.getIframe();

      // Enter edit mode, move to end, and press Enter to create a new block
      const editor = await helper.enterEditMode(blockId);
      await helper.selectAllTextInEditor(editor);
      await editor.pressSequentially('Some text', { delay: 10 });
      await helper.waitForEditorText(editor, /Some text/);

      const initialBlocks = await helper.getStableBlockCount();
      await editor.press('Enter');
      await helper.waitForBlockCountToBe(initialBlocks + 1, 5000);

      // Find the new block (already selected/focused after Enter)
      const blockOrder = await helper.getBlockOrder();
      const originalBlockIndex = blockOrder.indexOf(blockId);
      const newBlockUid = blockOrder[originalBlockIndex + 1];
      expect(newBlockUid).toBeTruthy();

      // The new block is already focused — wait for editable field to appear
      // (Nuxt needs time for hydra.js to add contenteditable after async re-render)
      const newEditor = await helper.getEditorLocator(newBlockUid);
      await expect(newEditor).toBeAttached({ timeout: 10000 });
      await newEditor.pressSequentially('-', { delay: 10 });
      await newEditor.press(' ');

      // Should convert to unordered list
      const li = iframe.locator(`[data-block-uid="${newBlockUid}"] ul li`);
      await expect(li).toBeVisible({ timeout: 5000 });

      await newEditor.pressSequentially('New block list', { delay: 10 });
      await expect(li).toContainText('New block list', { timeout: 5000 });
    });

  });

  test.describe('List keyboard handling', () => {
    test('Enter in a bullet list creates a new bullet, not a new block', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      const blockId = 'block-1-uuid';
      const iframe = helper.getIframe();
      const editor = await helper.enterEditMode(blockId);

      // Create bullet list via markdown shortcut
      await helper.selectAllTextInEditor(editor);
      await editor.pressSequentially('-', { delay: 10 });
      await editor.press(' ');

      const li = iframe.locator(`[data-block-uid="${blockId}"] ul li`);
      await expect(li.first()).toBeVisible({ timeout: 5000 });

      // Type text in the first bullet
      await editor.pressSequentially('first item', { delay: 10 });
      await expect(li.first()).toContainText('first item', { timeout: 5000 });

      const initialBlocks = await helper.getStableBlockCount();

      // Press Enter — should create a second bullet, NOT a new block
      await editor.press('Enter');

      // Should now have two list items in the same block
      await expect(li).toHaveCount(2, { timeout: 5000 });

      // Block count should NOT have changed
      const afterBlocks = await helper.getStableBlockCount();
      expect(afterBlocks).toBe(initialBlocks);

      // Type in the second bullet
      await editor.pressSequentially('second item', { delay: 10 });
      await expect(li.nth(1)).toContainText('second item', { timeout: 5000 });
    });

    test('Enter on empty bullet exits list and creates a new block', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      const blockId = 'block-1-uuid';
      const iframe = helper.getIframe();
      const editor = await helper.enterEditMode(blockId);

      // Create bullet list via markdown shortcut
      await helper.selectAllTextInEditor(editor);
      await editor.pressSequentially('-', { delay: 10 });
      await editor.press(' ');

      const li = iframe.locator(`[data-block-uid="${blockId}"] ul li`);
      await expect(li.first()).toBeVisible({ timeout: 5000 });

      // Type text in the first bullet then Enter to create second bullet
      await editor.pressSequentially('first item', { delay: 10 });
      await editor.press('Enter');
      await expect(li).toHaveCount(2, { timeout: 5000 });

      const initialBlocks = await helper.getStableBlockCount();

      // Press Enter again on the empty second bullet — should exit list and create new block
      await editor.press('Enter');
      await helper.waitForBlockCountToBe(initialBlocks + 1, 5000);

      // The original block should still have a list with one item
      await expect(iframe.locator(`[data-block-uid="${blockId}"] ul li`)).toHaveCount(1, { timeout: 5000 });
    });

    test('Tab indents a bullet into a nested list', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      const blockId = 'block-1-uuid';
      const iframe = helper.getIframe();
      const block = iframe.locator(`[data-block-uid="${blockId}"]`);
      const editor = await helper.enterEditMode(blockId);

      // Create bullet list with two items
      await helper.selectAllTextInEditor(editor);
      await editor.pressSequentially('-', { delay: 10 });
      await editor.press(' ');
      await expect(block.locator('ul li').first()).toBeVisible({ timeout: 5000 });
      await editor.pressSequentially('parent', { delay: 10 });
      await editor.press('Enter');
      await editor.pressSequentially('child', { delay: 10 });

      // Tab on second bullet should indent it (nested ul)
      await editor.press('Tab');

      // Should now have a nested list: ul > li > ul > li
      const nestedLi = block.locator('ul ul li');
      await expect(nestedLi).toBeVisible({ timeout: 5000 });
      await expect(nestedLi).toContainText('child');
    });

    test('Shift+Tab outdents a nested bullet', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      const blockId = 'block-1-uuid';
      const iframe = helper.getIframe();
      const block = iframe.locator(`[data-block-uid="${blockId}"]`);
      const editor = await helper.enterEditMode(blockId);

      // Create bullet list with two items, indent the second
      await helper.selectAllTextInEditor(editor);
      await editor.pressSequentially('-', { delay: 10 });
      await editor.press(' ');
      await expect(block.locator('ul li').first()).toBeVisible({ timeout: 5000 });
      await editor.pressSequentially('parent', { delay: 10 });
      await editor.press('Enter');
      await editor.pressSequentially('child', { delay: 10 });
      await editor.press('Tab');
      await expect(block.locator('ul ul li')).toBeVisible({ timeout: 5000 });

      // Shift+Tab should outdent back to top level
      await editor.press('Shift+Tab');

      // Nested list should be gone — both items at top level
      await expect(block.locator('ul ul')).not.toBeVisible({ timeout: 5000 });
      const topItems = block.locator('ul > li');
      await expect(topItems).toHaveCount(2, { timeout: 5000 });
    });

    test('Shift+Tab on top-level bullet splits into separate blocks', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      const blockId = 'block-1-uuid';
      const iframe = helper.getIframe();
      const editor = await helper.enterEditMode(blockId);

      // Create bullet list with three items: alpha, beta, gamma
      await helper.selectAllTextInEditor(editor);
      await editor.pressSequentially('-', { delay: 10 });
      await editor.press(' ');
      const block = iframe.locator(`[data-block-uid="${blockId}"]`);
      await expect(block.locator('ul li').first()).toBeVisible({ timeout: 5000 });
      await editor.pressSequentially('alpha', { delay: 10 });
      await editor.press('Enter');
      await editor.pressSequentially('beta', { delay: 10 });
      await editor.press('Enter');
      await editor.pressSequentially('gamma', { delay: 10 });

      // Should have 3 list items in one block
      await expect(block.locator('ul li')).toHaveCount(3, { timeout: 5000 });
      const initialBlocks = await helper.getStableBlockCount();

      // Move cursor to "beta" (second item) — click on it directly
      await block.locator('ul li', { hasText: 'beta' }).click();
      await helper.waitForIframeBlockHandle(blockId);

      // Shift+Tab on top-level item should split into 3 blocks:
      // 1) list with "alpha", 2) paragraph "beta", 3) list with "gamma"
      await editor.press('Shift+Tab');

      // Block count should increase by 2 (1 block → 3 blocks)
      await helper.waitForBlockCountToBe(initialBlocks + 2);

      // The original block should now be a list with just "alpha"
      await expect(block.locator('ul li')).toHaveCount(1, { timeout: 5000 });
      await expect(block.locator('ul li').first()).toContainText('alpha');
    });

    test('typing "1. " inside an existing list item does not trigger markdown shortcut', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      const blockId = 'block-1-uuid';
      const iframe = helper.getIframe();
      const block = iframe.locator(`[data-block-uid="${blockId}"]`);
      const editor = await helper.enterEditMode(blockId);

      // Create bullet list via markdown shortcut
      await helper.selectAllTextInEditor(editor);
      await editor.pressSequentially('-', { delay: 10 });
      await editor.press(' ');
      await expect(block.locator('ul li').first()).toBeVisible({ timeout: 5000 });

      // Type text in first bullet, then Enter to create second bullet
      await editor.pressSequentially('first', { delay: 10 });
      await editor.press('Enter');
      await expect(block.locator('ul li')).toHaveCount(2, { timeout: 5000 });

      // Type "1. " in the second list item — this should NOT trigger
      // the ordered list markdown shortcut (we're already inside a list)
      await editor.pressSequentially('1.', { delay: 10 });
      await editor.press(' ');

      // Wait a moment for any transform to complete (or not)
      await page.waitForTimeout(500);

      // The block should still be a UL with 2 items — not corrupted
      await expect(block.locator('ul')).toBeVisible({ timeout: 3000 });
      await expect(block.locator('ul li')).toHaveCount(2, { timeout: 3000 });
      await expect(block.locator('ul li').first()).toContainText('first');
      // The second item should contain "1. " as literal text (space was typed normally)
      await expect(block.locator('ul li').nth(1)).toContainText('1.', { timeout: 3000 });

      // The editor should still be functional (not stuck/blocked)
      await editor.pressSequentially('more text', { delay: 10 });
      await expect(block.locator('ul li').nth(1)).toContainText('more text', { timeout: 5000 });
    });
  });

  test.describe('Non-matching patterns', () => {
    test('regular space does not trigger markdown', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      const blockId = 'block-1-uuid';
      const editor = await helper.enterEditMode(blockId);

      await helper.selectAllTextInEditor(editor);
      await editor.pressSequentially('hello world', { delay: 10 });

      // Should still be a paragraph, not any special block
      const blockEl = helper.getIframe().locator(`[data-block-uid="${blockId}"]`);
      await expect(blockEl.locator('h2')).not.toBeVisible();
      await expect(blockEl.locator('h3')).not.toBeVisible();
      await expect(blockEl.locator('ul')).not.toBeVisible();
      await expect(blockEl.locator('ol')).not.toBeVisible();
      await expect(blockEl.locator('blockquote')).not.toBeVisible();
    });
  });
});
