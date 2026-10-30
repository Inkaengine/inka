/**
 * Unit tests for Bridge.restoreSlateSelection()
 * Tests selection restoration after format operations
 */

import { test, expect, URLS } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Bridge.restoreSlateSelection()', () => {
  let helper: AdminUIHelper;

  test.beforeEach(async ({ page }) => {
    helper = new AdminUIHelper(page);
    await page.goto(`${URLS.testFrontend}/mock-parent.html`);
    await helper.waitForIframeReady();
    await helper.waitForIframeBlockHandle('mock-block-1');
  });

  test('range selection across inline boundary selects correct text', async () => {
    // After partial bold: "This is a <strong>test</strong> paragraph"
    // Restore selection to select just "test" (anchor inside strong, focus after strong)
    // Bug: cursor exit logic was firing for the focus point of a range selection,
    // creating a ZWS and shifting the selection to offset 0-1 instead of "test".
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const bridge = (window as any).bridge;

      // Set up formData with partial bold
      const blockId = 'mock-block-1';
      const value = [
        {
          type: 'p',
          children: [
            { text: 'This is a ' },
            { type: 'strong', children: [{ text: 'test' }] },
            { text: ' paragraph' },
          ],
        },
      ];
      // Add nodeIds
      const valueWithIds = bridge.addNodeIds(value);
      bridge.formData.blocks[blockId].value = valueWithIds;

      // Set up the DOM to match (simulate what the renderer produces)
      const blockEl = document.querySelector(`[data-block-uid="${blockId}"]`);
      const editField = blockEl?.querySelector('[data-edit-text="value"]') || blockEl;
      if (editField) {
        editField.innerHTML = '<p data-node-id="0">This is a <strong data-node-id="0.1">test</strong> paragraph</p>';
      }

      // Restore selection: anchor at start of "test" inside strong, focus at start of " paragraph"
      const selection = {
        anchor: { path: [0, 1, 0], offset: 0 },
        focus: { path: [0, 2], offset: 0 },
      };
      bridge.restoreSlateSelection(selection, bridge.formData);

      // Read back the browser selection
      const sel = document.getSelection();
      return {
        selectedText: sel?.toString() || '',
        anchorOffset: sel?.anchorOffset,
        focusOffset: sel?.focusOffset,
        isCollapsed: sel?.isCollapsed,
        rangeCount: sel?.rangeCount,
      };
    });

    expect(result.selectedText).toBe('test');
    expect(result.isCollapsed).toBe(false);
  });

  test('collapsed selection after inline does not break', async () => {
    // Collapsed cursor right after </strong> — cursor exit SHOULD fire here
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const bridge = (window as any).bridge;

      const blockId = 'mock-block-1';
      const value = [
        {
          type: 'p',
          children: [
            { text: 'This is a ' },
            { type: 'strong', children: [{ text: 'test' }] },
            { text: ' paragraph' },
          ],
        },
      ];
      const valueWithIds = bridge.addNodeIds(value);
      bridge.formData.blocks[blockId].value = valueWithIds;

      const blockEl = document.querySelector(`[data-block-uid="${blockId}"]`);
      const editField = blockEl?.querySelector('[data-edit-text="value"]') || blockEl;
      if (editField) {
        editField.innerHTML = '<p data-node-id="0">This is a <strong data-node-id="0.1">test</strong> paragraph</p>';
      }

      // Collapsed cursor at start of text after strong
      const selection = {
        anchor: { path: [0, 2], offset: 0 },
        focus: { path: [0, 2], offset: 0 },
      };
      bridge.restoreSlateSelection(selection, bridge.formData);

      const sel = document.getSelection();
      return {
        isCollapsed: sel?.isCollapsed,
        anchorOffset: sel?.anchorOffset,
      };
    });

    expect(result.isCollapsed).toBe(true);
  });

  test('select-all on nextjs bold DOM with BOM spans selects all visible text', async () => {
    // Nextjs after bold: <span>BOM</span><strong><span>text</span></strong><span>BOM</span>
    // Restore selection to select ALL text (anchor at start, focus at end).
    // The cursor must land INSIDE the strong's text, not in the BOM spans.
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const bridge = (window as any).bridge;

      const blockId = 'mock-block-1';
      const value = [
        {
          type: 'p',
          children: [
            { text: '' },
            { type: 'strong', children: [{ text: 'Text to format' }] },
            { text: '' },
          ],
        },
      ];
      const valueWithIds = bridge.addNodeIds(value);
      bridge.formData.blocks[blockId].value = valueWithIds;

      // Exact nextjs DOM: BOM in span wrappers around strong
      const blockEl = document.querySelector(`[data-block-uid="${blockId}"]`);
      const editField = blockEl?.querySelector('[data-edit-text="value"]') || blockEl;
      if (editField) {
        (editField as HTMLElement).innerHTML =
          '<p data-node-id="0">' +
          '<span>\uFEFF</span>' +
          '<strong data-node-id="0.1"><span>Text to format</span></strong>' +
          '<span>\uFEFF</span>' +
          '</p>';
      }

      // Restore select-all: from start of first text to end of last text
      const selection = {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 2], offset: 0 },
      };
      bridge.restoreSlateSelection(selection, bridge.formData);

      const sel = document.getSelection();
      const selectedText = (sel?.toString() || '').replace(/[\uFEFF\u200B]/g, '');
      return {
        selectedText,
        isCollapsed: sel?.isCollapsed,
        anchorNodeText: sel?.anchorNode?.textContent?.replace(/[\uFEFF\u200B]/g, ''),
        focusNodeText: sel?.focusNode?.textContent?.replace(/[\uFEFF\u200B]/g, ''),
      };
    });

    expect(result.selectedText).toBe('Text to format');
    expect(result.isCollapsed).toBe(false);
  });

  test('select-all restore then type replaces bold text on nextjs DOM', async () => {
    // The full flow: restore select-all on bold text, then replay typing.
    // On nextjs, the typed text should replace the bold text and land
    // INSIDE the strong element. Bug: text lands in BOM span instead.
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const bridge = (window as any).bridge;

      const blockId = 'mock-block-1';
      const value = [
        {
          type: 'p',
          children: [
            { text: '' },
            { type: 'strong', children: [{ text: 'Text to format' }] },
            { text: '' },
          ],
        },
      ];
      const valueWithIds = bridge.addNodeIds(value);
      bridge.formData.blocks[blockId].value = valueWithIds;
      bridge.selectedBlockUid = blockId;
      bridge.focusedFieldName = 'value';
      bridge.isInlineEditing = true;

      const blockEl = document.querySelector(`[data-block-uid="${blockId}"]`)!;
      const editField = (blockEl.querySelector('[data-edit-text="value"]') || blockEl) as HTMLElement;
      if (bridge.blockTextMutationObserver) {
        bridge.blockTextMutationObserver.disconnect();
      }
      editField.innerHTML =
        '<p data-node-id="0">' +
        '<span>\uFEFF</span>' +
        '<strong data-node-id="0.1"><span>Text to format</span></strong>' +
        '<span>\uFEFF</span>' +
        '</p>';

      // Restore select-all
      const selection = {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 2], offset: 0 },
      };
      bridge.restoreSlateSelection(selection, bridge.formData);

      // Check selection before correctInvalidWhitespaceSelection
      const selBefore = window.getSelection()!;
      const beforeInfo = {
        anchorNode: selBefore.anchorNode?.textContent?.substring(0, 15),
        anchorParent: selBefore.anchorNode?.parentElement?.tagName,
        focusNode: selBefore.focusNode?.textContent?.substring(0, 15),
        focusParent: selBefore.focusNode?.parentElement?.tagName,
        isCollapsed: selBefore.isCollapsed,
      };
      console.log('[DEBUG] Before correctInvalidWhitespaceSelection:', JSON.stringify(beforeInfo));

      // Now simulate what replayBufferAndUnblock does for typing:
      bridge.correctInvalidWhitespaceSelection();

      const selAfter = window.getSelection()!;
      const afterInfo = {
        anchorNode: selAfter.anchorNode?.textContent?.substring(0, 15),
        anchorParent: selAfter.anchorNode?.parentElement?.tagName,
        focusNode: selAfter.focusNode?.textContent?.substring(0, 15),
        focusParent: selAfter.focusNode?.parentElement?.tagName,
        isCollapsed: selAfter.isCollapsed,
      };
      console.log('[DEBUG] After correctInvalidWhitespaceSelection:', JSON.stringify(afterInfo));

      const sel = window.getSelection()!;
      const range = sel.getRangeAt(0);

      // Delete selected content (like typing replaces selection)
      if (!range.collapsed) {
        range.deleteContents();
      }

      // Insert text
      const textNode = document.createTextNode('BUFFERED');
      range.insertNode(textNode);

      // Check where the text ended up
      const strong = editField.querySelector('strong');
      const textInStrong = strong?.textContent?.replace(/[\uFEFF\u200B]/g, '') || '';
      const fullText = editField.textContent?.replace(/[\uFEFF\u200B]/g, '') || '';

      return {
        fullText,
        textInStrong,
        textNodeParentTag: textNode.parentElement?.tagName,
        textNodeGrandparentTag: textNode.parentElement?.parentElement?.tagName,
      };
    });

    // BUFFERED should be inside the strong element
    expect(result.fullText).toBe('BUFFERED');
    expect(result.textInStrong).toContain('BUFFERED');
  });

  test('collapsed cursor at start of nextjs bold with BOM spans', async () => {
    // Collapsed cursor at offset 0 inside the bold text — should land
    // in the strong's text node, not in the BOM span before it.
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const bridge = (window as any).bridge;

      const blockId = 'mock-block-1';
      const value = [
        {
          type: 'p',
          children: [
            { text: '' },
            { type: 'strong', children: [{ text: 'Text to format' }] },
            { text: '' },
          ],
        },
      ];
      const valueWithIds = bridge.addNodeIds(value);
      bridge.formData.blocks[blockId].value = valueWithIds;

      const blockEl = document.querySelector(`[data-block-uid="${blockId}"]`);
      const editField = blockEl?.querySelector('[data-edit-text="value"]') || blockEl;
      if (editField) {
        (editField as HTMLElement).innerHTML =
          '<p data-node-id="0">' +
          '<span>\uFEFF</span>' +
          '<strong data-node-id="0.1"><span>Text to format</span></strong>' +
          '<span>\uFEFF</span>' +
          '</p>';
      }

      // Collapsed cursor at start of bold text (path [0, 1, 0] = strong's first child)
      const selection = {
        anchor: { path: [0, 1, 0], offset: 0 },
        focus: { path: [0, 1, 0], offset: 0 },
      };
      bridge.restoreSlateSelection(selection, bridge.formData);

      const sel = document.getSelection();
      const nodeText = sel?.focusNode?.textContent?.replace(/[\uFEFF\u200B]/g, '');
      return {
        isCollapsed: sel?.isCollapsed,
        offset: sel?.focusOffset,
        nodeText,
        // Typing should go inside the strong, not in the BOM span
        nodeParentTag: sel?.focusNode?.parentElement?.tagName,
      };
    });

    expect(result.isCollapsed).toBe(true);
    expect(result.nodeText).toBe('Text to format');
    expect(result.offset).toBe(0);
    // Cursor should be inside the strong's span, not in the BOM span
    expect(result.nodeParentTag).not.toBe('P');
  });
});
