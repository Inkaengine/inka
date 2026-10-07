/**
 * Text formatting tests for inline editing in Volto Hydra admin UI.
 *
 * TODO - additional tests and bugs:
 * - backspace into bold text (click off or apply another format it will go funny)
 * - ctrl-b and other native formatting shortcuts are ignored
 * - if we aren't focused on a field then the format buttons should be disabled
 * - click bold button without selection and then type - should be bolded
 * - heading shortcuts (## for h2, ### for h3)
 * - bullet list shortcuts (- or * for ul, 1. for ol)
 * - multiple formats on same text (bold + italic, etc)
 * - paragraph formats as dropdown?
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Inline Editing - Formatting', () => {
  test('can make text bold', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Edit the text (also clicks block, waits for toolbar, and types)
    await helper.editBlockTextInIframe(blockId, 'Text to make bold');

    // STEP 1: Verify the text content is correct
    const editor = await helper.getEditorLocator(blockId);
    const textContent = await helper.getCleanTextContent(editor);
    expect(textContent).toBe('Text to make bold');
    console.log('[TEST] Step 1: Text content verified:', textContent);

    // STEP 2: Select all the text programmatically
    await helper.selectAllTextInEditor(editor);

    // STEP 3: Verify selection was created correctly
    await helper.assertTextSelection(editor, 'Text to make bold', {
      shouldExist: true,
      shouldBeCollapsed: false,
      message: 'Step 3: After creating selection'
    });

    // STEP 4: Verify selection still exists just before clicking button
    await helper.assertTextSelection(editor, 'Text to make bold', {
      shouldExist: true,
      shouldBeCollapsed: false,
      message: 'Step 4: Before clicking bold button'
    });

    // STEP 5: Wait for toolbar to be fully ready and stable
    await helper.waitForBlockSelectedInAdmin(blockId);

    // STEP 6: Trigger the bold button using dispatchEvent
    console.log('[TEST] Step 6: Clicking bold button...');
    await helper.clickFormatButton('bold');

    // STEP 7: Wait for bold formatting AND text content to be stable (polls until both conditions met)
    await helper.waitForFormattedText(editor, /Text to make bold/, 'bold');

    // STEP 8: Wait for selection to be restored (polls - selection restoration is async)
    await helper.verifySelectionMatches(editor, 'Text to make bold');

    // STEP 9: Verify the text is bold
    const boldSelector = helper.getFormatSelector('bold');
    await expect(editor.locator(boldSelector)).toBeVisible();
    expect(await editor.textContent()).toContain('Text to make bold');

    // STEP 10: Verify no processing state remains after formatting (pointer-events unblocked)
    await helper.waitForPointerUnblocked();
  });

  test('bold formatting syncs with Admin UI', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode, select all existing text and replace it
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Synced bold text', { delay: 10 });
    await helper.waitForEditorText(editor, /Synced bold text/);

    // Select all text in the editor using JavaScript Selection API
    await helper.selectAllTextInEditor(editor);
    await helper.clickFormatButton('bold');

    // Wait for bold formatting to sync from Admin UI to iframe
    const boldSelector = helper.getFormatSelector('bold');
    await expect(editor.locator(boldSelector)).toBeVisible({ timeout: 10000 });

    // Wait for the bold formatting to visually appear in the sidebar's React Slate editor
    // The sidebar Slate editor renders bold text with <strong> tags
    const sidebarSlateEditor = helper.getSidebarSlateEditor('value');
    await expect(sidebarSlateEditor.locator('strong')).toContainText('Synced bold text', { timeout: 5000 });
  });

  test('multiple formats can be applied simultaneously', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and edit text (select all to replace existing content)
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Bold and italic text', { delay: 10 });

    // Select all text again for formatting
    await helper.selectAllTextInEditor(editor);

    // Assert selection exists and covers all text
    await helper.assertTextSelection(editor, 'Bold and italic text', {
      shouldExist: true,
      shouldBeCollapsed: false,
      message: 'After selecting all, selection should exist and cover all text',
    });

    // Apply bold and wait for it to appear with text content
    await helper.clickFormatButton('bold');
    await helper.waitForFormattedText(editor, /Bold and italic text/, 'bold');

    // Apply italic (text should still be selected) and wait for it to appear
    await helper.clickFormatButton('italic');
    await helper.waitForFormattedText(editor, /Bold and italic text/, 'italic');

    // Verify both formats are applied
    const boldSelector = helper.getFormatSelector('bold');
    const italicSelector = helper.getFormatSelector('italic');
    await expect(editor.locator(boldSelector)).toBeVisible();
    await expect(editor.locator(italicSelector)).toBeVisible();
    expect(await editor.textContent()).toContain('Bold and italic text');
  });

  test('format button shows active state for formatted text', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and edit text (select all to replace existing content)
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Text with bold', { delay: 10 });
    await helper.waitForEditorText(editor, /Text with bold/);

    // Select all text again for formatting
    await helper.selectAllTextInEditor(editor);
    await helper.clickFormatButton('bold');
    const boldSelector = helper.getFormatSelector('bold');
    await expect(editor.locator(boldSelector)).toBeVisible();

    // Verify selection is still on the formatted text
    await helper.verifySelectionMatches(editor, 'Text with bold');

    // Check if the bold button shows active state
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(true);
    }).toPass({ timeout: 5000 });

  });

  test('clicking format button again removes format', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and edit text (select all to replace existing content)
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Toggle bold text', { delay: 10 });
    await helper.waitForEditorText(editor, /Toggle bold text/);

    // Select all text again for formatting
    await helper.selectAllTextInEditor(editor);
    await helper.clickFormatButton('bold');
    const boldSelector = helper.getFormatSelector('bold');
    await expect(editor.locator(boldSelector)).toBeVisible();

    // Click bold button again to remove formatting
    // Selection should be restored after the bold transform — wait for it
    await helper.verifySelectionMatches(editor, 'Toggle bold text');
    await helper.clickFormatButton('bold');
    await expect(editor.locator(boldSelector)).not.toBeVisible();

    // Verify text is still there
    expect(await editor.textContent()).toContain('Toggle bold text');
  });

  test('format persists after typing', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and type text (select all to replace existing content)
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Bold text', { delay: 10 });
    await helper.waitForEditorText(editor, /Bold text/);

    // Select all again and make it bold, wait for formatting AND content to be stable
    await helper.selectAllTextInEditor(editor);
    await helper.clickFormatButton('bold');
    await helper.waitForFormattedText(editor, /Bold text/, 'bold');

    // Move cursor to end (editor is already focused from format operation)
    await helper.moveCursorToEnd(editor);

    // Type more text at the end (use pressSequentially for reliable typing)
    await editor.pressSequentially(' more', { delay: 10 });
    await helper.waitForEditorText(editor, /Bold text more/);

    // Check if new text inherits bold formatting
    const boldSelector = helper.getFormatSelector('bold');
    await expect(editor.locator(boldSelector)).toBeVisible();
    const text = await helper.getCleanTextContent(editor);
    expect(text).toContain('Bold text more');
  });

  test('Ctrl+B hotkey applies bold formatting', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode - block has "This is a test paragraph"
    const editor = await helper.enterEditMode(blockId);

    // Select the word "test" (characters 10-14)
    // "This is a test paragraph"
    //  0123456789...
    await helper.selectTextRange(editor, 10, 14);

    // Wait for toolbar to be visible with bold button (ensures selection is synced)
    const boldButton = helper.page.locator('.quanta-toolbar [title*="Bold" i]');
    await expect(boldButton).toBeVisible({ timeout: 5000 });

    // Ensure editor is focused and selection is correct before hotkey
    await expect(async () => {
      await expect(editor).toBeFocused();
      const sel = await helper.getSelectionInfo(editor);
      expect(sel.editorHasFocus).toBe(true);
      expect(sel.isCollapsed).toBe(false); // Should have text selected
    }).toPass({ timeout: 5000 });

    // Press Cmd+B (Mac) to bold the selection
    await editor.press('ControlOrMeta+b');

    // Verify "test" is now bold in the HTML
    await helper.waitForFormattedText(editor, /test/, 'bold', { timeout: 10000 });

    // Selection must be restored within 500ms of formatting appearing
    await expect(async () => {
      const sel = await editor.evaluate((el: any) =>
        el.ownerDocument.defaultView.getSelection()?.toString() || '');
      expect(sel).toBe('test');
    }).toPass({ timeout: 500 });
  });

  test('should handle bolding same text twice without path error', async ({ page }) => {
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
    await editor.pressSequentially('Text with bold', { delay: 10 });
    await helper.waitForEditorText(editor, /Text with bold/);

    // Select the word "bold" (last 4 characters)
    // Use helper instead of page.keyboard.press('End') to avoid scrolling the window
    await helper.moveCursorToEnd(editor);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Shift+ArrowLeft');
    }

    console.log('[TEST] About to click Bold button first time');

    // Click Bold button FIRST TIME using helper
    await helper.clickFormatButton('bold');
    await helper.waitForFormattedText(editor, /bold/, 'bold');

    console.log('[TEST] First bold click done');

    // Verify bold markup exists using DOM assertion
    const boldSelector = helper.getFormatSelector('bold');
    const boldSpan = editor.locator(boldSelector);
    await expect(boldSpan).toBeVisible();
    await expect(boldSpan).toHaveText('bold');

    // The selection should still be on "bold" after the first bold operation
    // (no need to re-select - the selection is preserved through the format operation)
    console.log('[TEST] About to click Bold button second time');

    // Click Bold button SECOND TIME
    // This should NOT throw an error about path [0,0,0] not found
    await helper.clickFormatButton('bold');

    // Verify bold markup is gone using DOM assertion
    await expect(boldSpan).not.toBeVisible();

    console.log('[TEST] Second bold click done - should have unbolded without error');

    // Verify the word "bold" is still selected (poll until selection restoration completes)
    await expect(async () => {
      const selectedText = await editor.evaluate(() => window.getSelection()?.toString());
      expect(selectedText).toBe('bold');
    }).toPass({ timeout: 5000 });

    // Verify contenteditable is still enabled (not blocked from format operation)
    const isEditable = await editor.evaluate((el) => el.contentEditable === 'true');
    expect(isEditable).toBe(true);

    // Verify we can still type (editor is not blocked)
    // First collapse selection to end so we don't replace the selected text
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('!');
    await expect(editor).toContainText('bold!');
  });

  test('prospective formatting: Ctrl+B then type applies bold to new text', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and clear the block
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);

    // Type "Hello " (not bold)
    await editor.pressSequentially('Hello ', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello/);

    // Press Cmd+B to enable bold mode for subsequent text
    await editor.press('ControlOrMeta+b');

    // Wait for bold button to become active (indicates bold mode is on)
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(true);
    }).toPass({ timeout: 5000 });

    // Wait for editor focus before typing (hotkey processing may temporarily shift focus).
    // The CI flake once noted here (text typed after the hotkey landing outside the bold)
    // was the bridge proceeding before the frontend drew the new node — fixed in #441;
    // the "renders slowly" test below covers it.
    await helper.waitForEditorFocus(editor);

    // Type "world" - this should be bold
    await editor.pressSequentially('world', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello world/);

    // Wait for the bold formatting to appear
    await helper.waitForFormattedText(editor, /world/, 'bold');

    // Verify the HTML structure (waitForFormattedText already verified bold contains "world")
    const html = await editor.innerHTML();
    console.log('[TEST] Final HTML:', html);
  });

  // A frontend may take longer than a moment to draw what the admin sent. The
  // bridge used to wait ~1s (60 frames) for the new empty bold node, then
  // "proceed anyway": the node wasn't drawn yet, so the caret couldn't go in
  // it, fell back to where it was before, and the typed text landed outside
  // the bold. That is the CI flake on the tests around this one (a busy runner
  // renders slowly). Here the test frontend is made slow on purpose.
  test('prospective formatting: Ctrl+B then type applies bold when the frontend renders slowly', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const editor = await helper.enterEditMode('block-1-uuid');
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Hello ', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello/);

    // Every re-render from here on takes 1.5s before it draws.
    await editor.evaluate(() => {
      const draw = (window as any).renderContent;
      (window as any).renderContent = async (...args: unknown[]) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return draw(...args);
      };
    });

    await editor.press('ControlOrMeta+b');
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(true);
    }).toPass({ timeout: 5000 });
    await helper.waitForEditorFocus(editor);

    await editor.pressSequentially('world', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello world/, { timeout: 10000 });
    await helper.waitForFormattedText(editor, /world/, 'bold');
  });

  // The same slow frontend, on the toggle-on-then-off path (the CI flake on
  // "toggle on then off without typing"): with the caret left outside the new
  // empty bold node, the second Ctrl+B didn't turn bold off.
  test('prospective formatting: toggle on then off works when the frontend renders slowly', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const editor = await helper.enterEditMode('block-1-uuid');
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Hello world', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello world/);
    await helper.moveCursorToEnd(editor);

    await editor.evaluate(() => {
      const draw = (window as any).renderContent;
      (window as any).renderContent = async (...args: unknown[]) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return draw(...args);
      };
    });

    await editor.press('ControlOrMeta+b');
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(true);
    }).toPass({ timeout: 5000 });
    await editor.press('ControlOrMeta+b');
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(false);
    }).toPass({ timeout: 10000 });
    expect(await helper.getCleanTextContent(editor)).toBe('Hello world');
  });

  test('prospective formatting: toolbar button click then type applies bold to new text', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and clear the block
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);

    // Type "Hello " (not bold)
    await editor.pressSequentially('Hello ', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello/);

    // Click bold button to enable bold mode for subsequent text
    await helper.clickFormatButton('bold');

    // Wait for bold button to become active (indicates bold mode is on)
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(true);
    }).toPass({ timeout: 5000 });
    await helper.waitForEditorFocus(editor);
    // Wait for cursor to be at correct position (after "Hello ")
    await helper.waitForCursorPosition(editor, 'Hello ');

    // Type "world" - this should be bold
    await editor.pressSequentially('world', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello world/);

    // Wait for the bold formatting to appear
    await helper.waitForFormattedText(editor, /world/, 'bold');

    // Verify the HTML structure
    const html = await editor.innerHTML();
    console.log('[TEST] Final HTML:', html);

    // Verify "Hello " is NOT bold - only "world" should be bold (prospective formatting)
    const boldSelector = helper.getFormatSelector('bold');
    const boldContent = await editor.locator(boldSelector).textContent();
    const cleanBoldContent = boldContent?.replace(/[\uFEFF\u200B]/g, '').trim();
    console.log('[TEST] Bold content:', cleanBoldContent);
    expect(cleanBoldContent).toBe('world');
  });

  test('prospective formatting: toggle bold off after typing bold text', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and clear the block
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);

    // Type "Hello " (not bold)
    await editor.pressSequentially('Hello ', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello/);

    // Press Cmd+B to enable bold mode
    console.log('[TEST] First ControlOrMeta+b - enabling bold');
    await editor.press('ControlOrMeta+b');

    // Wait for bold button to become active
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(true);
    }).toPass({ timeout: 5000 });
    await helper.waitForEditorFocus(editor);
    // Wait for cursor to be at correct position (after "Hello ")
    await helper.waitForCursorPosition(editor, 'Hello ');

    // Type "world" - this should be bold
    await editor.pressSequentially('world', { delay: 10 });

    // Wait for the bold formatting to appear
    await helper.waitForFormattedText(editor, /world/, 'bold');

    // Check selection state before toggling off - cursor should be collapsed at end of "world"
    const selectionInfo = await helper.getSelectionInfo(editor);
    console.log('[TEST] Selection before second ControlOrMeta+b:', JSON.stringify(selectionInfo));
    expect(selectionInfo.editorHasFocus).toBe(true);
    expect(selectionInfo.isCollapsed).toBe(true);
    // Cursor should be at end of bold text (offset varies based on ZWS presence)
    const boldText = await editor.locator(helper.getFormatSelector('bold')).textContent();
    const cleanBoldText = boldText?.replace(/[\uFEFF\u200B]/g, '');
    expect(cleanBoldText).toBe('world');
    expect(selectionInfo.anchorOffset).toBeGreaterThanOrEqual(5); // At least at end of "world"

    // Press Cmd+B again to toggle bold OFF
    console.log('[TEST] Second ControlOrMeta+b - toggling bold off');
    await editor.press('ControlOrMeta+b');

    // Wait for bold button to become inactive (polls until condition met)
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(false);
    }).toPass({ timeout: 5000 });
    await helper.waitForEditorFocus(editor);

    // Wait for cursor to be at correct position (after "Hello world")
    await helper.waitForCursorPosition(editor, 'Hello world');

    // Check cursor is outside the bold element after toggle
    const selectionAfterToggle = await helper.getSelectionInfo(editor);
    console.log('[TEST] Selection after second ControlOrMeta+b:', JSON.stringify(selectionAfterToggle));
    expect(selectionAfterToggle.editorHasFocus).toBe(true);
    expect(selectionAfterToggle.isCollapsed).toBe(true);
    // Cursor should NOT be inside SPAN (bold element) - it should be in #text after the span
    expect(selectionAfterToggle.anchorNodeName).not.toBe('SPAN');

    // Type " testing" - this should NOT be bold
    await editor.pressSequentially(' testing', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello world testing/);

    // Verify final text via clipboard (tests ZWS cleaning on copy)
    await editor.press('ControlOrMeta+a');
    await editor.press('ControlOrMeta+c');
    // Wait for clipboard to contain the expected text (copy may not complete immediately in CI)
    await expect
      .poll(async () => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: 5000,
      })
      .toBe('Hello world testing');

    // Verify structure: "Hello " (plain) + "world" (bold) + " testing" (plain)
    const html = await editor.innerHTML();
    console.log('[TEST] Final HTML:', html);

    // "world" should be bold (may contain trailing ZWS for cursor positioning)
    const boldSelector = helper.getFormatSelector('bold');
    const boldSpan = editor.locator(boldSelector);
    await expect(boldSpan).toHaveText(/world/);

    // " testing" should NOT be inside the bold span
    // Verify "testing" is outside the span by checking the span only contains "world" + optional ZWS
    const boldSpanContent = await boldSpan.textContent();
    const cleanBoldContent = boldSpanContent
      ?.replace(/[\uFEFF\u200B]/g, '')
      .trim();
    expect(cleanBoldContent).toBe('world');
  });

  test('prospective formatting: toggle on then off without typing preserves cursor position', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and type text
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Hello world', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello world/);

    // Ensure cursor is at end and get position
    await helper.moveCursorToEnd(editor);
    const selectionBefore = await helper.getSelectionInfo(editor);
    console.log('[TEST] Selection before toggle:', JSON.stringify(selectionBefore));
    expect(selectionBefore.isCollapsed).toBe(true);

    // Toggle bold ON (Ctrl+B) - creates empty bold element with ZWS
    await editor.press('ControlOrMeta+b');
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(true);
    }).toPass({ timeout: 5000 });

    // Toggle bold OFF (Ctrl+B again) without typing anything
    await editor.press('ControlOrMeta+b');
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(false);
    }).toPass({ timeout: 5000 });

    // Wait for editor to have focus and cursor to be collapsed (poll together to avoid race)
    let selectionAfter: Awaited<ReturnType<typeof helper.getSelectionInfo>>;
    await expect(async () => {
      selectionAfter = await helper.getSelectionInfo(editor);
      expect(selectionAfter.editorHasFocus).toBe(true);
      expect(selectionAfter.isCollapsed).toBe(true);
    }).toPass({ timeout: 5000 });
    console.log('[TEST] Selection after toggle off:', JSON.stringify(selectionAfter!));

    // Visible text should still be "Hello world"
    const textContent = await helper.getCleanTextContent(editor);
    expect(textContent).toBe('Hello world');

    // Verify cursor is at the end using visible text before/after cursor
    // (DOM offset varies due to ZWS nodes, but visible position should be at end)
    // Use toPass() because FORM_DATA re-render + restoreSlateSelection may take
    // an extra rAF cycle to settle.
    await expect(async () => {
      const textAround = await helper.getTextAroundCursor(editor);
      console.log('[TEST] Text around cursor:', JSON.stringify(textAround));
      expect(textAround.textBefore).toBe('Hello world');
      expect(textAround.textAfter).toBe('');
    }).toPass({ timeout: 5000 });
  });

  test('prospective formatting: toggle on, type, off, type, on again does not double text', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and type initial text
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Hello ', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello/);

    // Step 1: Toggle bold ON (prospective formatting)
    await editor.press('ControlOrMeta+b');
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(true);
    }).toPass({ timeout: 5000 });
    await helper.waitForEditorFocus(editor);
    // Wait for cursor to be at correct position (after "Hello ")
    await helper.waitForCursorPosition(editor, 'Hello ');

    // Step 2: Type bold text
    await editor.pressSequentially('bold', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello bold/);

    // Step 3: Toggle bold OFF (cursor exit)
    await editor.press('ControlOrMeta+b');
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(false);
    }).toPass({ timeout: 5000 });
    await helper.waitForEditorFocus(editor);
    // Wait for cursor to be at correct position (after "Hello bold")
    await helper.waitForCursorPosition(editor, 'Hello bold');

    // Step 4: Type non-bold text
    await editor.pressSequentially(' normal', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello bold normal/);

    // Verify text so far
    let textContent = await helper.getCleanTextContent(editor);
    console.log('[TEST] Text after first cycle:', textContent);
    expect(textContent).toBe('Hello bold normal');

    // Step 5: Toggle bold ON again (second prospective formatting)
    await editor.press('ControlOrMeta+b');
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(true);
    }).toPass({ timeout: 5000 });
    await helper.waitForEditorFocus(editor);
    // Wait for cursor to be at correct position (after "Hello bold normal")
    await helper.waitForCursorPosition(editor, 'Hello bold normal');

    // Step 6: Type more bold text
    await editor.pressSequentially(' more', { delay: 10 });

    // Verify final text - should NOT have doubled
    await expect(async () => {
      textContent = await helper.getCleanTextContent(editor);
      console.log('[TEST] Text after second prospective formatting:', textContent);
      expect(textContent).toBe('Hello bold normal more');
    }).toPass({ timeout: 5000 });
  });

  test('typing space immediately after format toggle is not lost (buffer replay)', async ({
    page,
  }, testInfo) => {
    const RUN = `[RUN-${testInfo.repeatEachIndex}]`;
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Inject run ID into iframe so hydra.js log() includes it
    const iframe = helper.getIframe();
    await iframe.locator('body').evaluate((_, id) => {
      (window as any).__testRunId = id;
    }, testInfo.repeatEachIndex);

    const blockId = 'block-1-uuid';

    // Enter edit mode and type initial text
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Hello', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello/);

    // Toggle bold ON and immediately type " world" — no waiting for
    // the format round-trip to complete. The space and subsequent chars
    // should be buffered during blocking and replayed without loss.
    await editor.press('ControlOrMeta+b');
    await editor.pressSequentially(' world', { delay: 10 });

    // Wait for everything to settle and verify no characters were lost
    await expect(async () => {
      const textContent = await helper.getCleanTextContent(editor);
      const innerHTML = await editor.evaluate(el => el.innerHTML);
      const rawText = await editor.evaluate(el => el.textContent);
      console.log(`${RUN} innerHTML:`, innerHTML);
      console.log(`${RUN} rawText:`, JSON.stringify(rawText));
      console.log(`${RUN} cleanText:`, JSON.stringify(textContent));
      expect(textContent).toBe('Hello world');
    }).toPass({ timeout: 10000 });
  });

  test('prospective formatting: user-typed space not destroyed by ensureValidInsertionTarget', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Hello ', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello/);

    // Toggle bold ON, type "bold"
    await editor.press('ControlOrMeta+b');
    await expect(async () => {
      const toolbar = page.locator('.quanta-toolbar');
      const toolbarCount = await toolbar.count();
      const toolbarDisplay = toolbarCount > 0 ? await toolbar.first().evaluate(el => el.style.display) : 'N/A';
      const toolbarOpacity = toolbarCount > 0 ? await toolbar.first().evaluate(el => el.style.opacity) : 'N/A';
      const boldBtn = page.locator('.quanta-toolbar [title*="Bold" i]');
      const btnCount = await boldBtn.count();
      const btnClasses = btnCount > 0 ? await boldBtn.first().evaluate(el => el.className) : 'N/A';
      const isActive = await helper.isActiveFormatButton('bold');
      if (!isActive) {
        console.log(`[DEBUG-BOLD] toolbar=${toolbarCount} display=${toolbarDisplay} opacity=${toolbarOpacity} btnCount=${btnCount} classes="${btnClasses}" isActive=${isActive}`);
      }
      expect(isActive).toBe(true);
    }).toPass({ timeout: 5000 });
    await helper.waitForEditorFocus(editor);
    await helper.waitForCursorPosition(editor, 'Hello ');
    await editor.pressSequentially('bold', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello bold/);

    // Toggle bold OFF, type " normal"
    await editor.press('ControlOrMeta+b');
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(false);
    }).toPass({ timeout: 5000 });
    await helper.waitForEditorFocus(editor);
    await helper.waitForCursorPosition(editor, 'Hello bold');
    await editor.pressSequentially(' normal', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello bold normal/);

    // Toggle bold ON again
    await editor.press('ControlOrMeta+b');
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(true);
    }).toPass({ timeout: 5000 });
    await helper.waitForEditorFocus(editor);
    await helper.waitForCursorPosition(editor, 'Hello bold normal');

    // INSTRUMENT: Install a MutationObserver INSIDE the iframe on the block element.
    // Must use frame.evaluate since iframe is cross-origin.
    const iframeHandle = await page.waitForSelector('#previewIframe');
    const frame = await iframeHandle.contentFrame();
    await frame!.evaluate((blockId) => {
      const blockEl = document.querySelector(`[data-block-uid="${blockId}"]`);
      if (!blockEl) {
        console.error('[DOM-MUTATION] Block element not found:', blockId);
        return;
      }
      console.log('[DOM-MUTATION] Observer installed on block:', blockId,
        'current text:', blockEl.textContent?.replace(/[\u200B\uFEFF]/g, ''));

      (window as any).__domMutationLog = [];
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          const entry: any = {
            type: m.type,
            time: performance.now().toFixed(1),
            target: (m.target as HTMLElement).nodeName + (
              (m.target as HTMLElement).getAttribute?.('data-block-uid') ||
              (m.target as HTMLElement).getAttribute?.('data-node-id') || ''
            ),
          };
          if (m.type === 'childList') {
            entry.addedNodes = m.addedNodes.length;
            entry.removedNodes = m.removedNodes.length;
            if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
              const textAfter = blockEl.textContent?.replace(/[\u200B\uFEFF]/g, '');
              entry.textAfter = textAfter;
            }
          } else if (m.type === 'characterData') {
            entry.oldValue = m.oldValue;
            entry.newValue = (m.target as Text).textContent;
          }
          (window as any).__domMutationLog.push(entry);
          console.log('[DOM-MUTATION]', JSON.stringify(entry));
        }
      });
      observer.observe(blockEl, {
        childList: true,
        subtree: true,
        characterData: true,
        characterDataOldValue: true,
      });
      (window as any).__domObserver = observer;
    }, blockId);

    // Now type " more" — this is where the space gets lost on Nuxt
    await editor.pressSequentially(' more', { delay: 50 });

    // Wait for text to sync before collecting mutation log
    await helper.waitForEditorText(editor, /more/);

    // Collect the mutation log from the iframe
    const mutationLog = await frame!.evaluate(() => (window as any).__domMutationLog || []);
    console.log('[TEST] Total DOM mutations after typing:', mutationLog.length);
    for (const entry of mutationLog) {
      console.log('[TEST] Mutation:', JSON.stringify(entry));
    }

    // Disconnect the observer
    await frame!.evaluate(() => {
      (window as any).__domObserver?.disconnect();
    });

    // Check the text
    const textContent = await helper.getCleanTextContent(editor);
    console.log('[TEST] Final text:', textContent);
    expect(textContent).toBe('Hello bold normal more');
  });

  test('prospective formatting: toggle in middle of text preserves text to right', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and type initial text
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('one two three four five', { delay: 10 });
    await helper.waitForEditorText(editor, /one two three four five/);

    // Click in the middle of the text (after "two ")
    await helper.selectTextRange(editor, 8, 8); // Position cursor after "one two "

    // Step 1: Toggle bold ON and type
    await editor.press('ControlOrMeta+b');
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(true);
    }).toPass({ timeout: 5000 });
    await helper.waitForEditorFocus(editor);
    await editor.pressSequentially('BOLD', { delay: 10 });

    // Wait for text to sync after typing
    await helper.waitForEditorText(editor, /one two BOLDthree four five/);
    let textContent = await helper.getCleanTextContent(editor);
    console.log('[TEST] After first bold:', textContent);
    expect(textContent).toBe('one two BOLDthree four five');

    // Step 2: Toggle bold OFF and type
    await editor.press('ControlOrMeta+b');
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(false);
    }).toPass({ timeout: 5000 });
    await helper.waitForEditorFocus(editor);
    await editor.pressSequentially(' normal ', { delay: 10 });

    // Wait for text to sync after typing
    await helper.waitForEditorText(editor, /one two BOLD normal three four five/);
    textContent = await helper.getCleanTextContent(editor);
    console.log('[TEST] After normal text:', textContent);
    expect(textContent).toBe('one two BOLD normal three four five');

    // Step 3: Toggle bold ON again - THIS IS WHERE TEXT MIGHT DISAPPEAR
    await editor.press('ControlOrMeta+b');
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(true);
    }).toPass({ timeout: 5000 });
    await helper.waitForEditorFocus(editor);

    // Verify text to the right is still there
    textContent = await helper.getCleanTextContent(editor);
    console.log('[TEST] After third toggle (no typing yet):', textContent);
    expect(textContent).toBe('one two BOLD normal three four five');

    // Type more bold text
    await editor.pressSequentially('MORE', { delay: 10 });

    // Wait for text to sync after typing
    await helper.waitForEditorText(editor, /one two BOLD normal MOREthree four five/);
    // Final verification - all text should be preserved
    textContent = await helper.getCleanTextContent(editor);
    console.log('[TEST] Final text:', textContent);
    expect(textContent).toBe('one two BOLD normal MOREthree four five');
  });

  test('prospective formatting: clipboard strips ZWS from bold text', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and clear the block
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);

    // Type "Hello " (not bold)
    await editor.pressSequentially('Hello ', { delay: 10 });
    await helper.waitForEditorText(editor, /Hello/);

    // Press Cmd+B to enable bold mode (prospective formatting inserts ZWS)
    await editor.press('ControlOrMeta+b');
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(true);
      // Verify focus is still on editor after format toggle
      await expect(editor).toBeFocused();
    }).toPass({ timeout: 5000 });

    // Type "world" - this should be bold
    await editor.pressSequentially('world', { delay: 10 });
    await helper.waitForFormattedText(editor, /world/, 'bold');

    // Select all and copy - clipboard should have clean text without ZWS
    await helper.selectAllTextInEditor(editor);
    const clipboardText = await helper.copyAndGetClipboardText(editor);
    console.log('[TEST] Clipboard text:', JSON.stringify(clipboardText));

    // Clipboard should have "Hello world" without any ZWS characters
    expect(clipboardText).toBe('Hello world');
    expect(clipboardText).not.toMatch(/[\uFEFF\u200B]/);
  });

  test('input not blocked after bolding and deleting selected text', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode and clear the block
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);

    // Type "one two three"
    await editor.pressSequentially('one two three', { delay: 10 });
    await helper.waitForEditorText(editor, /one two three/);

    // Select "two" - text is "one two three", "two" is at offset 4-7
    await helper.selectTextRange(editor, 4, 7);

    // Bold the selected text
    await editor.press('ControlOrMeta+b');
    await expect(async () => {
      expect(await helper.isActiveFormatButton('bold')).toBe(true);
    }).toPass({ timeout: 5000 });
    await helper.waitForEditorFocus(editor);

    // Wait for format to be applied
    await helper.waitForFormattedText(editor, /two/, 'bold');

    // Delete the bolded text
    await editor.press('Backspace');

    // Wait for deletion to complete and editor to be ready
    await helper.waitForEditorFocus(editor);
    // After deleting "two", cursor should be after "one "
    await helper.waitForCursorPosition(editor, 'one ');

    // Now try to type - this should work and not be blocked
    await editor.pressSequentially('NEW', { delay: 50 });

    // Verify the new text was typed
    await expect(async () => {
      const textContent = await helper.getCleanTextContent(editor);
      console.log('[TEST] Text after delete and type:', textContent);
      expect(textContent).toContain('NEW');
    }).toPass({ timeout: 5000 });

    // Final text should be "one NEW three" (with "two" replaced by "NEW")
    // Use regex to allow flexible whitespace - exact spacing depends on renderer's CSS
    // (white-space: pre-wrap preserves spaces, default CSS collapses them)
    const finalText = await helper.getCleanTextContent(editor);
    expect(finalText).toMatch(/one\s+NEW\s*three/);
  });

  test('format button still works when sidebar is closed', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Enter edit mode
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Test with sidebar closed', { delay: 10 });
    await helper.waitForEditorText(editor, /Test with sidebar closed/);

    // Close the sidebar by clicking the trigger button (the edge button that collapses it)
    const sidebarTrigger = page.locator('.sidebar-container .trigger');
    await sidebarTrigger.click();

    // Wait for sidebar to collapse (gets 'collapsed' class)
    const sidebarContainer = page.locator('.sidebar-container');
    await expect(sidebarContainer).toHaveClass(/collapsed/, { timeout: 5000 });

    // Now select text and apply bold formatting (should still work without sidebar)
    await helper.selectAllTextInEditor(editor);
    await helper.clickFormatButton('bold');

    // Wait for bold formatting to appear
    await helper.waitForFormattedText(editor, /Test with sidebar closed/, 'bold');

    // Verify bold was applied
    const boldSelector = helper.getFormatSelector('bold');
    await expect(editor.locator(boldSelector)).toBeVisible();
    expect(await editor.textContent()).toContain('Test with sidebar closed');
  });

  test('Backspace on last char updates admin state before next action', async ({ page }) => {
    // When the last character in a text node is deleted, the browser removes the
    // text node entirely (childList mutation). We need to detect this and update
    // formData so subsequent actions (like Enter to split) get the correct state.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const editor = await helper.enterEditMode(blockId);

    // Type a single character
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('x', { delay: 10 });
    await helper.waitForEditorText(editor, /x/);

    // Delete it — browser removes the text node
    await editor.press('Backspace');

    // Press Enter to split — if formData was updated correctly, both blocks
    // should be empty. If stale (still "x"), the new block would contain "x".
    const initialBlockOrder = await helper.getBlockOrder();
    await editor.press('Enter');

    // Wait for a new block UID to appear right after block-1-uuid
    let newBlockUid: string = '';
    await expect(async () => {
      const blockOrder = await helper.getBlockOrder();
      const originalBlockIndex = blockOrder.indexOf(blockId);
      const nextUid = blockOrder[originalBlockIndex + 1];
      expect(nextUid).toBeTruthy();
      expect(initialBlockOrder).not.toContain(nextUid);
      newBlockUid = nextUid;
    }).toPass({ timeout: 10000 });

    // Verify the new block is empty (not "x")
    const newEditor = await helper.getEditorLocator(newBlockUid);
    await expect(newEditor).toBeAttached({ timeout: 10000 });
    await expect(async () => {
      const newText = await helper.getCleanTextContent(newEditor);
      expect(newText).toBe('');
    }).toPass({ timeout: 5000 });
  });

  test('Backspace on last char in bold preserves formatting for next typed char', async ({ page }) => {
    // When the last character inside a <strong> element is deleted, a ZWS should
    // keep the text node alive so the cursor stays inside the bold context.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const editor = await helper.enterEditMode(blockId);

    // Type a single character and make it bold
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('a', { delay: 10 });
    await helper.waitForEditorText(editor, /a/);
    await helper.selectAllTextInEditor(editor);
    await helper.clickFormatButton('bold');
    await helper.waitForFormattedText(editor, /a/, 'bold');

    // Move to end and delete the bold "a"
    await editor.press('End');
    await editor.press('Backspace');

    // Type a new character — it should be bold since cursor was inside <strong>
    await editor.pressSequentially('b', { delay: 10 });

    // Verify "b" is bold
    const boldSelector = helper.getFormatSelector('bold');
    await expect(async () => {
      await expect(editor.locator(boldSelector)).toContainText('b');
    }).toPass({ timeout: 5000 });
  });

  test('Backspace through heading unwraps then deletes the block', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const iframe = helper.getIframe();
    const editor = await helper.enterEditMode(blockId);

    // Create H2 via markdown shortcut
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('##', { delay: 10 });
    await editor.press(' ');

    const h2 = iframe.locator(`[data-block-uid="${blockId}"] h2`);
    await expect(h2).toBeVisible({ timeout: 5000 });

    // Type text into the heading
    await editor.pressSequentially('abc', { delay: 10 });
    await expect(h2).toContainText('abc', { timeout: 5000 });

    // Backspace 3 times to delete "abc", once to unwrap H2→P, once to delete block
    for (let i = 0; i < 3; i++) {
      await editor.press('Backspace');
    }
    // First backspace on empty heading unwraps to paragraph
    await editor.press('Backspace');
    // Second backspace on empty paragraph deletes the block
    await editor.press('Backspace');

    // Block should be removed from the DOM
    await expect(iframe.locator(`[data-block-uid="${blockId}"]`)).not.toBeAttached({ timeout: 10000 });
  });
});
