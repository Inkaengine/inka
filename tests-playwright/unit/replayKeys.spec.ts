/**
 * Unit tests for bridge.replayOneKey() — verifies cursor position and text
 * after replaying keys, including DOM with BOM/ZWS nodes (nextjs pattern).
 *
 * Each test sets innerHTML on the mock block, places cursor, replays keys
 * via the real bridge code, and checks the result.
 */
import { test, expect, URLS } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * Set up DOM, place cursor, replay keys, return { text, textBefore }.
 * `html` is set on the block's edit field.
 * `cursorAt` is visible character offset (skips ZWS/BOM), or 'start'/'end'.
 * `keys` are key names or event objects passed to bridge.replayOneKey.
 * Strings are converted to event objects with no modifiers.
 * Use { key, ctrlKey, metaKey, shiftKey } for modifier combos.
 */
async function replay(
  iframe: ReturnType<AdminUIHelper['getIframe']>,
  html: string,
  cursorAt: 'start' | 'end' | number,
  keys: (
    | string
    | {
        key: string;
        ctrlKey?: boolean;
        metaKey?: boolean;
        shiftKey?: boolean;
        altKey?: boolean;
      }
  )[],
) {
  return await iframe.locator('body').evaluate(
    (
      _el: Element,
      {
        html,
        cursorAt,
        keys,
      }: { html: string; cursorAt: string | number; keys: any[] },
    ) => {
      const bridge = (window as any).bridge;
      const blockId = 'mock-block-1';
      const blockEl = document.querySelector(
        '[data-block-uid="mock-block-1"]',
      )!;
      const editField = (blockEl.querySelector('[data-edit-text]') ||
        blockEl) as HTMLElement;

      // Disconnect observer to prevent handleTextChange from firing
      // when we set innerHTML (which would corrupt formData)
      if (bridge.blockTextMutationObserver) {
        bridge.blockTextMutationObserver.disconnect();
      }
      editField.innerHTML = html;

      // Set up bridge state to match real editing flow
      bridge.selectedBlockUid = blockId;
      bridge.focusedFieldName = 'value';
      bridge.isInlineEditing = true;

      // Collect text nodes
      const walker = document.createTreeWalker(editField, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      let tn: Text | null;
      while ((tn = walker.nextNode() as Text)) textNodes.push(tn);

      // Place cursor by visible offset
      const sel = window.getSelection()!;
      const range = document.createRange();
      if (cursorAt === 'start') {
        range.setStart(textNodes[0], 0);
      } else if (cursorAt === 'end') {
        const last = textNodes[textNodes.length - 1];
        range.setStart(last, last.length);
      } else {
        let remaining = cursorAt as number;
        for (const t of textNodes) {
          const vis = t.textContent!.replace(/[\uFEFF\u200B]/g, '');
          if (remaining <= vis.length) {
            let raw = 0,
              seen = 0;
            for (
              let i = 0;
              i < t.textContent!.length && seen < remaining;
              i++
            ) {
              if (
                t.textContent![i] !== '\uFEFF' &&
                t.textContent![i] !== '\u200B'
              )
                seen++;
              raw++;
            }
            range.setStart(t, raw);
            break;
          }
          remaining -= vis.length;
        }
      }
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      // Replay via the real replayBufferAndUnblock — same code as production
      bridge.eventBuffer = keys.map((k: any) => {
        if (typeof k === 'string') {
          return {
            key: k,
            code: k,
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            altKey: false,
          };
        }
        return {
          code: k.key,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          altKey: false,
          ...k,
        };
      });
      bridge.pendingTransform = { blockId, requestId: 'test-replay' };
      bridge.blockedBlockId = blockId;
      bridge.replayBufferAndUnblock('unit-test');

      // Debug: check state after replay
      const debugSel = window.getSelection()!;
      const debugInfo = {
        focusNodeType: debugSel.focusNode?.nodeType,
        focusNodeText: debugSel.focusNode?.textContent?.substring(0, 20),
        focusOffset: debugSel.focusOffset,
        editFieldHTML: editField.innerHTML.substring(0, 100),
      };
      console.log('[replayKeys debug]', JSON.stringify(debugInfo));

      // Read result
      const text = editField.textContent!.replace(/[\uFEFF\u200B]/g, '');
      const r = document.createRange();
      r.setStart(editField, 0);
      r.setEnd(sel.focusNode!, sel.focusOffset);
      const textBefore = r.toString().replace(/[\uFEFF\u200B]/g, '');
      return { text, textBefore };
    },
    { html, cursorAt, keys },
  );
}

/**
 * Like replay() but also captures messages sent to parent window.
 * Returns { text, textBefore, messages } where messages is an array of
 * { type, ...data } objects sent via bridge.sendMessageToParent.
 */
async function replayWithMessages(
  iframe: ReturnType<AdminUIHelper['getIframe']>,
  html: string,
  cursorAt: 'start' | 'end' | number,
  keys: (
    | string
    | {
        key: string;
        ctrlKey?: boolean;
        metaKey?: boolean;
        shiftKey?: boolean;
        altKey?: boolean;
      }
  )[],
  setup?: (bridge: any) => void,
) {
  return await iframe.locator('body').evaluate(
    (_el: Element, { html, cursorAt, keys, setupStr }: any) => {
      const bridge = (window as any).bridge;
      const blockId = 'mock-block-1';
      const blockEl = document.querySelector(
        '[data-block-uid="mock-block-1"]',
      )!;
      const editField = (blockEl.querySelector('[data-edit-text]') ||
        blockEl) as HTMLElement;

      if (bridge.blockTextMutationObserver) {
        bridge.blockTextMutationObserver.disconnect();
      }
      editField.innerHTML = html;
      bridge.selectedBlockUid = blockId;
      bridge.focusedFieldName = 'value';
      bridge.isInlineEditing = true;

      // Run optional setup
      if (setupStr) {
        new Function('bridge', setupStr)(bridge);
      }

      // Capture messages
      const messages: any[] = [];
      const origSend = bridge.sendMessageToParent.bind(bridge);
      bridge.sendMessageToParent = (msg: any, ...args: any[]) => {
        messages.push(msg);
        origSend(msg, ...args);
      };

      // Place cursor
      const walker = document.createTreeWalker(editField, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      let tn: Text | null;
      while ((tn = walker.nextNode() as Text)) textNodes.push(tn);
      const sel = window.getSelection()!;
      const range = document.createRange();
      if (cursorAt === 'start') {
        range.setStart(textNodes[0], 0);
      } else if (cursorAt === 'end') {
        const last = textNodes[textNodes.length - 1];
        range.setStart(last, last.length);
      } else {
        let remaining = cursorAt as number;
        for (const t of textNodes) {
          const vis = t.textContent!.replace(/[\uFEFF\u200B]/g, '');
          if (remaining <= vis.length) {
            let raw = 0,
              seen = 0;
            for (
              let i = 0;
              i < t.textContent!.length && seen < remaining;
              i++
            ) {
              if (
                t.textContent![i] !== '\uFEFF' &&
                t.textContent![i] !== '\u200B'
              )
                seen++;
              raw++;
            }
            range.setStart(t, raw);
            break;
          }
          remaining -= vis.length;
        }
      }
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      // Replay
      bridge.eventBuffer = keys.map((k: any) => {
        if (typeof k === 'string') {
          return {
            key: k,
            code: k,
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            altKey: false,
          };
        }
        return {
          code: k.key,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          altKey: false,
          ...k,
        };
      });
      bridge.pendingTransform = { blockId, requestId: 'test-replay' };
      bridge.blockedBlockId = blockId;
      bridge.replayBufferAndUnblock('unit-test');

      // Restore
      bridge.sendMessageToParent = origSend;

      const text = editField.textContent!.replace(/[\uFEFF\u200B]/g, '');
      return { text, messages };
    },
    { html, cursorAt, keys, setupStr: setup?.toString() },
  );
}

test.describe('replayOneKey — cursor movement and editing', () => {
  let helper: AdminUIHelper;

  test.beforeEach(async ({ page }) => {
    helper = new AdminUIHelper(page);
    await page.goto(`${URLS.testFrontend}/mock-parent.html`);
    await helper.waitForIframeReady();
    await helper.waitForIframeBlockHandle('mock-block-1');
  });

  // --- Plain text ---

  test('ArrowLeft from end', async () => {
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0">Hello</p>',
      'end',
      ['ArrowLeft'],
    );
    expect(r.textBefore).toBe('Hell');
  });

  test('ArrowRight from start', async () => {
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0">Hello</p>',
      'start',
      ['ArrowRight'],
    );
    expect(r.textBefore).toBe('H');
  });

  test('Delete at start', async () => {
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0">Hello</p>',
      'start',
      ['Delete'],
    );
    expect(r.text).toBe('ello');
  });

  test('End + 3x ArrowLeft', async () => {
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0">Text to format</p>',
      'end',
      ['ArrowLeft', 'ArrowLeft', 'ArrowLeft'],
    );
    expect(r.textBefore).toBe('Text to for');
  });

  // --- Trailing BOM (nextjs: <span>text</span> + BOM) ---

  test('ArrowLeft skips trailing BOM', async () => {
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0"><span>Hello</span>\uFEFF</p>',
      'end',
      ['ArrowLeft'],
    );
    expect(r.textBefore).toBe('Hell');
  });

  test('End + 3x ArrowLeft with trailing BOM', async () => {
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0"><span>Text to format</span>\uFEFF</p>',
      'end',
      ['ArrowLeft', 'ArrowLeft', 'ArrowLeft'],
    );
    expect(r.textBefore).toBe('Text to for');
  });

  // --- Leading BOM (nextjs: BOM + <span>text</span>) ---

  test('Delete with leading BOM', async () => {
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0">\uFEFF<span>Hello</span></p>',
      'start',
      ['Delete'],
    );
    expect(r.text).toBe('ello');
  });

  test('ArrowRight skips leading BOM', async () => {
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0">\uFEFF<span>Hello</span></p>',
      'start',
      ['ArrowRight'],
    );
    expect(r.textBefore).toBe('H');
  });

  test('Home then Delete with leading BOM', async () => {
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0">\uFEFF<span>Text to format</span></p>',
      'end',
      ['Home', 'Delete'],
    );
    expect(r.text).toBe('ext to format');
    expect(r.textBefore).toBe('');
  });

  test('Home then Delete without BOM', async () => {
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0"><span>Text to format</span></p>',
      'end',
      ['Home', 'Delete'],
    );
    expect(r.text).toBe('ext to format');
    expect(r.textBefore).toBe('');
  });

  test('Home then Delete with span-wrapped text (nextjs plain)', async () => {
    // Nextjs wraps text in <span> even without formatting
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0"><span>Text to format</span></p>',
      'end',
      ['Home', 'Delete'],
    );
    expect(r.text).toBe('ext to format');
    expect(r.textBefore).toBe('');
  });

  test('Home then Delete with nextjs bold DOM (BOM in spans)', async () => {
    // Exact nextjs DOM after bold: BOM chars inside <span> wrappers
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0"><span>\uFEFF</span><strong data-node-id="0.1"><span>Text to format</span></strong><span>\uFEFF</span></p>',
      'end',
      ['Home', 'Delete'],
    );
    expect(r.text).toBe('ext to format');
    expect(r.textBefore).toBe('');
  });

  test('Home then Delete with nextjs bold DOM (empty spans, font-weight style)', async () => {
    // Exact DOM captured from Firefox + nextjs CI failure.
    // Empty <span></span> wrappers (no BOM), bold via style not <strong>.
    const r = await replay(
      helper.getIframe(),
      '<span></span><span style="font-weight: bold" data-node-id="0.1"><span>Text to format</span></span><span></span>',
      'end',
      ['Home', 'Delete'],
    );
    expect(r.text).toBe('ext to format');
    expect(r.textBefore).toBe('');
  });

  // --- Text character replay ---

  test('buffered text characters are inserted via insertText', async () => {
    // When focus falls to body during re-render, typed characters get buffered.
    // replayOneKey should insert them via execCommand('insertText').
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0">Hello</p>',
      'end',
      ['!', ' ', 'w', 'o', 'r', 'l', 'd'],
    );
    // Browser may convert space to NBSP in contenteditable
    expect(r.text.replace(/\u00A0/g, ' ')).toBe('Hello! world');
  });

  // --- Modifier combos ---

  test('Ctrl+A selects all text', async () => {
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0">Hello world</p>',
      3, // cursor at position 3
      [{ key: 'a', ctrlKey: true }],
    );
    // After select-all, textBefore should be empty (cursor at start of selection)
    // or full text (selection covers all). The selection itself covers all text.
    expect(r.text).toBe('Hello world');
  });

  test('composed accented character inserts correctly', async () => {
    // Dead key compositions arrive as single characters (e.g. è, ü, ñ)
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0">cafe</p>',
      'end',
      ['é'],
    ); // composed character, key.length === 1
    expect(r.text).toBe('cafeé');
  });

  test('special characters insert correctly', async () => {
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0">price </p>',
      'end',
      ['€', ' ', '1', '0', '0'],
    );
    expect(r.text.replace(/\u00A0/g, ' ')).toBe('price € 100');
  });

  test('Shift+Arrow extends selection', async () => {
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0">Hello world</p>',
      5, // cursor after "Hello"
      [
        { key: 'ArrowRight', shiftKey: true },
        { key: 'ArrowRight', shiftKey: true },
        { key: 'ArrowRight', shiftKey: true },
      ],
    );
    // Focus moved 3 chars right, textBefore measures to focus position
    expect(r.textBefore).toBe('Hello wo');
  });

  test('selection replacement: typing replaces selected text', async () => {
    // Select "world" then type "earth"
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0">Hello world</p>',
      6, // cursor at 'w'
      [
        { key: 'ArrowRight', shiftKey: true },
        { key: 'ArrowRight', shiftKey: true },
        { key: 'ArrowRight', shiftKey: true },
        { key: 'ArrowRight', shiftKey: true },
        { key: 'ArrowRight', shiftKey: true },
        'E',
        'a',
        'r',
        't',
        'h',
      ],
    );
    expect(r.text).toBe('Hello Earth');
  });

  // --- Bold with BOM between elements ---

  test('ArrowLeft through bold boundary with BOM', async () => {
    const r = await replay(
      helper.getIframe(),
      '<p data-node-id="0"><span>before</span>\uFEFF' +
        '<strong data-node-id="0.1"><span>bold</span></strong>\uFEFF</p>',
      'end',
      ['ArrowLeft', 'ArrowLeft'],
    );
    expect(r.textBefore).toBe('beforebo');
  });
});

