/**
 * Clipboard and text manipulation tests for inline editing in Volto Hydra admin UI.
 *
 * TODO - additional tests:
 * - DND a word within the same block
 * - DND a word between blocks
 * - paste rich text
 * - paste multi-paragraph rich text
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

test.describe('Inline Editing - Clipboard', () => {
  test('can cut and paste plain text', async ({ page }) => {
    // Test cut and paste functionality using clipboard helpers
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and type text
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Text to paste', { delay: 10 });
    await helper.waitForEditorText(editor, /Text to paste/);

    // Select all text and cut
    await helper.selectAllTextInEditor(editor);
    const cutText = await helper.cutSelectedText(editor);
    console.log('[TEST] Cut text:', JSON.stringify(cutText));

    // Wait for text to be cleared
    await helper.waitForEditorText(editor, /^$/);

    // Wait for editor to regain focus after cut (focus restoration is async)
    await expect(editor).toBeFocused({ timeout: 2000 });

    // Paste the text back and wait for it to appear
    await helper.pasteFromClipboard(editor);
    await helper.waitForEditorText(editor, /Text to paste/);

    // Verify paste worked
    const textAfterPaste = await helper.getCleanTextContent(editor);
    console.log('[TEST] Text after paste:', JSON.stringify(textAfterPaste));
    expect(textAfterPaste).toContain('Text to paste');
  });

  test('can delete across formatted text boundaries', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode (select all to replace existing content)
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);

    // Type "Hello " (replaces selection) then make "world" bold, then type " testing"
    await editor.pressSequentially('Hello ', { delay: 10 });

    // Apply bold formatting to "world"
    // Use ControlOrMeta+b (Cmd+B on macOS) for formatting
    await editor.press('ControlOrMeta+b');
    // Wait for bold button to become active (indicates bold mode is on)
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(true);
    }).toPass({ timeout: 5000 });
    await helper.waitForEditorFocus(editor);

    await editor.pressSequentially('world', { delay: 10 });

    await editor.press('ControlOrMeta+b'); // toggle bold off
    // Wait for bold button to become inactive
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(false);
    }).toPass({ timeout: 5000 });
    await helper.waitForEditorFocus(editor);

    await editor.pressSequentially(' testing', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello world testing/);

    // Verify we have "Hello world testing" with "world" in bold
    const initialText = await helper.getCleanTextContent(editor);
    expect(initialText).toBe('Hello world testing');

    // Select from position 3 to 14 (crosses bold boundary)
    // "Hello world testing" = 19 chars
    // Position 3 = after "Hel", Position 14 = after "Hello world te"
    // This removes "lo world te", leaving "Hel" + "sting" = "Helsting"
    await helper.selectTextRange(editor, 3, 14);

    // Press Delete to remove selected text
    await page.keyboard.press('Delete');

    // Deletion crossed the bold boundary: a range spanning an inline is a delete
    // transform (an admin round trip), so wait for the text it leaves — a fixed
    // 200ms read whatever was there at that moment (a slower admin: nothing yet).
    await expect.poll(() => helper.getCleanTextContent(editor)).toBe('Helsting');
  });

  test('pasting plain text with line break splits block like Enter', async ({ page }) => {
    // Pasting text that contains \n in a single-line slate field should
    // behave like pressing Enter: split the block at the newline boundary.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const iframe = helper.getIframe();

    // Enter edit mode and set up initial text
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Before', { delay: 10 });
    await helper.waitForEditorText(editor, /Before/);

    // Place cursor at end of text
    await editor.press('End');

    // Get initial block count
    const initialBlocks = await helper.getStableBlockCount();

    // Dispatch a paste event with plain text containing a line break
    await editor.evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'Hello\nWorld');
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: dt });
      el.dispatchEvent(event);
    });

    // The newline should cause a block split, creating one new block
    await helper.waitForBlockCountToBe(initialBlocks + 1, 5000);

    // Wait for the new "World" block to appear in the iframe
    const { blockId: worldBlockId } = await helper.waitForBlockByContent('World');

    // Verify the original block contains "BeforeHello" (text before \n appended)
    await helper.waitForEditorText(
      await helper.getEditorLocator(blockId), /BeforeHello/,
    );

    // Verify the new block is positioned right after the original
    const blockOrder = await helper.getBlockOrder();
    const originalIndex = blockOrder.indexOf(blockId);
    const worldIndex = blockOrder.indexOf(worldBlockId);
    expect(worldIndex).toBe(originalIndex + 1);
  });

  test('pasting HTML via document handler when no field is focused', async ({ page }) => {
    // When a block is selected but the editable field doesn't have focus
    // (e.g. user clicked on the admin sidebar), pasting should still work
    // via the document-level paste handler routing to the selected block.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const iframe = helper.getIframe();

    // Enter edit mode and clear text
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Original', { delay: 10 });
    await helper.waitForEditorText(editor, /Original/);

    // Click outside the iframe to move focus to the admin page
    // The block should remain selected but the editable field loses focus
    await page.locator('#sidebar').click({ force: true }).catch(() => {
      // Sidebar may not exist in all test setups, click the admin body instead
      return page.locator('body').click({ position: { x: 5, y: 5 } });
    });
    await page.waitForTimeout(200);

    // Now dispatch a paste event on the iframe's document (not on the field)
    // The document-level handler should catch it and route to the selected block
    await iframe.locator('body').evaluate((body) => {
      const dt = new DataTransfer();
      dt.setData('text/html', '<p><strong>Pasted</strong> content</p>');
      dt.setData('text/plain', 'Pasted content');
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: dt });
      body.dispatchEvent(event);
    });

    // Wait for the paste to be processed — editor should contain pasted content
    await expect(async () => {
      const editorAfter = await helper.getEditorLocator(blockId);
      const text = await helper.getCleanTextContent(editorAfter);
      expect(text).toContain('Pasted');
    }).toPass({ timeout: 5000 });
  });

  test('pasting HTML with image into container creates image block', async ({ page }) => {
    // Pasting HTML that contains text and an <img> tag into a block inside a
    // container (columns) should split into: text in original block, image
    // block after it, remaining text in another block — all within the same column.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const blockId = 'text-1a'; // Inside col-1 of columns-1

    // Enter edit mode and clear existing text
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Start', { delay: 10 });
    await helper.waitForEditorText(editor, /Start/);

    // Place cursor at end
    await editor.press('End');

    // Get initial block count
    const initialBlocks = await helper.getStableBlockCount();

    // Paste HTML with text + image + more text
    await editor.evaluate((el, mockApiUrl) => {
      const dt = new DataTransfer();
      dt.setData('text/html', `<p>Hello</p><img src="${mockApiUrl}/test-image.jpg" alt="Pasted image"><p>World</p>`);
      dt.setData('text/plain', 'Hello\n[image]\nWorld');
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: dt });
      el.dispatchEvent(event);
    }, URLS.mockApi);

    // Should create 2 new blocks (image + "World" text) in the same column
    await helper.waitForBlockCountToBe(initialBlocks + 2, 10000);

    // Verify content: original block has "StartHello", new block has "World"
    const iframe = helper.getIframe();
    await expect(iframe.locator(`[data-block-uid="${blockId}"]`))
      .toContainText('StartHello', { timeout: 5000 });
    const { blockId: worldBlockId } = await helper.waitForBlockByContent('World');

    // Verify order: original → image → World
    const blockOrder = await helper.getBlockOrder();
    const originalIndex = blockOrder.indexOf(blockId);
    const worldIndex = blockOrder.indexOf(worldBlockId);
    expect(worldIndex).toBe(originalIndex + 2);

    // Verify the block between original and World is an image
    const imageBlockId = blockOrder[originalIndex + 1];
    expect(imageBlockId).toBeDefined();
    await expect(iframe.locator(`[data-block-uid="${imageBlockId}"] img`))
      .toBeAttached({ timeout: 5000 });

    // Verify new blocks are still inside the same column container:
    // Click on the "World" block and check sidebar shows ‹ Column breadcrumb
    await helper.clickBlockByContent('World');
    const columnNav = page.locator('.parent-nav:has-text("Column")');
    await expect(columnNav.first()).toBeVisible({ timeout: 5000 });
  });

  test('pasting HTML with table creates table block', async ({ page }) => {
    // Pasting HTML that contains a <table> should extract the table into a
    // separate Volto table block, with surrounding text staying as slate blocks.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const iframe = helper.getIframe();

    // Enter edit mode and set up initial text
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Before', { delay: 10 });
    await helper.waitForEditorText(editor, /Before/);
    await editor.press('End');

    // Paste HTML: text + table + text
    await editor.evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData('text/html',
        '<p>Hello</p>' +
        '<table><tr><th>Name</th><th>Value</th></tr>' +
        '<tr><td>A</td><td>1</td></tr></table>' +
        '<p>After table</p>',
      );
      dt.setData('text/plain', 'Hello\nName\tValue\nA\t1\nAfter table');
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: dt });
      el.dispatchEvent(event);
    });

    // Wait for the "After table" text block to appear (proves both blocks were created)
    const { blockId: afterBlockId } = await helper.waitForBlockByContent('After table');

    // Original block should contain "BeforeHello"
    await expect(iframe.locator(`[data-block-uid="${blockId}"]`))
      .toContainText('BeforeHello', { timeout: 5000 });

    // Verify order: original → table → After table
    // (getBlockOrder returns all data-block-uid elements including table internals,
    // so we just check the table block is between original and "After table")
    const blockOrder = await helper.getBlockOrder();
    const originalIndex = blockOrder.indexOf(blockId);
    const afterIndex = blockOrder.indexOf(afterBlockId);
    expect(afterIndex).toBeGreaterThan(originalIndex + 1);

    // Verify the table block between original and "After table" renders a table
    const tableBlockId = blockOrder[originalIndex + 1];
    expect(tableBlockId).toBeDefined();
    await expect(iframe.locator(`[data-block-uid="${tableBlockId}"]`))
      .toContainText('Name', { timeout: 5000 });
  });

  test('clipboard test on parent document', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Navigate to the admin UI
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Create a test element on the parent page
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'test-clipboard';
      div.contentEditable = 'true';
      div.textContent = 'Test clipboard text';
      div.style.cssText = 'position: fixed; top: 10px; left: 10px; padding: 10px; background: white; z-index: 9999;';
      document.body.appendChild(div);
    });

    // Select and copy from parent document
    const testDiv = page.locator('#test-clipboard');
    await testDiv.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');

    // Wait for clipboard to contain the expected text (copy may not complete immediately in CI)
    await expect
      .poll(async () => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: 5000,
      })
      .toBe('Test clipboard text');
  });
});
