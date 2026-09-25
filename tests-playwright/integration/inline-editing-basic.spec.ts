/**
 * Basic cursor, typing, selection, and sync tests for inline editing in Volto Hydra admin UI.
 *
 * TODO - additional tests:
 * - click at end of block puts cursor at end of line
 * - paste formatting from one field to another
 * - multiple slate fields in one block
 * - double click on an unselected block and you should have the word selected
 * - double click to select block and word
 * - triple click to select paragraph
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Inline Editing - Basic', () => {
  test('selection is always inside element with data-node-id after block click', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const iframe = helper.getIframe();

    // Click on block to select it
    await helper.clickBlockInIframe(blockId);

    // Verify cursor is in a valid position (inside an element with data-node-id)
    const cursorInfo = await iframe.locator(`[data-block-uid="${blockId}"]`).evaluate((block) => {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) {
        return { hasSelection: false, inValidNode: false };
      }
      const anchorNode = selection.anchorNode;
      if (!anchorNode) {
        return { hasSelection: true, inValidNode: false };
      }

      // Walk up to find data-node-id
      let current: Node | null = anchorNode;
      while (current && current !== block) {
        if (current.nodeType === Node.ELEMENT_NODE) {
          const el = current as Element;
          if (el.hasAttribute('data-node-id')) {
            return { hasSelection: true, inValidNode: true, nodeId: el.getAttribute('data-node-id') };
          }
        }
        current = current.parentNode;
      }
      return { hasSelection: true, inValidNode: false, anchorContent: anchorNode.textContent?.substring(0, 30) };
    });

    expect(cursorInfo.inValidNode, `Cursor should be inside element with data-node-id. Got: ${JSON.stringify(cursorInfo)}`).toBe(true);
  });

  // This test uses #render-counter which only exists in mock test frontend
  test('typing does not cause DOM element to be replaced (no re-render)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('nuxt'), 'Vue reactivity may replace DOM elements differently');
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const iframe = helper.getIframe();

    // Enter edit mode
    const editor = await helper.enterEditMode(blockId);

    // Clear existing text
    await helper.selectAllTextInEditor(editor);

    // Get a reference to the contenteditable element and mark it
    const elementId = await editor.evaluate((el) => {
      // Add a unique marker to track this specific element instance
      const uniqueId = 'test-element-' + Date.now();
      el.setAttribute('data-test-element-id', uniqueId);
      return uniqueId;
    });

    // Type some text
    await page.keyboard.type('Hello world');
    await helper.waitForEditorText(editor, /Hello world/);

    // Check if the element is still the same instance
    const editorAfterType = await helper.getEditorLocator(blockId);
    const stillSameElement = await editorAfterType.evaluate((el, id) => {
      return el.getAttribute('data-test-element-id') === id;
    }, elementId);

    expect(stillSameElement).toBe(true);

    // Type more text
    await page.keyboard.type(' more text');
    await helper.waitForEditorText(editor, /Hello world more text/);

    // Verify element is STILL the same instance
    const editorAfterMore = await helper.getEditorLocator(blockId);
    const stillSameAfterMoreTyping = await editorAfterMore.evaluate((el, id) => {
      return el.getAttribute('data-test-element-id') === id;
    }, elementId);

    expect(stillSameAfterMoreTyping).toBe(true);
  });

  test('can type at cursor position', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and type initial text (select all to replace existing content)
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Hello World', { delay: 10 });

    // On the slower CI static build, pressSequentially's DOM/slate sync can lag.
    // moveCursorToPosition steps selection.modify() character-by-character from
    // the element start, so it must count against the FULLY-settled text —
    // otherwise it lands one short (cursor at index 5), yielding
    // "HelloBeautiful  World". Wait for the exact text before positioning.
    await helper.waitForEditorText(editor, /^Hello World$/);

    // Move cursor to the middle of the text (between 'Hello' and 'World')
    await helper.moveCursorToPosition(editor, 6); // Position after "Hello "

    // Type at cursor position
    await page.keyboard.type('Beautiful ');

    // Verify text was inserted at cursor position
    const finalText = await helper.getCleanTextContent(editor);
    expect(finalText).toBe('Hello Beautiful World');
  });

  // BUG: Typing BEFORE an inline format element (bold) fails to sync on second keystroke
  // Block structure: "This text appears..." + <strong>bold text</strong> + " to test..."
  // When typing in children[0] (before bold), sidebar loses sync after first keystroke
  //
  // ROOT CAUSE: Slate's `editor.children = value` direct mutation doesn't trigger DOM
  // re-renders for text nodes before inline formatting. The React data flow is correct
  // (ParentBlocksWidget receives "12appears") but Slate's DOM doesn't update.
  // This is a volto-slate internal issue, not a Hydra state management bug.
  // See docs/typing-sync-bug-investigation.md for full analysis
  test.skip('typing before bold: second keystroke fails to sync to sidebar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    // text-after block has mixed content: text + bold + text
    const blockId = 'text-after';

    await helper.clickBlockInIframe(blockId);
    await helper.waitForSidebarOpen();

    const editor = await helper.enterEditMode(blockId);

    // Position cursor BEFORE the bold element - at offset 10 in "This text appears..."
    await helper.moveCursorToPosition(editor, 10);

    const sidebarEditor = helper.getSidebarSlateEditor('value');

    // Type first character - wait for sidebar sync
    await page.keyboard.type('1');
    await helper.waitForEditorText(editor, /This text 1appears/);
    await expect(sidebarEditor).toContainText('This text 1appears', { timeout: 5000 });

    // Type second character
    await page.keyboard.type('2');
    await helper.waitForEditorText(editor, /This text 12appears/);
    await expect(sidebarEditor).toContainText('This text 12appears', { timeout: 5000 });

    // Type third character
    await page.keyboard.type('3');
    await helper.waitForEditorText(editor, /This text 123appears/);
    await expect(sidebarEditor).toContainText('This text 123appears', { timeout: 5000 });
  });

  // Typing AFTER an inline format element (bold) works correctly
  // This test passes - contrast with "typing before bold" which fails
  test('typing after bold: all keystrokes sync to sidebar correctly', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    // text-after block has: "This text appears..." + <bold>bold text</bold> + " to test getNodePath."
    const blockId = 'text-after';

    await helper.clickBlockInIframe(blockId);
    await helper.waitForSidebarOpen();

    const editor = await helper.enterEditMode(blockId);

    // Position cursor AFTER the bold element - at start of " to test getNodePath."
    // "This text appears after the slider. Click on " (46 chars) + "bold text" (9 chars) = offset 55
    await helper.moveCursorToPosition(editor, 55);

    const sidebarEditor = helper.getSidebarSlateEditor('value');

    // Type first character — wait for iframe and sidebar sync
    await page.keyboard.type('1');
    await helper.waitForEditorText(editor, /bold text\s*1\s*to test/);
    await expect(sidebarEditor).toContainText('1', { timeout: 5000 });

    // Type second character
    await page.keyboard.type('2');
    await helper.waitForEditorText(editor, /bold text\s*12\s*to test/);
    await expect(sidebarEditor).toContainText('12', { timeout: 5000 });

    // Type third character
    await page.keyboard.type('3');
    await helper.waitForEditorText(editor, /bold text\s*123\s*to test/);
    await expect(sidebarEditor).toContainText('123', { timeout: 5000 });
  });

  test('deleting formatted text syncs to sidebar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    const blockId = 'text-after';

    await helper.clickBlockInIframe(blockId);
    await helper.waitForSidebarOpen();

    const editor = await helper.enterEditMode(blockId);
    const sidebarEditor = helper.getSidebarSlateEditor('value');

    // Verify initial content has "bold text"
    await expect(sidebarEditor).toContainText('bold text', { timeout: 5000 });

    // Select "bold text" using character offsets
    // Text is: "This text appears after the slider. Click on bold text to test getNodePath."
    // "This text appears after the slider. Click on " = 45 chars
    // "bold text" = 9 chars (45-54)
    await helper.selectTextRange(editor, 45, 54);

    // Verify what was selected
    const selectionInfo = await helper.assertTextSelection(editor, 'bold text');
    expect(selectionInfo.selectedText).toBe('bold text');

    // Delete and wait for sync
    await page.keyboard.press('Backspace');

    // Verify iframe no longer has bold text
    await expect(async () => {
      const text = await helper.getCleanTextContent(editor);
      expect(text).not.toContain('bold text');
    }).toPass({ timeout: 5000 });

    // Verify sidebar synced
    await expect(sidebarEditor).not.toContainText('bold text', { timeout: 5000 });
  });

  test('can undo and redo', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and edit text (select all to replace existing content)
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('First', { delay: 10 });

    // Wait for "First" to sync to sidebar — this ensures the undo snapshot
    // is committed before we type more text
    await helper.openSidebarTab('Block');
    await helper.waitForFieldValueToBe('value', 'First');

    // Type more text - this will be a separate undo snapshot
    await editor.pressSequentially(' Second', { delay: 10 });

    // Wait for "First Second" to sync to sidebar before undoing
    await helper.waitForFieldValueToBe('value', 'First Second');

    // Undo - should remove " Second"
    await page.keyboard.press('Control+z');

    // Wait for undo to propagate to sidebar and iframe
    await helper.waitForFieldValueToBe('value', 'First');
    await helper.waitForEditorText(editor, /^First$/);

    // Redo - should restore "Second"
    await page.keyboard.press('Control+Shift+z');
    await helper.waitForFieldValueToBe('value', 'First Second');
    await helper.waitForEditorText(editor, /^First Second$/);
  });

  test('pressing Enter at end of line creates new Slate block', async ({ page }) => {
    // This test verifies the expected Volto behavior where pressing Enter
    // creates a new Slate block (like standard Volto does via withSplitBlocksOnBreak).
    // In Volto Hydra, the iframe communicates with the parent Admin UI to create a new block.

    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const iframe = helper.getIframe();

    // Click the first block and type text (select all to replace existing content)
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('First line', { delay: 10 });

    // Wait for text to sync before continuing
    await helper.waitForEditorText(editor, /First line/);

    // Click past the end of text to position cursor on whitespace (simulates real user click)
    // This tests the whitespace correction code path
    const editorBox = await editor.boundingBox();
    if (editorBox) {
      // Click at the right edge of the editor, past the text content
      await iframe.locator(`[data-block-uid="${blockId}"]`).click({
        position: { x: editorBox.width - 5, y: editorBox.height / 2 },
      });
    }

    // Get block count right before pressing Enter (as late as possible)
    // to ensure all async rendering has completed
    const initialBlocks = await helper.getStableBlockCount();

    // Press Enter - in standard Volto this would create a new block
    // Must press Enter in the iframe context, not the page context
    await editor.press('Enter');

    // Wait for the correct number of blocks to be created
    await helper.waitForBlockCountToBe(initialBlocks + 1, 5000);

    // Verify no processing/wait state remains after split
    await helper.waitForPointerUnblocked();

    // Check that no error toast appeared (Missing data-node-id)
    const errorToast = iframe.locator('#hydra-dev-warning');
    await expect(errorToast).not.toBeVisible({ timeout: 1000 });

    // Get the new block (should be right after the old block)
    const blockOrder = await helper.getBlockOrder();
    const originalBlockIndex = blockOrder.indexOf(blockId);
    expect(originalBlockIndex).toBeGreaterThanOrEqual(0);
    const newBlockUid = blockOrder[originalBlockIndex + 1];
    expect(newBlockUid).toBeTruthy();
    const newBlock = iframe.locator(`[data-block-uid="${newBlockUid}"]`);

    // Wait for the new block to be selected (visible with toolbar)
    await helper.waitForIframeBlockHandle(newBlockUid!);

    // Verify the new block is contenteditable
    const newEditor = await helper.getEditorLocator(newBlockUid!);
    const isContentEditable = await newEditor.getAttribute('contenteditable');
    expect(isContentEditable).toBe('true');

    // Type in the new block immediately WITHOUT clicking — Enter should leave it focused
    await newEditor.pressSequentially('Second line', { delay: 10 });
    await helper.waitForEditorText(newEditor, /Second line/);

    // Verify the new block contains 'Second line'
    const newBlockText = await newBlock.textContent();
    expect(newBlockText).toContain('Second line');

    // Verify the sidebar also shows the typed text
    const sidebarEditor = helper.getSidebarSlateEditor('value');
    await expect(sidebarEditor).toContainText('Second line', { timeout: 5000 });
  });

  test('Backspace at start of block joins with previous block', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // First, create two adjacent slate blocks by pressing Enter in block-1
    const editor1 = await helper.enterEditMode('block-1-uuid');
    await helper.selectAllTextInEditor(editor1);
    await editor1.pressSequentially('First block', { delay: 10 });
    await helper.waitForEditorText(editor1, /First block/);

    const initialBlocks = await helper.getStableBlockCount();

    // Press Enter to split — creates a new empty block right after block-1
    await editor1.press('Enter');
    await helper.waitForBlockCountToBe(initialBlocks + 1, 5000);

    // Get the new block (right after block-1)
    const blockOrder = await helper.getBlockOrder();
    const block1Idx = blockOrder.indexOf('block-1-uuid');
    const newBlockUid = blockOrder[block1Idx + 1];
    expect(newBlockUid).toBeTruthy();

    // Wait for new block to be selected and editable
    await helper.waitForIframeBlockHandle(newBlockUid!);
    const newEditor = await helper.getEditorLocator(newBlockUid!);
    await expect(newEditor).toBeVisible({ timeout: 5000 });
    await newEditor.pressSequentially('Second block', { delay: 10 });
    await helper.waitForEditorText(newEditor, /Second block/);

    const blocksBeforeMerge = await helper.getStableBlockCount();

    // Place cursor at the very start of the new block
    await newEditor.evaluate(el => {
      const sel = window.getSelection();
      const range = document.createRange();
      const firstText = el.querySelector('[data-node-id]') || el;
      const textNode = firstText.firstChild || firstText;
      range.setStart(textNode, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // Press Backspace — should merge new block's text into block-1
    await newEditor.press('Backspace');

    // Block count should decrease (new block merged into block-1)
    await helper.waitForBlockCountToBe(blocksBeforeMerge - 1, 10000);

    // The merged block should contain both texts
    const mergedEditor = await helper.getEditorLocator('block-1-uuid');
    await expect(mergedEditor).toContainText('First block', { timeout: 5000 });
    await expect(mergedEditor).toContainText('Second block', { timeout: 5000 });

    // No wait cursor should remain
    await helper.waitForPointerUnblocked();

    // Wait for merged content to appear in the DOM before typing
    await expect(mergedEditor).toContainText('First blockSecond block', { timeout: 5000 });

    // Cursor should be at the join point — typing should insert between the two texts
    await mergedEditor.pressSequentially(' JOINED ', { delay: 10 });
    await helper.waitForEditorText(mergedEditor, /First block JOINED Second block/);
  });

  test('Backspace at start of bullet list item demotes to paragraph', async ({ page }) => {
    // When cursor is at the start of a bullet list item and Backspace is
    // pressed, the list item should be "demoted" — unwrapped from the list
    // and split into a new paragraph block. This is standard Slate/Notion behavior.
    //
    // Known bug: Backspace at start of a list item does not demote it.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();
    const editor = await helper.enterEditMode('block-1-uuid');

    // Create a bullet list with two items using markdown "- " then Enter.
    await helper.selectAllTextInEditor(editor);
    await editor.press('Backspace');
    await page.waitForTimeout(200);
    await editor.pressSequentially('- First item', { delay: 50 });
    await page.waitForTimeout(500); // Let markdown handler fire

    // Verify bullet list was created
    const listItems = iframe.locator('[data-block-uid="block-1-uuid"] ul li, [data-block-uid="block-1-uuid"] ol li');
    await expect(listItems.first()).toBeVisible({ timeout: 5000 });
    await expect(listItems.first()).toContainText('First item');

    // Press Enter to create second bullet item, then type
    await editor.press('Enter');
    await page.waitForTimeout(300);
    await editor.pressSequentially('Second item', { delay: 10 });
    await expect(listItems).toHaveCount(2, { timeout: 5000 });

    // Place cursor at the very start of the SECOND list item
    await editor.evaluate((el: HTMLElement) => {
      const secondLi = el.querySelectorAll('li')[1];
      if (!secondLi) return;
      const sel = window.getSelection()!;
      const range = document.createRange();
      const walker = document.createTreeWalker(secondLi, NodeFilter.SHOW_TEXT);
      const firstText = walker.nextNode();
      if (firstText) {
        range.setStart(firstText, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });

    const blocksBeforeBackspace = await helper.getStableBlockCount();

    // Press Backspace at start of second bullet — should demote it to a
    // plain paragraph, splitting the block.
    await editor.press('Backspace');

    // Block count should increase (second bullet demoted to new paragraph block)
    await helper.waitForBlockCountToBe(blocksBeforeBackspace + 1, 10000);

    // Original block should still have the first bullet
    await expect(iframe.locator('[data-block-uid="block-1-uuid"]')).toContainText('First item', { timeout: 5000 });

    // Second item should be in a NEW block as a plain paragraph
    const newBlockOrder = await helper.getBlockOrder();
    const block1Idx = newBlockOrder.indexOf('block-1-uuid');
    const newBlockId = newBlockOrder[block1Idx + 1];
    expect(newBlockId).toBeTruthy();
    const newBlock = iframe.locator(`[data-block-uid="${newBlockId}"]`);
    await expect(newBlock).toContainText('Second item', { timeout: 5000 });
    await expect(newBlock.locator('li')).toHaveCount(0);

    // Press Backspace again at start of the new block — should merge back
    const newEditor = await helper.getEditorLocator(newBlockId!);
    await expect(newEditor).toBeVisible({ timeout: 5000 });
    await newEditor.evaluate((el: HTMLElement) => {
      const sel = window.getSelection()!;
      const range = document.createRange();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const firstText = walker.nextNode();
      if (firstText) {
        range.setStart(firstText, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
    await newEditor.press('Backspace');

    // Block count should decrease (merged back)
    await helper.waitForBlockCountToBe(blocksBeforeBackspace, 10000);
    await expect(iframe.locator('[data-block-uid="block-1-uuid"]')).toContainText('First item', { timeout: 5000 });
    await expect(iframe.locator('[data-block-uid="block-1-uuid"]')).toContainText('Second item', { timeout: 5000 });
  });

  test('Backspace at start of list item with inline element (link) demotes to paragraph', async ({ page }) => {
    // Uses complex-slate-page which has a ul block where each li starts with
    // an empty text node then a <a> link element. The cursor at the start of
    // the li may be inside the link's data-node-id element — the detection
    // must still recognize this as a block-level boundary.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/complex-slate-page');

    const iframe = helper.getIframe();

    // block-list-links has a ul with 4 li items, each containing a link
    const editor = await helper.enterEditMode('block-list-links');

    const listItems = iframe.locator('[data-block-uid="block-list-links"] li');
    await expect(listItems).toHaveCount(4, { timeout: 5000 });

    // Place cursor at the very start of the SECOND list item
    await editor.evaluate((el: HTMLElement) => {
      const secondLi = el.querySelectorAll('li')[1];
      if (!secondLi) return;
      const sel = window.getSelection()!;
      const range = document.createRange();
      const walker = document.createTreeWalker(secondLi, NodeFilter.SHOW_TEXT);
      const firstText = walker.nextNode();
      if (firstText) {
        range.setStart(firstText, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });

    const blocksBeforeBackspace = await helper.getStableBlockCount();

    // Press Backspace — should demote second li to a paragraph block.
    // The remaining li items (3rd, 4th) stay as a list in a third block.
    // Result: [ul with li[0]], [p from li[1]], [ul with li[2], li[3]]
    await editor.press('Backspace');

    // Block count increases by 2 (demoted paragraph + remaining list)
    await helper.waitForBlockCountToBe(blocksBeforeBackspace + 2, 10000);

    // Original block should still have the first li only
    const originalBlock = iframe.locator('[data-block-uid="block-list-links"]');
    await expect(originalBlock.locator('li')).toHaveCount(1, { timeout: 5000 });

    // First new block should be a paragraph (NOT a list item)
    const newBlockOrder = await helper.getBlockOrder();
    const blockIdx = newBlockOrder.indexOf('block-list-links');
    const demotedBlockId = newBlockOrder[blockIdx + 1];
    expect(demotedBlockId).toBeTruthy();
    const demotedBlock = iframe.locator(`[data-block-uid="${demotedBlockId}"]`);
    await expect(demotedBlock.locator('li')).toHaveCount(0);

    // Second new block should be a list with the remaining 2 items
    const remainingBlockId = newBlockOrder[blockIdx + 2];
    expect(remainingBlockId).toBeTruthy();
    const remainingBlock = iframe.locator(`[data-block-uid="${remainingBlockId}"]`);
    await expect(remainingBlock.locator('li')).toHaveCount(2, { timeout: 5000 });

    // Demoted block should be selected with cursor at offset 0
    await helper.waitForIframeBlockHandle(demotedBlockId!);
    const demotedEditor = await helper.getEditorLocator(demotedBlockId!);
    await expect(demotedEditor).toBeVisible({ timeout: 5000 });

    // Check cursor is focused in the demoted block at position 0
    await expect(async () => {
      const info = await helper.getCursorInfo(demotedEditor);
      expect(info.isFocused).toBe(true);
      expect(info.cursorOffset).toBe(0);
    }).toPass({ timeout: 5000 });

    // Backspace at start of demoted block — should merge back into the list
    await demotedEditor.press('Backspace');

    // Demoted p merged into last li of list above (text combined),
    // then adjacent list merged in. Back to single list block.
    await helper.waitForBlockCountToBe(blocksBeforeBackspace, 10000);

    // 1 combined li (item 1+2 text) + 2 li from remaining list = 3 total
    await expect(originalBlock.locator('li')).toHaveCount(3, { timeout: 5000 });

    // First li should contain text from both items (joined into one li)
    const firstLi = originalBlock.locator('li').first();
    await expect(firstLi).toContainText('NUXT', { timeout: 5000 });
    await expect(firstLi).toContainText('Framework7', { timeout: 5000 });
    // Remaining items should still be there
    await expect(originalBlock).toContainText('Next.js', { timeout: 5000 });

    // Cursor should be at the join point inside the first li
    // (between NUXT link and Framework7 link). Typing should insert there.
    const editorAfterMerge = await helper.getEditorLocator('block-list-links');
    await expect(editorAfterMerge).toBeVisible({ timeout: 5000 });
    await editorAfterMerge.pressSequentially('CURSOR', { delay: 10 });
    await expect(firstLi).toContainText('NUXT', { timeout: 5000 });
    await expect(firstLi).toContainText('CURSOR', { timeout: 5000 });
    await expect(firstLi).toContainText('Framework7', { timeout: 5000 });

    // Verify stability: after 1s, block count and structure must not change.
    // Reproduces bug where an empty P block appears ~1s after merge.
    await expect(async () => {
      const count = await helper.getBlockCount();
      expect(count).toBe(blocksBeforeBackspace);
    }).toPass({ timeout: 2000, intervals: [500, 500, 500] });

    // No empty blocks should have been inserted before the list
    const blockOrder = await helper.getBlockOrder();
    const listIdx = blockOrder.indexOf('block-list-links');
    expect(listIdx).toBe(0); // list should still be the first block

    // Verify cursor remains at the merge point after delayed re-renders.
    // Reproduces bug where cursor resets ~1s after merge.
    await page.waitForTimeout(2000);
    await helper.waitForCursorPosition(editorAfterMerge, 'NUXT.js ExampleCURSOR');
  });

  test('Backspace at start of list item in sidebar Slate widget demotes to paragraph', async ({ page }) => {
    // Same behavior as iframe test but via the sidebar Slate editor widget.
    // Tests that the deleteBackward extension works in the sidebar path too.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Select a slate block and use the sidebar Slate editor
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');

    const sidebarEditor = helper.getSidebarSlateEditor('value');
    await expect(sidebarEditor).toBeVisible({ timeout: 5000 });

    // Clear and type a bullet list using markdown "- "
    await sidebarEditor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    await page.keyboard.type('- First item', { delay: 50 });
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Second item', { delay: 10 });

    // Wait for two list items in the sidebar widget
    await expect(sidebarEditor.locator('li')).toHaveCount(2, { timeout: 5000 });

    // Place cursor at start of second li
    await sidebarEditor.evaluate((el: HTMLElement) => {
      const allLi = el.querySelectorAll('li');
      const secondLi = allLi[1];
      if (!secondLi) return;
      const sel = window.getSelection();
      const range = document.createRange();
      const textNode = secondLi.firstChild?.firstChild || secondLi.firstChild;
      if (textNode) {
        range.setStart(textNode, 0);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    });

    const blocksBeforeBackspace = await helper.getStableBlockCount();

    // Press Backspace — should demote second item and split the block
    await page.keyboard.press('Backspace');

    // Block count should increase (second item becomes a new block)
    await helper.waitForBlockCountToBe(blocksBeforeBackspace + 1, 10000);

    // Original block should still have the first bullet
    const iframe = helper.getIframe();
    await expect(iframe.locator('[data-block-uid="block-1-uuid"]')).toContainText('First item', { timeout: 5000 });

    // Second item should be in a NEW block as a plain paragraph
    const newBlockOrder = await helper.getBlockOrder();
    const block1Idx = newBlockOrder.indexOf('block-1-uuid');
    const newBlockId = newBlockOrder[block1Idx + 1];
    expect(newBlockId).toBeTruthy();
    const newBlock = iframe.locator(`[data-block-uid="${newBlockId}"]`);
    await expect(newBlock).toContainText('Second item', { timeout: 5000 });
    await expect(newBlock.locator('li')).toHaveCount(0);

    // The new block should be selected
    await helper.waitForIframeBlockHandle(newBlockId!);
  });

  test('editing text in Admin UI updates iframe', async ({ page }, testInfo) => {
    const RUN = `[RUN-${testInfo.repeatEachIndex}]`;
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Inject run ID into admin page (View.jsx) and iframe (hydra.js, renderer)
    await page.evaluate((id) => {
      (window as any).__testRunId = id;
    }, testInfo.repeatEachIndex);
    const iframe = helper.getIframe();
    await iframe.locator('body').evaluate((_, id) => {
      (window as any).__testRunId = id;
    }, testInfo.repeatEachIndex);

    const blockId = 'block-1-uuid';

    // Click block in iframe to select it and show sidebar
    await helper.clickBlockInIframe(blockId);
    await helper.waitForSidebarOpen();

    // Edit text in the sidebar Slate editor (field name is 'value' for slate blocks)
    const newText = 'Make this bold';
    await helper.setSidebarFieldValue('value', newText);

    // Verify the iframe updated with the new text (wait for sync)
    await expect(async () => {
      const iframeText = await helper.getBlockTextInIframe(blockId);
      console.log(`${RUN} iframeText:`, JSON.stringify(iframeText));
      expect(iframeText).toContain(newText);
    }).toPass({ timeout: 5000 });

    // Select all text in the sidebar editor and apply bold formatting
    const sidebarEditor = helper.getSidebarSlateEditor('value');

    // Wait for sidebar editor to have the correct content (sync might cause re-render)
    await expect(sidebarEditor).toHaveText(newText, { timeout: 5000 });

    await sidebarEditor.click();
    await sidebarEditor.press('ControlOrMeta+a'); // Select all

    // Verify text is selected
    await expect(async () => {
      const selectedText = await sidebarEditor.evaluate(() => window.getSelection()?.toString());
      expect(selectedText).toBe(newText);
    }).toPass({ timeout: 5000 });

    // Wait for the sidebar's floating toolbar to appear and click bold
    const sidebarToolbar = await helper.waitForSidebarSlateToolbar();
    const sidebarBoldButton = await helper.getSidebarToolbarButton(sidebarToolbar, 'bold');
    await sidebarBoldButton.click();

    // Verify the iframe shows bold formatting (all text should be bold)
    const editor = await helper.enterEditMode(blockId);
    await helper.waitForFormattedText(editor, newText, 'bold', { timeout: 10000 });

    // Click on the block in the iframe to verify selection still works after editing
    await helper.clickBlockInIframe(blockId);
  });

  test('editing text in sidebar appears in iframe', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Click the block to select it and open sidebar
    await helper.clickBlockInIframe(blockId);
    await helper.waitForSidebarOpen();

    // Make sure the Block tab is open (where the value field is)
    await helper.openSidebarTab('Block');

    // Get original text from iframe
    const iframe = helper.getIframe();
    const iframeBlock = iframe.locator(`[data-block-uid="${blockId}"]`);
    const originalText = await iframeBlock.textContent();

    // Edit the value field in the sidebar (Volto Hydra feature)
    // Use the same selector as the passing test in sidebar-forms.spec.ts
    const valueField = helper.getSidebarSlateEditor('value');
    await valueField.click();
    await valueField.fill('Edited from sidebar');

    // Verify the text updated in the iframe
    await expect(iframeBlock).toContainText('Edited from sidebar', { timeout: 5000 });
  });

  // BUG: Selecting in iframe, then applying format from sidebar causes path error
  // when clicking back to iframe
  test('applying format from sidebar after iframe selection works', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Step 1: Enter edit mode in iframe and type some text (select all to replace)
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Make this bold', { delay: 10 });
    await helper.waitForEditorText(editor, /Make this bold/);
    console.log('[TEST] Typed text in iframe');

    // Step 2: Select all text in the iframe
    await helper.selectAllTextInEditor(editor);

    // Verify selection
    const selectedText = await editor.evaluate(() => window.getSelection()?.toString());
    console.log('[TEST] Selected text in iframe:', selectedText);
    expect(selectedText).toBe('Make this bold');

    // Step 3: Click on sidebar to make a selection there and apply bold
    // The sidebar editor should have synced the content
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    const sidebarEditor = helper.getSidebarSlateEditor('value');

    // Wait for sidebar to sync content from iframe before applying formatting
    await expect(sidebarEditor).toHaveText('Make this bold', { timeout: 5000 });

    await sidebarEditor.click();
    await sidebarEditor.press('ControlOrMeta+a'); // Select all in sidebar
    console.log('[TEST] Applying bold via Ctrl+B in sidebar');
    await sidebarEditor.press('ControlOrMeta+b'); // Apply bold via keyboard shortcut

    // Wait for bold formatting to appear in iframe
    await helper.waitForFormattedText(editor, /Make this bold/, 'bold');
    console.log('[TEST] Bold applied successfully');

    // Step 4: Now remove bold from sidebar - select all again and toggle bold off
    await sidebarEditor.click();
    await sidebarEditor.press('ControlOrMeta+a'); // Select all in sidebar
    console.log('[TEST] Removing bold via Ctrl+B in sidebar');
    await sidebarEditor.press('ControlOrMeta+b'); // Remove bold via keyboard shortcut

    // Wait for bold formatting to be removed from iframe
    await helper.waitForFormattingRemoved(editor, 'bold');
    console.log('[TEST] Bold removed successfully');

    // Step 5: Click back on the iframe editor - this is where the path error may occur
    console.log('[TEST] Clicking back to iframe editor');
    await editor.click();

    // If we get here without error, the bug is fixed
    // Verify text is still there
    const blockHtml = await editor.innerHTML();
    expect(blockHtml).toContain('Make this bold');

    console.log('[TEST] Format toggle from sidebar and click back to iframe successful');
  });

  test('inline editing in multiple blocks works independently', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Edit first block
    await helper.editBlockTextInIframe('block-1-uuid', 'First block edited');

    // Edit third block (also Slate)
    await helper.editBlockTextInIframe('block-3-uuid', 'Third block edited');

    // Verify both edits persisted
    const firstText = await helper.getBlockTextInIframe('block-1-uuid');
    const thirdText = await helper.getBlockTextInIframe('block-3-uuid');

    expect(firstText).toContain('First block edited');
    expect(thirdText).toContain('Third block edited');
  });

  test('click and drag selects text range', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and set up text
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Hello beautiful world', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello beautiful world/);

    // Get the bounding box to calculate drag positions
    const box = await editor.boundingBox();
    if (!box) throw new Error('Could not get editor bounding box');

    // Click at the start of the editor and drag to select "Hello"
    // Start from left edge + small offset, drag to approximately after "Hello"
    const startX = box.x + 5;
    const startY = box.y + box.height / 2;
    // "Hello" is 5 characters, estimate ~8px per character
    const endX = box.x + 45;
    const endY = startY;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();

    // Wait for selection to stabilize
    // Verify some text is selected (exact text depends on font metrics)
    await expect(async () => {
      const selectionInfo = await helper.getSelectionInfo(editor);
      expect(selectionInfo.isCollapsed).toBe(false);
    }).toPass({ timeout: 2000 });

    // The selected text should start with "Hello" or be a subset
    const selectedText = await editor.evaluate(() => {
      return window.getSelection()?.toString() || '';
    });
    expect(selectedText.length).toBeGreaterThan(0);
    console.log('[TEST] Click and drag selected:', selectedText);
  });

  test('double click selects a word', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and set up text
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Hello beautiful world', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello beautiful world/);

    // Double click on "beautiful" to select it
    const box = await editor.boundingBox();
    if (!box) throw new Error('Could not get editor bounding box');

    // "Hello " is 6 chars, "beautiful" starts at char 6
    // Estimate ~8px per character, click in the middle of "beautiful" (around char 10)
    const clickX = box.x + 10 * 8;
    const clickY = box.y + box.height / 2;

    await page.mouse.dblclick(clickX, clickY);

    // Verify "beautiful" is selected
    await expect(async () => {
      const selectedText = await editor.evaluate(() => {
        return window.getSelection()?.toString() || '';
      });
      expect(selectedText).toBe('beautiful');
    }).toPass({ timeout: 2000 });
  });

  test('triple click selects entire paragraph', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and set up text
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Hello beautiful world', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello beautiful world/);

    // Triple click to select entire paragraph
    await editor.click({ clickCount: 3 });

    // Verify entire text is selected
    await expect(async () => {
      const selectedText = await editor.evaluate(() => {
        return window.getSelection()?.toString() || '';
      });
      expect(selectedText).toBe('Hello beautiful world');
    }).toPass({ timeout: 2000 });
  });

  // Home key is handled via selection.modify('move','backward','lineboundary')
  // in hydra.js keydown handler since CDP-dispatched events don't trigger native cursor movement.
  test('keyboard navigation with Home key', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const editor = await helper.enterEditMode(blockId);

    // Clear and type text
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Hello World', { delay: 10 });

    // Verify cursor at end
    const cursorAfterTyping = await helper.getCursorInfo(editor);
    expect(cursorAfterTyping.cursorOffset).toBe(11);

    // ArrowLeft works
    await editor.press('ArrowLeft');
    const cursorAfterArrowLeft = await helper.getCursorInfo(editor);
    expect(cursorAfterArrowLeft.cursorOffset).toBe(10);

    // End works
    await editor.press('End');
    const cursorAfterEnd = await helper.getCursorInfo(editor);
    expect(cursorAfterEnd.cursorOffset).toBe(11);

    // Home does NOT work with hydra.js (cursor stays at 11)
    // But it DOES work in plain iframe contenteditables without hydra.js
    await editor.press('Home');
    const cursorAfterHome = await helper.getCursorInfo(editor);
    expect(cursorAfterHome.cursorOffset).toBe(0); // This fails - cursor stays at 11
  });

  test('selection remains after bolding and unbolding a word', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode
    const editor = await helper.enterEditMode(blockId);

    // Wait for toolbar
    await helper.waitForBlockSelectedInAdmin(blockId);

    // Clear and type text
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('This is a test', { delay: 10 });

    // Wait for text to appear
    await helper.waitForEditorText(editor, /This is a test/);

    // Select the word "test" (last 4 characters)
    // Use helper instead of page.keyboard.press('End') to avoid scrolling the window
    await helper.moveCursorToEnd(editor);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Shift+ArrowLeft');
    }

    // Verify "test" is selected before formatting
    await helper.verifySelectionMatches(editor, 'test');
    console.log('[TEST] Selection verified before bold: "test"');

    // Click Bold button to apply bold formatting
    await helper.clickFormatButton('bold');

    // Wait for bold markup to appear
    await helper.waitForFormattedText(editor, 'test', 'bold');

    // Verify "test" is still selected after applying bold
    await helper.verifySelectionMatches(editor, 'test');
    console.log('[TEST] Selection still "test" after applying bold');

    // Verify bold markup exists
    const boldSelector = helper.getFormatSelector('bold');
    await expect(editor.locator(boldSelector)).toBeVisible();
    expect(await editor.textContent()).toContain('test');

    // Click Bold button again to remove bold formatting
    await helper.clickFormatButton('bold');

    // Wait for bold markup to be removed
    await helper.waitForFormattingRemoved(editor, 'bold');

    // Verify "test" is still selected after removing bold
    await helper.verifySelectionMatches(editor, 'test');
    console.log('[TEST] Selection still "test" after removing bold');

    // Verify bold markup is gone
    await expect(editor.locator(boldSelector)).not.toBeVisible();
    expect(await editor.textContent()).toContain('test');
  });

  test('empty editable field is visible and clickable', async ({ page }) => {
    // Empty editable fields should have minimum height so they're visible and clickable.
    // This tests the CSS rule that hydra.js injects for [data-edit-text]:empty
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const iframe = helper.getIframe();

    // Enter edit mode and clear all content to make the block empty
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.press('Backspace');
    await helper.waitForEditorText(editor, /^$/);

    // Click on a different block to deselect the empty block
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.waitForIframeBlockHandle('block-2-uuid');

    // Get the editable field locator - handles both Nuxt (attr on root) and mock (attr on child)
    const editableField = iframe.locator(`[data-block-uid="${blockId}"] [data-edit-text="value"]`).or(
      iframe.locator(`[data-block-uid="${blockId}"][data-edit-text="value"]`)
    );

    // The empty field should still be visible (have height > 0) even when not selected
    await expect(editableField).toBeVisible();

    // Verify it has meaningful height (at least 1em ~ 16px typically)
    const height = await editableField.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.height;
    });
    expect(height).toBeGreaterThan(10); // Should have at least 10px height when empty

    // Click on the empty block to select it - this should work because it has height
    await helper.clickBlockInIframe(blockId);

    // Verify the empty block is now selected
    await helper.waitForIframeBlockHandle(blockId);
  });

  test('deleting across node boundaries (bold to normal text)', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    // text-after block has: "This text appears..." + <bold>bold text</bold> + " to test getNodePath."
    const blockId = 'text-after';
    await helper.clickBlockInIframe(blockId);

    const editor = await helper.getEditorLocator(blockId);

    // Select across the boundary: from "ld" in "bold" to "to" in " to test"
    // "This text appears after the slider. Click on " (46 chars) + "bold" = starts at 46
    // We want to select "ld text to" which spans bold -> normal text
    // Adjust positions based on actual text offsets
    await helper.selectTextRange(editor, 47, 57);

    // Verify the selection spans the boundary
    const selectionInfo = await helper.assertTextSelection(editor, 'ld text to');
    console.log('[TEST] Cross-boundary selection:', selectionInfo.selectedText);

    // Press Delete to remove the selected text
    await page.keyboard.press('Delete');

    // Wait for deletion to complete
    await expect.poll(async () => {
      const text = await helper.getCleanTextContent(editor);
      return !text.includes('ld text to');
    }, { timeout: 5000 }).toBe(true);

    // Verify the result - should have "bo" + " test getNodePath."
    const finalText = await helper.getCleanTextContent(editor);
    console.log('[TEST] Text after delete:', finalText);
    expect(finalText).toContain('bo');
    expect(finalText).toContain('test getNodePath');
    expect(finalText).not.toContain('ld text to');

    // Verify cursor is collapsed at deletion point
    const cursorInfo = await helper.getCursorInfo(editor);
    expect(cursorInfo.isFocused).toBe(true);
    expect(cursorInfo.selectionCollapsed).toBe(true);
  });

  test('can select a newly added slate block via add button', async ({ page }) => {
    // This test verifies that a new slate block added via the add button
    // can be properly selected and focused for editing.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Get initial block count
    const initialCount = await helper.getBlockCount();

    // Select a block and click Add
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();
    await helper.clickAddBlockButton();

    // Select Slate block type
    await helper.selectBlockType('slate');

    // Wait for block to be added
    await helper.waitForBlockCountToBe(initialCount + 1);

    // Get the new block's UID
    const blockOrder = await helper.getBlockOrder();
    const originalBlockIndex = blockOrder.indexOf('block-1-uuid');
    const newBlockUid = blockOrder[originalBlockIndex + 1];
    expect(newBlockUid).toBeTruthy();

    // Click the new block to select it
    await helper.clickBlockInIframe(newBlockUid!);

    // Verify the new block is selected
    await helper.waitForIframeBlockHandle(newBlockUid!);

    // Verify the editor is focusable and has correct cursor placement
    const newEditor = await helper.getEditorLocator(newBlockUid!);
    const isContentEditable = await newEditor.getAttribute('contenteditable');
    expect(isContentEditable).toBe('true');

    // Verify cursor is inside the block (should be inside data-node-id element)
    const cursorInfo = await helper.getCursorInfo(newEditor);
    expect(cursorInfo.isFocused).toBe(true);

    // Debug: check if data-node-id exists in DOM
    const hasNodeId = await newEditor.evaluate((el: HTMLElement) => {
      const nodeIdEl = el.querySelector('[data-node-id]');
      const elHasNodeId = el.hasAttribute('data-node-id');
      return {
        hasNodeIdElement: !!nodeIdEl,
        innerHTML: el.innerHTML,
        outerHTML: el.outerHTML,
        elTagName: el.tagName,
        elHasNodeId,
        elNodeIdValue: el.getAttribute('data-node-id'),
        nodeIdValue: nodeIdEl?.getAttribute('data-node-id'),
      };
    });
    console.log('[TEST] DOM check:', hasNodeId);

    expect(cursorInfo.insideNodeId).toBe(true);
  });

  test('typing in newly added slate block syncs to sidebar', async ({ page }) => {
    // This test verifies that typing in a new slate block (added via add button)
    // properly syncs the content to the sidebar editor.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Get initial block count
    const initialCount = await helper.getBlockCount();

    // Select a block and click Add
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();
    await helper.clickAddBlockButton();

    // Select Slate block type
    await helper.selectBlockType('slate');

    // Wait for block to be added
    await helper.waitForBlockCountToBe(initialCount + 1);

    // Get the new block's UID
    const blockOrder = await helper.getBlockOrder();
    const originalBlockIndex = blockOrder.indexOf('block-1-uuid');
    const newBlockUid = blockOrder[originalBlockIndex + 1];
    expect(newBlockUid).toBeTruthy();

    // Click the new block to select it
    await helper.clickBlockInIframe(newBlockUid!);
    await helper.waitForIframeBlockHandle(newBlockUid!);

    // Get the editor and type some text
    const newEditor = await helper.getEditorLocator(newBlockUid!);
    await newEditor.click();
    await newEditor.pressSequentially('Hello World', { delay: 10 });

    // Wait for text to appear in iframe
    const newBlock = iframe.locator(`[data-block-uid="${newBlockUid}"]`);
    await expect(newBlock).toContainText('Hello World', { timeout: 5000 });

    // Verify the sidebar also shows the typed text
    const sidebarEditor = helper.getSidebarSlateEditor('value');
    await expect(sidebarEditor).toContainText('Hello World', { timeout: 5000 });
  });
});