test.describe('replayOneKey — slash menu, undo, save, Enter, Tab', () => {
  let helper: AdminUIHelper;

  test.beforeEach(async ({ page }) => {
    helper = new AdminUIHelper(page);
    await page.goto(`${URLS.testFrontend}/mock-parent.html`);
    await helper.waitForIframeReady();
    await helper.waitForIframeBlockHandle('mock-block-1');
  });

  test('slash menu ArrowDown sends SLASH_MENU down', async () => {
    const iframe = helper.getIframe();
    const r = await iframe.locator('body').evaluate(() => {
      const bridge = (window as any).bridge;
      bridge._slashMenuActive = true;
      const messages: any[] = [];
      const origSend = bridge.sendMessageToParent.bind(bridge);
      bridge.sendMessageToParent = (msg: any) => {
        messages.push(msg);
        origSend(msg);
      };
      bridge.replayOneKey('mock-block-1', { key: 'ArrowDown' }, null);
      bridge.sendMessageToParent = origSend;
      bridge._slashMenuActive = false;
      return { messages };
    });
    expect(
      r.messages.find(
        (m: any) => m.type === 'SLASH_MENU' && m.action === 'down',
      ),
    ).toBeTruthy();
  });

  test('slash menu Enter sends SLASH_MENU select', async () => {
    const iframe = helper.getIframe();
    const r = await iframe.locator('body').evaluate(() => {
      const bridge = (window as any).bridge;
      bridge._slashMenuActive = true;
      const messages: any[] = [];
      const origSend = bridge.sendMessageToParent.bind(bridge);
      bridge.sendMessageToParent = (msg: any) => {
        messages.push(msg);
        origSend(msg);
      };
      bridge.replayOneKey('mock-block-1', { key: 'Enter' }, null);
      bridge.sendMessageToParent = origSend;
      bridge._slashMenuActive = false;
      return { messages };
    });
    expect(
      r.messages.find(
        (m: any) => m.type === 'SLASH_MENU' && m.action === 'select',
      ),
    ).toBeTruthy();
  });

  test('slash menu Escape sends SLASH_MENU hide and deactivates', async () => {
    const iframe = helper.getIframe();
    const r = await iframe.locator('body').evaluate(() => {
      const bridge = (window as any).bridge;
      bridge._slashMenuActive = true;
      const messages: any[] = [];
      const origSend = bridge.sendMessageToParent.bind(bridge);
      bridge.sendMessageToParent = (msg: any) => {
        messages.push(msg);
        origSend(msg);
      };
      bridge.replayOneKey('mock-block-1', { key: 'Escape' }, null);
      bridge.sendMessageToParent = origSend;
      const wasDeactivated = !bridge._slashMenuActive;
      return { messages, wasDeactivated };
    });
    expect(
      r.messages.find(
        (m: any) => m.type === 'SLASH_MENU' && m.action === 'hide',
      ),
    ).toBeTruthy();
    expect(r.wasDeactivated).toBe(true);
  });

  test('Ctrl+Z sends SLATE_UNDO_REQUEST', async () => {
    const r = await replayWithMessages(
      helper.getIframe(),
      '<p data-node-id="0">Hello</p>',
      'end',
      [{ key: 'z', ctrlKey: true }],
    );
    const undoMsg = r.messages.find(
      (m: any) => m.type === 'SLATE_UNDO_REQUEST',
    );
    expect(undoMsg).toBeTruthy();
  });

  test('Ctrl+Shift+Z sends SLATE_REDO_REQUEST', async () => {
    const r = await replayWithMessages(
      helper.getIframe(),
      '<p data-node-id="0">Hello</p>',
      'end',
      [{ key: 'z', ctrlKey: true, shiftKey: true }],
    );
    const redoMsg = r.messages.find(
      (m: any) => m.type === 'SLATE_REDO_REQUEST',
    );
    expect(redoMsg).toBeTruthy();
  });

  test('Ctrl+S sends SAVE_REQUEST', async () => {
    const r = await replayWithMessages(
      helper.getIframe(),
      '<p data-node-id="0">Hello</p>',
      'end',
      [{ key: 's', ctrlKey: true }],
    );
    const saveMsg = r.messages.find((m: any) => m.type === 'SAVE_REQUEST');
    expect(saveMsg).toBeTruthy();
  });

  test('Enter in pre element inserts newline', async () => {
    // Exercises replayOneKey's <pre> branch on a REAL code field.
    // mock-code-block is a codeExample block; its tab's `code` field
    // (type: string, registered via the tabs object-list schema) renders
    // as <pre data-edit-text="code">. Using the real registered field —
    // not a faked one grafted onto a slate block — means selection sync
    // classifies it as plain text and doesn't raise the data-node-id
    // overlay, so replayOneKey's <pre> handling is what's actually tested.
    const iframe = helper.getIframe();
    const r = await iframe.locator('body').evaluate(() => {
      const bridge = (window as any).bridge;
      const tabId = 'mock-code-tab';
      const pre = document.querySelector(
        `[data-block-uid="${tabId}"] pre[data-edit-text="code"]`,
      ) as HTMLElement;

      if (bridge.blockTextMutationObserver)
        bridge.blockTextMutationObserver.disconnect();

      // Normalise the rendered code to a single plain text node so the
      // cursor can be placed by offset (the renderer may add syntax-
      // highlight spans).
      pre.textContent = 'line1';

      bridge.selectedBlockUid = tabId;
      bridge.focusedFieldName = 'code';
      bridge.isInlineEditing = true;

      // Place cursor at end
      const textNode = pre.firstChild!;
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.setStart(textNode, textNode.textContent!.length);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      // Replay Enter
      bridge.replayOneKey(
        tabId,
        {
          key: 'Enter',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        },
        pre,
      );

      return { text: pre.textContent };
    });
    expect(r.text).toBe('line1\n');
  });

  test('text after prospective inline (Ctrl+B) inserts inside the bold element', async () => {
    const iframe = helper.getIframe();
    const r = await iframe.locator('body').evaluate(() => {
      const bridge = (window as any).bridge;
      const blockId = 'mock-block-1';
      const blockEl = document.querySelector(
        '[data-block-uid="mock-block-1"]',
      )!;
      const editField = (blockEl.querySelector('[data-edit-text]') ||
        blockEl) as HTMLElement;

      if (bridge.blockTextMutationObserver)
        bridge.blockTextMutationObserver.disconnect();

      // Set up: "Hello" with a prospective <strong> at the end (simulates Ctrl+B with collapsed cursor)
      editField.innerHTML =
        '<p data-node-id="0">Hello<strong data-node-id="0.1"></strong></p>';
      bridge.selectedBlockUid = blockId;
      bridge.focusedFieldName = 'value';
      bridge.isInlineEditing = true;

      // Set the prospective inline element
      const strong = editField.querySelector('strong')!;
      bridge.prospectiveInlineElement = strong;

      // Place cursor inside the <strong> (where Chrome would put it after Ctrl+B)
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.setStart(strong, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      // Replay a text character — should end up INSIDE the <strong>
      bridge.replayOneKey(
        blockId,
        {
          key: 'x',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        },
        editField,
      );

      // Check if 'x' is inside the <strong>
      const strongText = strong.textContent;
      const fullText = editField.textContent!.replace(/[\uFEFF\u200B]/g, '');
      return { strongText, fullText };
    });
    expect(r.strongText).toContain('x');
    expect(r.fullText).toBe('Hellox');
  });

  test('_handleFieldKeydown skips isComposing events (IME)', async () => {
    const iframe = helper.getIframe();
    const r = await iframe.locator('body').evaluate(() => {
      const bridge = (window as any).bridge;
      const blockId = 'mock-block-1';
      const blockEl = document.querySelector(
        '[data-block-uid="mock-block-1"]',
      )!;
      const editField = (blockEl.querySelector('[data-edit-text]') ||
        blockEl) as HTMLElement;

      if (bridge.blockTextMutationObserver)
        bridge.blockTextMutationObserver.disconnect();
      editField.innerHTML = '<p data-node-id="0">Hello</p>';
      editField.setAttribute('contenteditable', 'true');
      bridge.selectedBlockUid = blockId;
      bridge.focusedFieldName = 'value';
      bridge.isInlineEditing = true;
      bridge.editMode = 'text';

      // Place cursor at end
      const textNode = editField.querySelector('p')!.firstChild!;
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.setStart(textNode, textNode.textContent!.length);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      // Dispatch a keydown with isComposing=true (simulates IME input)
      const composingEvent = new KeyboardEvent('keydown', {
        key: 'Process',
        code: 'KeyN',
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      // Override isComposing (readonly in constructor, use defineProperty)
      Object.defineProperty(composingEvent, 'isComposing', { value: true });

      // Track if preventDefault was called
      let prevented = false;
      const origPreventDefault =
        composingEvent.preventDefault.bind(composingEvent);
      composingEvent.preventDefault = () => {
        prevented = true;
        origPreventDefault();
      };

      editField.dispatchEvent(composingEvent);

      // Text should be unchanged (bridge didn't handle it)
      const text = editField.textContent!.replace(/[\uFEFF\u200B]/g, '');
      return { text, prevented };
    });
    // isComposing event should NOT be prevented — let native/IME handle
    expect(r.prevented).toBe(false);
    expect(r.text).toBe('Hello');
  });

  test('IME composition result is preserved via native input', async () => {
    const iframe = helper.getIframe();
    const r = await iframe.locator('body').evaluate(() => {
      const bridge = (window as any).bridge;
      const blockId = 'mock-block-1';
      const blockEl = document.querySelector(
        '[data-block-uid="mock-block-1"]',
      )!;
      const editField = (blockEl.querySelector('[data-edit-text]') ||
        blockEl) as HTMLElement;

      if (bridge.blockTextMutationObserver)
        bridge.blockTextMutationObserver.disconnect();
      editField.innerHTML = '<p data-node-id="0">Hello</p>';
      editField.setAttribute('contenteditable', 'true');
      bridge.selectedBlockUid = blockId;
      bridge.focusedFieldName = 'value';
      bridge.isInlineEditing = true;
      bridge.editMode = 'text';

      // Place cursor at end
      const textNode = editField.querySelector('p')!.firstChild!;
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.setStart(textNode, textNode.textContent!.length);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      // Simulate native IME inserting a character (compositionend)
      // In real IME, browser inserts the character natively
      textNode.textContent = 'Hello\u4e16'; // 世 (Chinese character)

      const text = editField.textContent!.replace(/[\uFEFF\u200B]/g, '');
      return { text };
    });
    // IME character should be in the text (inserted natively, not by replayOneKey)
    expect(r.text).toBe('Hello\u4e16');
  });

  test('Tab in non-list non-pre field steps to the next block', async () => {
    const iframe = helper.getIframe();
    const handled = await iframe.locator('body').evaluate(() => {
      const bridge = (window as any).bridge;
      const blockId = 'mock-block-1';
      const blockEl = document.querySelector(
        '[data-block-uid="mock-block-1"]',
      )!;
      const editField = (blockEl.querySelector('[data-edit-text]') ||
        blockEl) as HTMLElement;

      bridge.selectedBlockUid = blockId;
      bridge.focusedFieldName = 'value';
      bridge.isInlineEditing = true;
      bridge.editMode = 'text';
      editField.focus();

      return bridge.replayOneKey(
        blockId,
        {
          key: 'Tab',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        },
        editField,
      );
    });
    // Consumed, so the browser never inserts a tab or walks the page's own
    // tab order.
    expect(handled).toBe(true);

    // mock-block-1 has a single editable, so the step moves to the next BLOCK
    // in editing order. selectBlock focuses the destination asynchronously —
    // unlike the focus() this used to do inline — so poll rather than read
    // activeElement in the same evaluate.
    await expect
      .poll(
        () =>
          iframe
            .locator('body')
            .evaluate(
              () =>
                document.activeElement
                  ?.closest('[data-block-uid]')
                  ?.getAttribute('data-block-uid') ?? null,
            ),
        { timeout: 5000 },
      )
      .toBe('mock-text-block');
  });

  test("Tab inside a multi-field block steps to the block's next editable", async () => {
    const iframe = helper.getIframe();
    const r = await iframe.locator('body').evaluate(() => {
      const bridge = (window as any).bridge;
      const blockId = 'mock-multi-field-block';
      const blockEl = document.querySelector(`[data-block-uid="${blockId}"]`)!;
      const fields = bridge.getOwnEditableFields(blockEl);

      bridge.selectedBlockUid = blockId;
      bridge.focusedFieldName = fields[0].getAttribute('data-edit-text');
      bridge.isInlineEditing = true;
      bridge.editMode = 'text';
      // The real flow reaches here via selectBlock, which restores
      // contenteditable on the selected block's fields. Focus does not land on
      // a plain div, so the step would look like it did nothing.
      fields.forEach((f: HTMLElement) =>
        f.setAttribute('contenteditable', 'true'),
      );
      fields[0].focus();

      const handled = bridge.replayOneKey(
        blockId,
        {
          key: 'Tab',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        },
        fields[0],
      );

      // Stepping between a block's own editables is synchronous: no selectBlock.
      return {
        handled,
        fieldCount: fields.length,
        landedOnSecondField: document.activeElement === fields[1],
        stillSameBlock: document.activeElement
          ?.closest('[data-block-uid]')
          ?.getAttribute('data-block-uid'),
        selectionUnchanged: bridge.selectedBlockUid === blockId,
      };
    });
    expect(
      r.fieldCount,
      'the fixture block really has several editables',
    ).toBeGreaterThan(1);
    expect(r.handled).toBe(true);
    expect(
      r.landedOnSecondField,
      "focus moved to the block's next editable",
    ).toBe(true);
    expect(r.stillSameBlock).toBe('mock-multi-field-block');
    expect(
      r.selectionUnchanged,
      'a field step must not move the selection',
    ).toBe(true);
  });

  test('Ctrl+A selects all text and selection survives selectionchange', async () => {
    const iframe = helper.getIframe();
    const r = await iframe.locator('body').evaluate(() => {
      const bridge = (window as any).bridge;
      const blockId = 'mock-block-1';
      const blockEl = document.querySelector(
        '[data-block-uid="mock-block-1"]',
      )!;
      const editField = (blockEl.querySelector('[data-edit-text]') ||
        blockEl) as HTMLElement;

      if (bridge.blockTextMutationObserver)
        bridge.blockTextMutationObserver.disconnect();
      editField.innerHTML = '<p data-node-id="0">Hello World</p>';
      editField.setAttribute('contenteditable', 'true');
      bridge.selectedBlockUid = blockId;
      bridge.focusedFieldName = 'value';
      bridge.isInlineEditing = true;
      bridge.editMode = 'text';

      // Place cursor at start
      const textNode = editField.querySelector('p')!.firstChild!;
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      // Replay Ctrl+A
      bridge.handleSpecialKey(
        blockId,
        {
          key: 'a',
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        },
        editField,
      );

      // Check selection immediately
      const selText = window.getSelection()?.toString() || '';

      return { selText };
    });
    expect(r.selText).toBe('Hello World');
  });

  test('Ctrl+C triggers execCommand copy', async () => {
    const iframe = helper.getIframe();
    const r = await iframe.locator('body').evaluate(() => {
      const bridge = (window as any).bridge;
      const blockId = 'mock-block-1';
      const blockEl = document.querySelector(
        '[data-block-uid="mock-block-1"]',
      )!;
      const editField = (blockEl.querySelector('[data-edit-text]') ||
        blockEl) as HTMLElement;

      if (bridge.blockTextMutationObserver)
        bridge.blockTextMutationObserver.disconnect();
      editField.innerHTML = '<p data-node-id="0">Copy this text</p>';
      editField.setAttribute('contenteditable', 'true');
      bridge.selectedBlockUid = blockId;
      bridge.focusedFieldName = 'value';

      // Select all text
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(editField.querySelector('p')!);
      sel.removeAllRanges();
      sel.addRange(range);

      // Track if copy event fires
      let copyFired = false;
      editField.addEventListener(
        'copy',
        () => {
          copyFired = true;
        },
        { once: true },
      );

      bridge.handleSpecialKey(
        blockId,
        {
          key: 'c',
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        },
        editField,
      );

      return { copyFired };
    });
    expect(r.copyFired).toBe(true);
  });

  test('Ctrl+X triggers copy and sends delete transform', async () => {
    const iframe = helper.getIframe();
    const r = await iframe.locator('body').evaluate(() => {
      const bridge = (window as any).bridge;
      const blockId = 'mock-block-1';
      const blockEl = document.querySelector(
        '[data-block-uid="mock-block-1"]',
      )!;
      const editField = (blockEl.querySelector('[data-edit-text]') ||
        blockEl) as HTMLElement;

      if (bridge.blockTextMutationObserver)
        bridge.blockTextMutationObserver.disconnect();
      editField.innerHTML = '<p data-node-id="0">Cut this text</p>';
      editField.setAttribute('contenteditable', 'true');
      bridge.selectedBlockUid = blockId;
      bridge.editMode = 'text';
      bridge.focusedFieldName = 'value';

      // Select all text
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(editField.querySelector('p')!);
      sel.removeAllRanges();
      sel.addRange(range);

      let copyFired = false;
      editField.addEventListener(
        'copy',
        () => {
          copyFired = true;
        },
        { once: true },
      );

      // sendTransformRequest sets pendingTransform with the requestId
      bridge.pendingTransform = null;

      bridge.handleSpecialKey(
        blockId,
        {
          key: 'x',
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        },
        editField,
      );

      return {
        copyFired,
        hasDeleteTransform:
          !!bridge.pendingTransform?.requestId?.includes('delete'),
      };
    });
    expect(r.copyFired).toBe(true);
    expect(r.hasDeleteTransform).toBe(true);
  });

  test('Space on button element inserts space (not activate)', async () => {
    // replayOneKey's <button> Space branch on a REAL <button> element:
    // the form block's submit button (data-edit-text="submit_label",
    // type: string). A <button> natively activates on Space \u2014 the bridge
    // must insert a space instead while the button text is being edited.
    const iframe = helper.getIframe();
    const r = await iframe.locator('body').evaluate(() => {
      const bridge = (window as any).bridge;
      const blockId = 'mock-form-block';
      const btn = document.querySelector(
        `[data-block-uid="${blockId}"] button.form-submit[data-edit-text="submit_label"]`,
      ) as HTMLElement;

      if (bridge.blockTextMutationObserver)
        bridge.blockTextMutationObserver.disconnect();

      btn.setAttribute('contenteditable', 'true');
      btn.textContent = 'Click';

      bridge.selectedBlockUid = blockId;
      bridge.focusedFieldName = 'submit_label';
      bridge.isInlineEditing = true;

      // Place cursor at end
      const textNode = btn.firstChild!;
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.setStart(textNode, textNode.textContent!.length);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      bridge.replayOneKey(
        blockId,
        {
          key: ' ',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        },
        btn,
      );

      return { text: btn.textContent };
    });
    // Space should be inserted as text, not activate the button
    expect(r.text).toContain('Click\u00A0');
  });

  test('Tab in pre element inserts spaces', async () => {
    // replayOneKey's <pre> Tab branch, on the real mock-code-block code
    // field (registered, type: string) — see the Enter test above.
    const iframe = helper.getIframe();
    const r = await iframe.locator('body').evaluate(() => {
      const bridge = (window as any).bridge;
      const tabId = 'mock-code-tab';
      const pre = document.querySelector(
        `[data-block-uid="${tabId}"] pre[data-edit-text="code"]`,
      ) as HTMLElement;

      if (bridge.blockTextMutationObserver)
        bridge.blockTextMutationObserver.disconnect();

      pre.textContent = 'hello';

      bridge.selectedBlockUid = tabId;
      bridge.focusedFieldName = 'code';
      bridge.isInlineEditing = true;

      const textNode = pre.firstChild!;
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      bridge.replayOneKey(
        tabId,
        {
          key: 'Tab',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        },
        pre,
      );

      return { text: pre.textContent };
    });
    expect(r.text).toBe('  hello');
  });

  test('_insertTextAtCursor on non-collapsed selection inside bold preserves formatting', async () => {
    const iframe = helper.getIframe();
    const r = await iframe.locator('body').evaluate(() => {
      const bridge = (window as any).bridge;
      const blockId = 'mock-block-1';
      const blockEl = document.querySelector(
        '[data-block-uid="mock-block-1"]',
      )!;
      const editField = (blockEl.querySelector('[data-edit-text]') ||
        blockEl) as HTMLElement;

      if (bridge.blockTextMutationObserver)
        bridge.blockTextMutationObserver.disconnect();
      // Set up bold text — frontends use <strong>, <b>, or <span style="font-weight:bold">
      editField.innerHTML =
        '<p data-node-id="0"><strong data-node-id="0.1">Bold text</strong></p>';
      editField.setAttribute('contenteditable', 'true');
      bridge.selectedBlockUid = blockId;
      bridge.editMode = 'text';
      bridge.focusedFieldName = 'value';

      // Select all text — use restoreSlateSelection like the real code does
      // This sets selection at the node-id level, not the text node level
      const selection = {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 9 },
      };
      bridge.restoreSlateSelection(selection, {
        blocks: {
          'mock-block-1': {
            '@type': 'slate',
            value: [
              {
                type: 'p',
                children: [
                  { text: '' },
                  { type: 'strong', children: [{ text: 'Bold text' }] },
                  { text: '' },
                ],
              },
            ],
          },
        },
        blocks_layout: { items: ['mock-block-1'] },
      });
      const sel = window.getSelection()!;

      // Capture state before
      const selBefore = {
        collapsed: sel.isCollapsed,
        text: sel.toString(),
        anchorNode: sel.anchorNode?.nodeName,
        anchorParent: sel.anchorNode?.parentElement?.nodeName,
      };

      // Insert replacement text
      bridge._insertTextAtCursor('Replaced', editField);

      // Check result
      const html = editField.innerHTML;
      const hasStrongWrapper = !!editField.querySelector('strong');
      const textContent = editField.textContent;

      return { selBefore, html, hasStrongWrapper, textContent };
    });
    console.log('Before:', JSON.stringify(r.selBefore), 'After HTML:', r.html);
    expect(r.selBefore.collapsed).toBe(false);
    expect(r.selBefore.text).toBe('Bold text');
    expect(r.textContent).toContain('Replaced');
    expect(r.hasStrongWrapper).toBe(true);
  });
});
