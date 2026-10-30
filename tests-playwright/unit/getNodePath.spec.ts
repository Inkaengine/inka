/**
 * Unit tests for getNodePath() DOM path generation
 * Tests the REAL getNodePath function from hydra.js
 */

import { test, expect, URLS } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('getNodePath() - DOM to Slate path conversion (real hydra.js)', () => {
  let helper: AdminUIHelper;

  test.beforeEach(async ({ page }) => {
    helper = new AdminUIHelper(page);

    // Load the mock parent page which initializes the real hydra.js bridge
    await page.goto(`${URLS.testFrontend}/mock-parent.html`);
    await helper.waitForIframeReady();
    await helper.waitForIframeBlockHandle('mock-block-1');

    // Inject helper for creating DOM with preserved whitespace (Vue/Nuxt template artifacts)
    await helper.injectPreserveWhitespaceHelper();
  });

  test('plain text directly in paragraph', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // Set up test DOM and call real getNodePath
    const path = await body.evaluate(() => {
      // Create test DOM structure inside a test container
      const container = document.createElement('div');
      container.innerHTML =
        '<p data-edit-text="value" data-node-id="0">Hello world</p>';
      document.body.appendChild(container);

      const textNode = container.querySelector('p')!.firstChild;
      const result = (window as any).bridge.getNodePath(textNode);

      // Clean up
      container.remove();
      return result;
    });

    expect(path).toEqual([0, 0]);
  });

  test('closest data-node-id from span without data-node-id (F7/Vue pattern)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // handleTextChange uses closest('[data-node-id]') to find the Slate node.
    // When mutatedNodeParent is <span> (no data-node-id), it must walk up from
    // the span, not from the data-edit-text target.
    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0"><span>Hello world</span></p>' +
        '</div>';
      document.body.appendChild(container);

      const span = container.querySelector('span')!;
      const editTarget = container.querySelector('[data-edit-text]')!;

      // BUG: handleTextChange falls back to editTarget.closest('[data-node-id]')
      const fromEditTarget = editTarget.closest('[data-node-id]');
      // FIX: should use span.closest('[data-node-id]')
      const fromSpan = span.closest('[data-node-id]');

      container.remove();
      return {
        fromEditTarget: fromEditTarget?.getAttribute('data-node-id') ?? null,
        fromSpan: fromSpan?.getAttribute('data-node-id') ?? null,
      };
    });

    // editTarget.closest walks UP and finds nothing (data-node-id is a descendant)
    expect(result.fromEditTarget).toBeNull();
    // span.closest walks UP and finds <p data-node-id="0">
    expect(result.fromSpan).toBe('0');
  });

  test('text wrapped in span without data-node-id (F7/Vue pattern)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // F7 renders: <p data-node-id="0"><span>Hello world</span></p>
    // The <span> has no data-node-id — it's a decorative wrapper.
    // getNodePath should still find [0, 0] by walking through the span.
    const path = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p data-edit-text="value" data-node-id="0"><span>Hello world</span></p>';
      document.body.appendChild(container);

      const textNode = container.querySelector('span')!.firstChild;
      const result = (window as any).bridge.getNodePath(textNode);

      container.remove();
      return result;
    });

    expect(path).toEqual([0, 0]);
  });

  test('getNodePath with span data-node-id="undefined" wrapping text (Next.js pattern)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // Next.js renders: <p data-node-id="0"><span data-node-id="undefined">Hello</span></p>
    // getNodePath must ignore the invalid "undefined" nodeId on the span
    // and return the correct path [0, 0] (paragraph 0, text child 0).
    const path = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p data-edit-text="value" data-node-id="0"><span data-node-id="undefined">Hello world</span></p>';
      document.body.appendChild(container);

      const textNode = container.querySelector('span')!.firstChild;
      const result = (window as any).bridge.getNodePath(textNode);

      container.remove();
      return result;
    });

    expect(path).toEqual([0, 0]);
  });

  test('getNodePath with mixed valid and invalid data-node-id siblings (Next.js bold)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // Next.js renders bold as: <p data-node-id="0">
    //   <span data-node-id="undefined">Hello </span>
    //   <strong data-node-id="0.1"><span data-node-id="undefined">world</span></strong>
    // </p>
    // getNodePath for "world" text should be [0, 1, 0] — paragraph 0, child 1 (strong), text 0.
    const path = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p data-edit-text="value" data-node-id="0">' +
        '<span data-node-id="undefined">Hello </span>' +
        '<strong data-node-id="0.1"><span data-node-id="undefined">world</span></strong>' +
        '</p>';
      document.body.appendChild(container);

      const strong = container.querySelector('strong')!;
      const textNode = strong.querySelector('span')!.firstChild;
      const result = (window as any).bridge.getNodePath(textNode);

      container.remove();
      return result;
    });

    expect(path).toEqual([0, 1, 0]);
  });

  test('handleTextChange updates formData when span has data-node-id="undefined" (Next.js pattern)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // Next.js renders text leaves as <span data-node-id="undefined">text</span>
    // because it templates `data-node-id={node.nodeId}` and text leaves have
    // nodeId=undefined. handleTextChange must skip this invalid attribute and
    // walk up to the <p data-node-id="0"> to find the correct Slate node.
    //
    // We call the real handleTextChange with a DOM mutation target inside the
    // invalid span, then check whether formData was updated.
    const result = await body.evaluate(() => {
      const bridge = (window as any).bridge;

      // Set up formData and blockPathMap with a known block and slate value
      const blockId = 'test-nextjs-block';
      bridge.formData = {
        ...bridge.formData,
        blocks: {
          ...bridge.formData.blocks,
          [blockId]: {
            '@type': 'slate',
            value: [{ type: 'p', children: [{ text: 'Hello world' }], nodeId: '0' }],
          },
        },
      };
      bridge.blockPathMap = {
        ...bridge.blockPathMap,
        _schemas: {
          ...(bridge.blockPathMap?._schemas || {}),
          'test-schema': {
            properties: {
              value: { widget: 'slate' },
            },
          },
        },
        [blockId]: {
          path: ['blocks', blockId],
          _schemaRef: 'test-schema',
        },
      };
      bridge.selectedBlockUid = blockId;
      bridge.focusedFieldName = 'value';
      bridge.isInlineEditing = true;

      // Create DOM matching Next.js pattern: span wraps text with invalid nodeId
      const blockEl = document.createElement('div');
      blockEl.setAttribute('data-block-uid', blockId);
      blockEl.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0"><span data-node-id="undefined">Hello world</span></p>' +
        '</div>';
      document.body.appendChild(blockEl);

      // Simulate typing: modify text node inside the span
      const span = blockEl.querySelector('span')!;
      const textNode = span.firstChild!;
      textNode.textContent = 'Hello world TYPED';

      // Call handleTextChange as the MutationObserver would
      const editTarget = blockEl.querySelector('[data-edit-text="value"]')!;
      bridge.handleTextChange(editTarget, span, textNode);

      // Check if formData was updated
      const updatedText = bridge.formData.blocks[blockId].value[0].children[0].text;

      blockEl.remove();
      return { updatedText };
    });

    // formData should reflect the typed text
    expect(result.updatedText).toBe('Hello world TYPED');
  });

  test('readSlateValueFromDOM reads correct text through invalid data-node-id spans (Next.js pattern)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // readSlateValueFromDOM walks the DOM tree. Elements with invalid nodeId
    // (e.g. "undefined" from Next.js) are treated as text content.
    const result = await body.evaluate(() => {
      const bridge = (window as any).bridge;

      // Slate value representing the field
      const slateValue = [
        { type: 'p', children: [{ text: 'Original' }], nodeId: '0' },
      ];

      // DOM as Next.js renders it — text wrapped in span with invalid nodeId
      const container = document.createElement('div');
      container.setAttribute('data-edit-text', 'value');
      container.innerHTML =
        '<p data-node-id="0"><span data-node-id="undefined">Modified text</span></p>';
      document.body.appendChild(container);

      const domValue = bridge.readSlateValueFromDOM(container, slateValue);

      container.remove();
      return {
        text: domValue[0].children[0].text,
      };
    });

    // Should read "Modified text" from the DOM, not keep "Original"
    expect(result.text).toBe('Modified text');
  });

  test('isOnInvalidWhitespace: whitespace outside invalid span but inside edit field is invalid', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // Next.js renders: <div data-edit-text="value">
    //   \n  <p data-node-id="0"><span data-node-id="undefined">Hello</span></p>\n
    // </div>
    // The whitespace text nodes between <div> and <p> are outside any data-node-id.
    // With the bug: querySelector('[data-node-id]') finds the invalid span, thinks
    // the field has Slate rendering, but the walk-up from whitespace also finds the
    // invalid span → returns false (valid). With the fix: invalid span is skipped,
    // walk-up reaches editableField without finding valid data-node-id → returns true.
    //
    // BUT: the <p> has valid data-node-id="0", so querySelector('[data-node-id]')
    // finds that too. The walk-up from whitespace (sibling of <p>, not inside it)
    // hits the edit-text container → returns true regardless of the invalid span.
    // So this case works correctly even without the fix.
    //
    // The tricky case: text INSIDE the invalid span but OUTSIDE any valid node-id.
    // e.g. <div data-edit-text="value"><span data-node-id="undefined">Hello</span></div>
    // (no <p> wrapping — field itself is the container, span is direct child)
    const result = await body.evaluate(() => {
      const bridge = (window as any).bridge;

      // No <p> wrapper — invalid span is direct child of edit-text container
      const container = document.createElement('div');
      container.setAttribute('data-edit-text', 'value');
      container.innerHTML = '<span data-node-id="undefined">Hello</span>';
      document.body.appendChild(container);

      const textNode = container.querySelector('span')!.firstChild!;
      const textResult = bridge.isOnInvalidWhitespace(textNode);

      container.remove();
      return { textResult };
    });

    // Text is inside an invalid span — walk-up finds span with data-node-id,
    // incorrectly returns false. With fix (validating nodeId), it would skip
    // the span, hit the edit-text container, and return true.
    // Actually this is edge-case: without a valid <p>, the field has no real
    // Slate structure. In practice Next.js always has <p data-node-id="0">.
    // The real protection is in the other functions we already fixed.
    // Still, the walk-up SHOULD skip invalid nodeIds for correctness.
    expect(result.textResult).toBe(true);
  });

  test('isOnInvalidWhitespace: BOM text in span inside valid data-node-id is invalid', async () => {
    // Nextjs bold: <p data-node-id="0"><span>﻿</span><strong data-node-id="0.1">...</strong></p>
    // The BOM text node is inside <span> which is inside <p data-node-id="0">.
    // The walk-up finds <p> with valid nodeId and returns false (thinks it's valid).
    // But BOM-only text nodes should always be invalid — the cursor should be
    // in visible text, not in an invisible boundary character.
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const bridge = (window as any).bridge;

      const container = document.createElement('div');
      container.setAttribute('data-block-uid', 'test-bom');
      container.setAttribute('data-edit-text', 'value');
      container.innerHTML =
        '<p data-node-id="0">' +
        '<span>\uFEFF</span>' +
        '<strong data-node-id="0.1"><span>Text to format</span></strong>' +
        '<span>\uFEFF</span>' +
        '</p>';
      document.body.appendChild(container);

      const bomSpan = container.querySelector('span')!;
      const bomTextNode = bomSpan.firstChild!;
      const isInvalid = bridge.isOnInvalidWhitespace(bomTextNode);

      container.remove();
      return { isInvalid };
    });

    expect(result.isInvalid).toBe(true);
  });

  test('saveCursorPosition skips invalid data-node-id="undefined" span (Next.js pattern)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // saveCursorPosition uses .closest('[data-node-id]') to save the nodeId.
    // With invalid span, it saves "undefined" as the nodeId.
    // restoreCursorPosition then queries querySelector('[data-node-id="undefined"]')
    // which finds the wrong element.
    const result = await body.evaluate(() => {
      const bridge = (window as any).bridge;

      const container = document.createElement('div');
      container.setAttribute('data-edit-text', 'value');
      container.setAttribute('contenteditable', 'true');
      container.innerHTML =
        '<p data-node-id="0"><span data-node-id="undefined">Hello world</span></p>';
      document.body.appendChild(container);

      // Place cursor inside the text
      const textNode = container.querySelector('span')!.firstChild!;
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.setStart(textNode, 3);
      range.setEnd(textNode, 3);
      sel.removeAllRanges();
      sel.addRange(range);

      const saved = bridge.saveCursorPosition();

      container.remove();
      return {
        startNodeId: saved?.startNodeId || null,
        endNodeId: saved?.endNodeId || null,
      };
    });

    // Should save the valid <p>'s nodeId "0", not the invalid span's "undefined"
    expect(result.startNodeId).toBe('0');
    expect(result.endNodeId).toBe('0');
  });

  test('text inside bold span', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const paths = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p data-edit-text="value" data-node-id="0">Hello <span style="font-weight: bold" data-node-id="0.1">world</span></p>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const plainTextNode = p.firstChild; // "Hello "
      const span = p.querySelector('span')!;
      const boldTextNode = span.firstChild; // "world"

      const result = {
        plainText: (window as any).bridge.getNodePath(plainTextNode),
        boldText: (window as any).bridge.getNodePath(boldTextNode),
      };

      container.remove();
      return result;
    });

    expect(paths.plainText).toEqual([0, 0]);
    expect(paths.boldText).toEqual([0, 1, 0]);
  });

  test('text-format-text pattern', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const paths = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p data-edit-text="value" data-node-id="0">This is <span data-node-id="0.1">bold</span> text</p>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const firstText = p.childNodes[0]; // "This is "
      const boldText = p.querySelector('span')!.firstChild; // "bold"
      const lastText = p.childNodes[2]; // " text"

      const result = {
        first: (window as any).bridge.getNodePath(firstText),
        bold: (window as any).bridge.getNodePath(boldText),
        last: (window as any).bridge.getNodePath(lastText),
        childNodesCount: p.childNodes.length,
      };

      container.remove();
      return result;
    });

    expect(paths.childNodesCount).toBe(3);
    expect(paths.first).toEqual([0, 0]);
    expect(paths.bold).toEqual([0, 1, 0]);
    expect(paths.last).toEqual([0, 2]); // Text at index 2, no additional nesting
  });

  test('multiple formatted spans in sequence', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const paths = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p data-edit-text="value" data-node-id="0">' +
        '<span data-node-id="0.0">bold</span>' +
        '<span data-node-id="0.1">italic</span>' +
        '<span data-node-id="0.2">underline</span>' +
        '</p>';
      document.body.appendChild(container);

      const spans = container.querySelectorAll('span');
      const result = [
        (window as any).bridge.getNodePath(spans[0].firstChild),
        (window as any).bridge.getNodePath(spans[1].firstChild),
        (window as any).bridge.getNodePath(spans[2].firstChild),
      ];

      container.remove();
      return result;
    });

    expect(paths[0]).toEqual([0, 0, 0]);
    expect(paths[1]).toEqual([0, 1, 0]);
    expect(paths[2]).toEqual([0, 2, 0]);
  });

  test('nested formatting (bold + italic)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const path = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p data-edit-text="value" data-node-id="0">' +
        '<span data-node-id="0.0">' +
        '<span data-node-id="0.0.0">nested</span>' +
        '</span>' +
        '</p>';
      document.body.appendChild(container);

      const textNode = container.querySelector('span span')!.firstChild;
      const result = (window as any).bridge.getNodePath(textNode);

      container.remove();
      return result;
    });

    expect(path).toEqual([0, 0, 0, 0]);
  });

  test('paragraph with wrapper div for editable field', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const path = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value"><p data-node-id="0">Hello world</p></div>';
      document.body.appendChild(container);

      const textNode = container.querySelector('p')!.firstChild;
      const result = (window as any).bridge.getNodePath(textNode);

      container.remove();
      return result;
    });

    expect(path).toEqual([0, 0]);
  });

  test('element node (not text node) returns path without text leaf index', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const path = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value"><p data-node-id="0">text</p></div>';
      document.body.appendChild(container);

      const pElement = container.querySelector('p')!;
      const result = (window as any).bridge.getNodePath(pElement);

      container.remove();
      return result;
    });

    // Should not append 0 because we didn't start from text node
    expect(path).toEqual([0]);
  });

  test('node without editable field container returns null', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const path = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML = '<p data-node-id="0">No editable field marker</p>';
      document.body.appendChild(container);

      const textNode = container.querySelector('p')!.firstChild;
      const result = (window as any).bridge.getNodePath(textNode);

      container.remove();
      return result;
    });

    expect(path).toBeNull();
  });

  test('counts text nodes and elements correctly in sibling positions', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const paths = await body.evaluate(() => {
      const container = document.createElement('div');

      // Build DOM manually to ensure we get 3 child nodes
      const p = document.createElement('p');
      p.setAttribute('data-edit-text', 'value');
      p.setAttribute('data-node-id', '0');

      const text1 = document.createTextNode('text1');
      const span = document.createElement('span');
      span.setAttribute('data-node-id', '0.1');
      span.textContent = 'span';
      const text2 = document.createTextNode('text2');

      p.appendChild(text1);
      p.appendChild(span);
      p.appendChild(text2);
      container.appendChild(p);
      document.body.appendChild(container);

      const result = {
        text1: (window as any).bridge.getNodePath(text1),
        spanText: (window as any).bridge.getNodePath(span.firstChild),
        text2: (window as any).bridge.getNodePath(text2),
        childNodesCount: p.childNodes.length,
      };

      container.remove();
      return result;
    });

    expect(paths.childNodesCount).toBe(3);
    expect(paths.text1).toEqual([0, 0]);
    expect(paths.spanText).toEqual([0, 1, 0]);
    expect(paths.text2).toEqual([0, 2]); // Text at index 2, no additional nesting
  });

  test('first word bold - "This is a test" with "This" bold', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const paths = await body.evaluate(() => {
      const container = document.createElement('div');
      const p = document.createElement('p');
      p.setAttribute('data-edit-text', 'value');
      p.setAttribute('data-node-id', '0');

      const span = document.createElement('span');
      span.setAttribute('data-node-id', '0.0');
      span.textContent = 'This';

      const text = document.createTextNode(' is a test paragraph');

      p.appendChild(span);
      p.appendChild(text);
      container.appendChild(p);
      document.body.appendChild(container);

      const result = {
        boldThis: (window as any).bridge.getNodePath(span.firstChild),
        plainText: (window as any).bridge.getNodePath(text),
        childNodesCount: p.childNodes.length,
      };

      container.remove();
      return result;
    });

    expect(paths.childNodesCount).toBe(2);
    expect(paths.boldThis).toEqual([0, 0, 0]); // First span, first text
    expect(paths.plainText).toEqual([0, 1]); // Second child of paragraph
  });

  test('middle word bold - "This is a test" with "test" bold', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const paths = await body.evaluate(() => {
      const container = document.createElement('div');
      const p = document.createElement('p');
      p.setAttribute('data-edit-text', 'value');
      p.setAttribute('data-node-id', '0');

      const text1 = document.createTextNode('This is a ');
      const span = document.createElement('span');
      span.setAttribute('data-node-id', '0.1');
      span.textContent = 'test';
      const text2 = document.createTextNode(' paragraph');

      p.appendChild(text1);
      p.appendChild(span);
      p.appendChild(text2);
      container.appendChild(p);
      document.body.appendChild(container);

      const result = {
        plainTextBefore: (window as any).bridge.getNodePath(text1),
        boldTest: (window as any).bridge.getNodePath(span.firstChild),
        plainTextAfter: (window as any).bridge.getNodePath(text2),
        childNodesCount: p.childNodes.length,
      };

      container.remove();
      return result;
    });

    expect(paths.childNodesCount).toBe(3);
    expect(paths.plainTextBefore).toEqual([0, 0]); // First child
    expect(paths.boldTest).toEqual([0, 1, 0]); // Second child (span), text inside
    expect(paths.plainTextAfter).toEqual([0, 2]); // Third child
  });

  test('two bold words - "This is a test" with "This" and "test" both bold', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const paths = await body.evaluate(() => {
      const container = document.createElement('div');
      const p = document.createElement('p');
      p.setAttribute('data-edit-text', 'value');
      p.setAttribute('data-node-id', '0');

      const span1 = document.createElement('span');
      span1.setAttribute('data-node-id', '0.0');
      span1.textContent = 'This';

      const text1 = document.createTextNode(' is a ');

      const span2 = document.createElement('span');
      span2.setAttribute('data-node-id', '0.2');
      span2.textContent = 'test';

      const text2 = document.createTextNode(' paragraph');

      p.appendChild(span1);
      p.appendChild(text1);
      p.appendChild(span2);
      p.appendChild(text2);
      container.appendChild(p);
      document.body.appendChild(container);

      const result = {
        boldThis: (window as any).bridge.getNodePath(span1.firstChild),
        plainTextMiddle: (window as any).bridge.getNodePath(text1),
        boldTest: (window as any).bridge.getNodePath(span2.firstChild),
        plainTextEnd: (window as any).bridge.getNodePath(text2),
        childNodesCount: p.childNodes.length,
      };

      container.remove();
      return result;
    });

    expect(paths.childNodesCount).toBe(4);
    expect(paths.boldThis).toEqual([0, 0, 0]); // First span (index 0), text inside
    expect(paths.plainTextMiddle).toEqual([0, 1]); // Text node at index 1
    expect(paths.boldTest).toEqual([0, 2, 0]); // Second span (index 2), text inside
    expect(paths.plainTextEnd).toEqual([0, 3]); // Text node at index 3
  });

  test('parses dot notation data-node-id - "0.1" format', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const paths = await body.evaluate(() => {
      const container = document.createElement('div');
      const p = document.createElement('p');
      p.setAttribute('data-edit-text', 'value');
      p.setAttribute('data-node-id', '0');

      const span1 = document.createElement('span');
      span1.setAttribute('data-node-id', '0.1');
      span1.textContent = 'This';

      const text1 = document.createTextNode(' is a ');

      const span2 = document.createElement('span');
      span2.setAttribute('data-node-id', '0.3');
      span2.textContent = 'test';

      const text2 = document.createTextNode(' paragraph');

      p.appendChild(span1);
      p.appendChild(text1);
      p.appendChild(span2);
      p.appendChild(text2);
      container.appendChild(p);
      document.body.appendChild(container);

      const result = {
        textInFirstSpan: (window as any).bridge.getNodePath(span1.firstChild),
        textBetweenSpans: (window as any).bridge.getNodePath(text1),
        textInSecondSpan: (window as any).bridge.getNodePath(span2.firstChild),
        textAfter: (window as any).bridge.getNodePath(text2),
        childNodesCount: p.childNodes.length,
      };

      container.remove();
      return result;
    });

    expect(paths.childNodesCount).toBe(4);
    // Text inside span with data-node-id="0.1" -> path [0, 1, 0]
    expect(paths.textInFirstSpan).toEqual([0, 1, 0]);
    // Text between spans - after node at 0.1, so at Slate index 2 -> [0, 2]
    expect(paths.textBetweenSpans).toEqual([0, 2]);
    // Text inside span with data-node-id="0.3" -> path [0, 3, 0]
    expect(paths.textInSecondSpan).toEqual([0, 3, 0]);
    // Text after second span - after node at 0.3, so at Slate index 4 -> [0, 4]
    expect(paths.textAfter).toEqual([0, 4]);
  });

  test('parses dash notation data-node-id - "0.1" format', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const paths = await body.evaluate(() => {
      const container = document.createElement('div');
      const p = document.createElement('p');
      p.setAttribute('data-edit-text', 'value');
      p.setAttribute('data-node-id', '0');

      const span1 = document.createElement('span');
      span1.setAttribute('data-node-id', '0.1');
      span1.textContent = 'bold';

      const text1 = document.createTextNode(' plain ');

      const span2 = document.createElement('span');
      span2.setAttribute('data-node-id', '0.3');
      span2.textContent = 'italic';

      p.appendChild(span1);
      p.appendChild(text1);
      p.appendChild(span2);
      container.appendChild(p);
      document.body.appendChild(container);

      const result = {
        boldText: (window as any).bridge.getNodePath(span1.firstChild),
        plainText: (window as any).bridge.getNodePath(text1),
        italicText: (window as any).bridge.getNodePath(span2.firstChild),
      };

      container.remove();
      return result;
    });

    expect(paths.boldText).toEqual([0, 1, 0]);
    expect(paths.plainText).toEqual([0, 2]);
    expect(paths.italicText).toEqual([0, 3, 0]);
  });

  test('complex scenario - multiple formatted regions with gaps', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const paths = await body.evaluate(() => {
      const container = document.createElement('div');
      const p = document.createElement('p');
      p.setAttribute('data-edit-text', 'value');
      p.setAttribute('data-node-id', '0');

      // <span data-node-id="0.1">This</span>
      const span1 = document.createElement('span');
      span1.setAttribute('style', 'font-weight: bold');
      span1.setAttribute('data-node-id', '0.1');
      span1.textContent = 'This';

      // " is a "
      const text1 = document.createTextNode(' is a ');

      // <span data-node-id="0.3">test</span>
      const span2 = document.createElement('span');
      span2.setAttribute('style', 'font-weight: bold');
      span2.setAttribute('data-node-id', '0.3');
      span2.textContent = 'test';

      // " paragraph"
      const text2 = document.createTextNode(' paragraph');

      p.appendChild(span1);
      p.appendChild(text1);
      p.appendChild(span2);
      p.appendChild(text2);
      container.appendChild(p);
      document.body.appendChild(container);

      // Test paths for all positions
      const result = {
        // Cursor in "This" (bold)
        inThis: (window as any).bridge.getNodePath(span1.firstChild),
        // Cursor in " is a " (plain)
        inPlain: (window as any).bridge.getNodePath(text1),
        // Cursor in "test" (bold)
        inTest: (window as any).bridge.getNodePath(span2.firstChild),
        // Cursor in " paragraph" (plain)
        inParagraph: (window as any).bridge.getNodePath(text2),
      };

      container.remove();
      return result;
    });

    // These are the paths that should make isActive work correctly
    expect(paths.inThis).toEqual([0, 1, 0]); // Bold - isActive should be true
    expect(paths.inPlain).toEqual([0, 2]); // Plain - isActive should be false
    expect(paths.inTest).toEqual([0, 3, 0]); // Bold - isActive should be true
    expect(paths.inParagraph).toEqual([0, 4]); // Plain - isActive should be false
  });

  test('handles whitespace text nodes in sibling counting', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const paths = await body.evaluate(() => {
      const container = document.createElement('div');
      const p = document.createElement('p');
      p.setAttribute('data-edit-text', 'value');
      p.setAttribute('data-node-id', '0');

      const span1 = document.createElement('span');
      span1.setAttribute('data-node-id', '0.0');
      span1.textContent = 'a';

      const whitespace = document.createTextNode('\n  ');

      const span2 = document.createElement('span');
      span2.setAttribute('data-node-id', '0.1');
      span2.textContent = 'b';

      p.appendChild(span1);
      p.appendChild(whitespace);
      p.appendChild(span2);
      container.appendChild(p);
      document.body.appendChild(container);

      // Get references to the actual nodes we appended
      const ws = p.childNodes[1];

      const result = {
        span1Text: (window as any).bridge.getNodePath(span1.firstChild),
        whitespace: (window as any).bridge.getNodePath(ws),
        span2Text: (window as any).bridge.getNodePath(span2.firstChild),
        childNodesCount: p.childNodes.length,
      };

      container.remove();
      return result;
    });

    // span1's text is at [0, 0, 0] - from data-node-id="0.0"
    // whitespace is at [0, 1] - Slate index based on sibling with data-node-id="0.0"
    // span2's text is at [0, 1, 0] - from data-node-id="0.1" (NOT DOM position!)
    // Note: getNodePath uses data-node-id to derive path, not DOM position
    expect(paths.childNodesCount).toBe(3);
    expect(paths.span1Text).toEqual([0, 0, 0]);
    expect(paths.whitespace).toEqual([0, 1]); // Slate index from previous sibling's data-node-id
    expect(paths.span2Text).toEqual([0, 1, 0]); // Path from data-node-id="0.1"
  });

  test('empty paragraph with placeholder BR', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const path = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p data-edit-text="value" data-node-id="0"><br></p>';
      document.body.appendChild(container);

      const brElement = container.querySelector('br');
      const result = (window as any).bridge.getNodePath(brElement);

      container.remove();
      return result;
    });

    // BR element walks up to find parent with data-node-id, returns [0]
    expect(path).toEqual([0]);
  });

  test('deeply nested structure', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const path = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value"><div><div><p data-node-id="0">text</p></div></div></div>';
      document.body.appendChild(container);

      const textNode = container.querySelector('p')!.firstChild;
      const result = (window as any).bridge.getNodePath(textNode);

      container.remove();
      return result;
    });

    // Only elements with data-node-id are counted
    expect(path).toEqual([0, 0]);
  });

  test('text wrapped in span WITHOUT nodeId inside strong', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const path = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="1">' +
        '<strong data-node-id="1.1"><span>Disclaimer</span></strong>' +
        '</p>' +
        '</div>';
      document.body.appendChild(container);

      const textNode = container.querySelector('strong span')!.firstChild;
      const result = (window as any).bridge.getNodePath(textNode);

      container.remove();
      return result;
    });

    // Span without nodeId should be skipped, path from strong is [1, 1, 0]
    expect(path).toEqual([1, 1, 0]);
  });

  test('plain text directly in strong (no wrapper span)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const path = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="1">' +
        '<strong data-node-id="1.1">Disclaimer</strong>' +
        '</p>' +
        '</div>';
      document.body.appendChild(container);

      const textNode = container.querySelector('strong')!.firstChild;
      const result = (window as any).bridge.getNodePath(textNode);

      container.remove();
      return result;
    });

    expect(path).toEqual([1, 1, 0]);
  });

  test('double wrapper with same node-id', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const path = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p data-edit-text="value" data-node-id="0">' +
        '<strong data-node-id="0.0"><em data-node-id="0.0">styled text</em></strong>' +
        '</p>';
      document.body.appendChild(container);

      const textNode = container.querySelector('em')!.firstChild;
      const result = (window as any).bridge.getNodePath(textNode);

      container.remove();
      return result;
    });

    // Both wrappers have same node-id "0.0", path should be [0, 0, 0]
    expect(path).toEqual([0, 0, 0]);
  });

  test('double wrapper with text before and after', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const paths = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p data-edit-text="value" data-node-id="0">' +
        'before <strong data-node-id="0.1"><em data-node-id="0.1">bold</em></strong> after' +
        '</p>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const beforeText = p.firstChild;
      const boldText = container.querySelector('em')!.firstChild;
      const afterText = p.lastChild;

      const result = {
        before: (window as any).bridge.getNodePath(beforeText),
        bold: (window as any).bridge.getNodePath(boldText),
        after: (window as any).bridge.getNodePath(afterText),
      };

      container.remove();
      return result;
    });

    expect(paths.before).toEqual([0, 0]);
    expect(paths.bold).toEqual([0, 1, 0]);
    expect(paths.after).toEqual([0, 2]);
  });

  test('production bug - empty text + strong + text AFTER', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const path = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">First paragraph</p>' +
        '<p data-node-id="1"><strong data-node-id="1.1">Disclaimer</strong>: This instance is reset every night</p>' +
        '</div>';
      document.body.appendChild(container);

      const p = container.querySelectorAll('p')[1];
      const textAfterStrong = p.lastChild;
      const result = (window as any).bridge.getNodePath(textAfterStrong);

      container.remove();
      return result;
    });

    // Text after strong (node-id 1.1) should be at Slate index 2 (1+1)
    expect(path).toEqual([1, 2]);
  });

  test('text wrapped in spans (Nuxt wrapper scenario)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const path = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">First paragraph</p>' +
        '<p data-node-id="1">' +
        '<span></span>' +
        '<strong data-node-id="1.1">Disclaimer</strong>' +
        '<span>: This instance is reset every night</span>' +
        '</p>' +
        '</div>';
      document.body.appendChild(container);

      const p = container.querySelectorAll('p')[1];
      const lastSpan = p.lastElementChild as HTMLElement;
      const textInSpan = lastSpan.firstChild;
      const result = (window as any).bridge.getNodePath(textInSpan);

      container.remove();
      return result;
    });

    // Text inside wrapper span without nodeId resolves to parent's position
    expect(path).toEqual([1, 2]);
  });

  test('list with links - li and link HAVE nodeId', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const path = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<ul class="list-disc">' +
        '<li data-node-id="0.0"><span></span><a data-node-id="0.0.1" href="#"><span>NUXT.js Example</span></a><span></span></li>' +
        '</ul>' +
        '</div>';
      document.body.appendChild(container);

      const linkSpan = container.querySelector('a span')!;
      const textNode = linkSpan.firstChild;
      const result = (window as any).bridge.getNodePath(textNode);

      container.remove();
      return result;
    });

    // Expected: [0, 0, 1, 0] - text inside link at [0, 0, 1]
    expect(path).toEqual([0, 0, 1, 0]);
  });

  test('text BEFORE bold + bold + text AFTER (Nuxt structure)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const path = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">' +
        'This text appears after the slider. Click on ' +
        '<strong data-node-id="0.1">bold text</strong>' +
        ' to test getNodePath.' +
        '</p>' +
        '</div>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const textAfterBold = p.lastChild;
      const result = (window as any).bridge.getNodePath(textAfterBold);

      container.remove();
      return result;
    });

    // Expected path for clicking on last text: [0, 2]
    expect(path).toEqual([0, 2]);
  });

  test('whitespace text node before p in container (Vue template artifact)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      // Use the injected helper that preserves whitespace text nodes
      const fragment = (window as any).preserveWhitespaceDOM(
        '<div id="test-whitespace-container" data-edit-text="value">\n' +
        '  <p data-node-id="0">Hello world</p>\n' +
        '</div>'
      );
      document.body.appendChild(fragment);

      const container = document.getElementById('test-whitespace-container')!;
      const whitespaceNode = container.firstChild as Text;
      const bridge = (window as any).bridge;

      const isTextNode = whitespaceNode?.nodeType === Node.TEXT_NODE;
      const textContent = whitespaceNode?.textContent;

      // Test isOnInvalidWhitespace detection
      const isInvalid = bridge.isOnInvalidWhitespace(whitespaceNode);

      // Test cursor correction: set cursor on whitespace, then correct it
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.setStart(whitespaceNode, 0);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);

      // Cursor should now be on whitespace
      const cursorBeforeCorrection = selection.anchorNode;

      // Correct the selection
      bridge.correctInvalidWhitespaceSelection();

      // After correction, cursor should be in the first text node inside the p
      const cursorAfterCorrection = selection.anchorNode;
      const offsetAfterCorrection = selection.anchorOffset;
      const cursorInValidNode = cursorAfterCorrection?.parentElement?.hasAttribute('data-node-id');

      container.remove();

      return {
        isTextNode,
        textContent,
        isInvalid,
        cursorWasOnWhitespace: cursorBeforeCorrection === whitespaceNode,
        cursorInValidNode,
        offsetAfterCorrection,
      };
    });

    expect(result.isTextNode).toBe(true);
    expect(result.textContent).toBe('\n  ');
    expect(result.isInvalid).toBe(true);
    expect(result.cursorWasOnWhitespace).toBe(true);
    // After correction, cursor should be in a valid node (inside element with data-node-id)
    expect(result.cursorInValidNode).toBe(true);
    expect(result.offsetAfterCorrection).toBe(0); // Start of first text node
  });

  test('range selection on whitespace nodes preserves selection span', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      // Create DOM with whitespace before and after content (Vue template artifacts)
      const fragment = (window as any).preserveWhitespaceDOM(
        '<div id="test-range-whitespace" data-edit-text="value">\n' +
        '  <p data-node-id="0">Grid Cell 2</p>\n' +
        '</div>'
      );
      document.body.appendChild(fragment);

      const container = document.getElementById('test-range-whitespace')!;
      const p = container.querySelector('p')!;
      const whitespaceNodeBefore = container.firstChild as Text;
      const whitespaceNodeAfter = container.lastChild as Text;
      const bridge = (window as any).bridge;

      // Both should be invalid whitespace
      const beforeIsInvalid = bridge.isOnInvalidWhitespace(whitespaceNodeBefore);
      const afterIsInvalid = bridge.isOnInvalidWhitespace(whitespaceNodeAfter);

      // Set a RANGE selection from whitespace before to whitespace after
      // This simulates "select all" when Vue has whitespace artifacts
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.setStart(whitespaceNodeBefore, 0);
      range.setEnd(whitespaceNodeAfter, whitespaceNodeAfter.length);
      selection.removeAllRanges();
      selection.addRange(range);

      const selectionBeforeCorrection = selection.toString();

      // Correct the selection
      bridge.correctInvalidWhitespaceSelection();

      // After correction, selection should span the actual content
      const selectionAfterCorrection = selection.toString();
      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      const anchorOffset = selection.anchorOffset;
      const focusOffset = selection.focusOffset;

      container.remove();

      return {
        beforeIsInvalid,
        afterIsInvalid,
        selectionBeforeCorrection,
        selectionAfterCorrection,
        anchorInP: p.contains(anchorNode),
        focusInP: p.contains(focusNode),
        anchorOffset,
        focusOffset,
        expectedText: 'Grid Cell 2',
      };
    });

    expect(result.beforeIsInvalid).toBe(true);
    expect(result.afterIsInvalid).toBe(true);
    // After correction, selection should contain the text content
    expect(result.selectionAfterCorrection).toBe(result.expectedText);
    // Anchor should be at start (offset 0), focus at end (offset 11)
    expect(result.anchorInP).toBe(true);
    expect(result.focusInP).toBe(true);
    expect(result.anchorOffset).toBe(0);
    expect(result.focusOffset).toBe(11); // "Grid Cell 2".length
  });

  test('element-based selection on editable field with nodeId children needs correction', async () => {
    // When cursor lands on edit-text container (not inside data-node-id children),
    // it needs to be corrected so typing goes into the right place.
    // This happens when clicking at the edge of a block or after add button creates new block.
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.id = 'test-element-selection';
      container.setAttribute('data-edit-text', 'value');
      container.innerHTML = '<p data-node-id="0">Grid Cell 2</p>';
      document.body.appendChild(container);

      const bridge = (window as any).bridge;

      // Check if the editable field ELEMENT is flagged as invalid whitespace
      // It SHOULD be flagged - cursor needs to move inside data-node-id children
      const elementIsInvalid = bridge.isOnInvalidWhitespace(container);

      // Also check that a valid text node inside is not flagged
      const textNode = container.querySelector('p')?.firstChild;
      const textIsInvalid = bridge.isOnInvalidWhitespace(textNode);

      container.remove();

      return {
        elementIsInvalid,
        textIsInvalid,
      };
    });

    // Container with nodeId children IS invalid - cursor needs correction into children
    expect(result.elementIsInvalid).toBe(true);
    // Text inside a data-node-id element is valid
    expect(result.textIsInvalid).toBe(false);
  });

  test('isOnInvalidWhitespace: ZWS after inline element is valid when parent has data-node-id', async () => {
    // After cursor exit from bold (prospective formatting toggle off), a ZWS is created
    // as a direct child of the paragraph. This ZWS should NOT be flagged as invalid
    // whitespace, even though the paragraph is also the editable field.
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      // Structure after typing "Hello ", bold "world", then toggling bold off:
      // <p data-edit-text="value" data-node-id="0">
      //   "Hello "
      //   <span data-node-id="0.1"><strong>world</strong></span>
      //   "﻿"  <-- ZWS for cursor positioning after cursor exit
      // </p>
      const container = document.createElement('p');
      container.id = 'test-cursor-exit-zws';
      container.setAttribute('data-edit-text', 'value');
      container.setAttribute('data-node-id', '0');

      // Create the structure
      const helloText = document.createTextNode('Hello ');
      const span = document.createElement('span');
      span.setAttribute('data-node-id', '0.1');
      const strong = document.createElement('strong');
      strong.textContent = 'world';
      span.appendChild(strong);
      const zwsText = document.createTextNode('\uFEFF'); // ZWS for cursor positioning

      container.appendChild(helloText);
      container.appendChild(span);
      container.appendChild(zwsText);
      document.body.appendChild(container);

      const bridge = (window as any).bridge;

      // The ZWS text node should NOT be flagged as invalid whitespace
      // because its parent (the <p>) has data-node-id
      const zwsIsInvalid = bridge.isOnInvalidWhitespace(zwsText);

      // Also verify "Hello " text is valid
      const helloIsInvalid = bridge.isOnInvalidWhitespace(helloText);

      container.remove();

      return {
        zwsIsInvalid,
        helloIsInvalid,
      };
    });

    // ZWS after inline element should be valid (for cursor positioning)
    expect(result.zwsIsInvalid).toBe(false);
    // Regular text in paragraph is also valid
    expect(result.helloIsInvalid).toBe(false);
  });

  test('serializePoint handles element-based selection with Vue empty text nodes', async () => {
    // When selectText() is used, the selection may resolve to empty Vue text nodes
    // serializePoint should find the valid text nodes inside data-node-id elements
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      // Create DOM like Nuxt renders with Vue template whitespace artifacts
      const fragment = (window as any).preserveWhitespaceDOM(
        '<div id="test-serialize-element" data-edit-text="value">\n' +
        '  <p data-node-id="0">Grid Cell 2</p>\n' +
        '</div>'
      );
      document.body.appendChild(fragment);

      const container = document.getElementById('test-serialize-element')!;
      const bridge = (window as any).bridge;

      // Set element-based selection like selectText() does
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.setStart(container, 0); // Before first child (whitespace text node)
      range.setEnd(container, container.childNodes.length); // After last child
      selection.removeAllRanges();
      selection.addRange(range);

      // Try to serialize - should find valid text nodes inside P
      const serialized = bridge.serializeSelection();

      container.remove();

      return {
        serialized,
        hasAnchor: serialized?.anchor != null,
        hasFocus: serialized?.focus != null,
        anchorPath: serialized?.anchor?.path,
        focusPath: serialized?.focus?.path,
        anchorOffset: serialized?.anchor?.offset,
        focusOffset: serialized?.focus?.offset,
      };
    });

    // Serialization should succeed (not return null)
    expect(result.serialized).not.toBeNull();
    expect(result.hasAnchor).toBe(true);
    expect(result.hasFocus).toBe(true);
    // Path should be [0, 0] - first paragraph, first text child
    expect(result.anchorPath).toEqual([0, 0]);
    expect(result.focusPath).toEqual([0, 0]);
    // Anchor at start (offset 0), focus at end (offset 11 = "Grid Cell 2".length)
    expect(result.anchorOffset).toBe(0);
    expect(result.focusOffset).toBe(11);
  });

  test('text BEFORE bold + bold + text AFTER with Vue whitespace', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const path = await body.evaluate(() => {
      const fragment = (window as any).preserveWhitespaceDOM(
        '<div id="test-vue-whitespace" data-edit-text="value">\n' +
        '  <p data-node-id="0">\n' +
        '    This text appears after the slider. Click on \n' +
        '    <strong data-node-id="0.1">bold text</strong>\n' +
        '     to test getNodePath.\n' +
        '  </p>\n' +
        '</div>'
      );
      document.body.appendChild(fragment);

      const container = document.getElementById('test-vue-whitespace')!;
      const p = container.querySelector('p')!;
      // Find the actual text node containing "to test" (not whitespace artifacts)
      const textAfterBold = Array.from(p.childNodes).find(
        (n: any) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes('to test')
      );

      const result = (window as any).bridge.getNodePath(textAfterBold);

      container.remove();

      return result;
    });

    // With range.toString() normalization, path should be [0, 2]
    expect(path).toEqual([0, 2]);
  });

  test('text with leading whitespace INSIDE strong returns correct path', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      // Two strongs with Vue template whitespace
      const fragment = (window as any).preserveWhitespaceDOM(
        '<div id="test-leading-whitespace" data-edit-text="value">\n' +
        '  <p data-node-id="0">\n' +
        '    This text appears after the \n' +
        '    <strong data-node-id="0.1">slider</strong>\n' +
        '    . Click on \n' +
        '    <strong data-node-id="0.3">\n      bold text\n    </strong>\n' +
        '     to test getNodePath.\n' +
        '  </p>\n' +
        '</div>'
      );
      document.body.appendChild(fragment);

      const container = document.getElementById('test-leading-whitespace')!;
      // Find text inside the second strong - includes leading/trailing whitespace
      const strong2 = container.querySelectorAll('strong')[1];
      const textInStrong = strong2.firstChild;

      const isTextNode = textInStrong?.nodeType === Node.TEXT_NODE;
      const textContent = (textInStrong as Text)?.textContent;
      const path = (window as any).bridge.getNodePath(textInStrong);

      container.remove();

      return { isTextNode, textContent, path };
    });

    expect(result.isTextNode).toBe(true);
    // The text includes template whitespace
    expect(result.textContent).toBe('\n      bold text\n    ');
    // Even with leading whitespace, should resolve to [0, 3, 0]
    expect(result.path).toEqual([0, 3, 0]);
  });
});

test.describe('getNodeIdFromPath() - Slate path to DOM nodeId conversion (real hydra.js)', () => {
  let helper: AdminUIHelper;

  test.beforeEach(async ({ page }) => {
    helper = new AdminUIHelper(page);

    // Load the mock parent page which initializes the real hydra.js bridge
    await page.goto(`${URLS.testFrontend}/mock-parent.html`);
    await helper.waitForIframeReady();
    await helper.waitForIframeBlockHandle('mock-block-1');

    // Inject helper for creating DOM with preserved whitespace
    await helper.injectPreserveWhitespaceHelper();
  });

  test('path to text node returns parent nodeId', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // Slate structure: [{type: 'p', children: [{text: 'Hello'}], nodeId: '0'}]
    // Path [0, 0] points to the text node
    const result = await body.evaluate(() => {
      const slateValue = [
        { type: 'p', children: [{ text: 'Hello' }], nodeId: '0' },
      ];
      return (window as any).bridge.getNodeIdFromPath(slateValue, [0, 0]);
    });

    expect(result.nodeId).toBe('0');
    expect(result.textChildIndex).toBe(0);
  });

  test('path to inline element returns its nodeId', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const slateValue = [
        {
          type: 'p',
          children: [
            { text: 'Hello ' },
            { type: 'strong', children: [{ text: 'world' }], nodeId: '0.1' },
          ],
          nodeId: '0',
        },
      ];
      return (window as any).bridge.getNodeIdFromPath(slateValue, [0, 1]);
    });

    // Inline element has its own nodeId, textChildIndex is null (not a text node)
    expect(result.nodeId).toBe('0.1');
    expect(result.textChildIndex).toBeNull();
  });

  test('path [0,2] to empty text node after inline element returns parent nodeId', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // This tests the case where Slate has an empty text node after an inline element
    // Path [0, 2] points to the empty text node AFTER the strong
    const result = await body.evaluate(() => {
      const slateValue = [
        {
          type: 'p',
          children: [
            { text: 'Hello ' },
            { type: 'strong', children: [{ text: 'world' }], nodeId: '0.1' },
            { text: '' }, // Empty text node at index 2
          ],
          nodeId: '0',
        },
      ];

      // Get nodeId for path [0, 2] (the empty text node)
      return (window as any).bridge.getNodeIdFromPath(slateValue, [0, 2]);
    });

    // Text nodes return parent's nodeId, with textChildIndex indicating position
    expect(result.nodeId).toBe('0');
    expect(result.textChildIndex).toBe(2);
  });

  test('BUG: selection restoration for path [0,2] offset 0 should position after inline element', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // This test demonstrates the selection restoration bug:
    // - Slate has: "Hello " + <strong>world</strong> + "" (empty text at index 2)
    // - User toggles bold off, cursor should be AFTER "world"
    // - Slate selection: path [0, 2], offset 0
    // - Current bug: cursor ends up at start of "Hello " instead of after "world"

    const result = await body.evaluate(() => {
      const container = document.createElement('div');

      // Build DOM: <p data-node-id="test-0">Hello <span data-node-id="test-0.1">world</span></p>
      // Note: empty text node at Slate index 2 doesn't render in DOM
      // Using unique nodeIds to avoid collision with existing mock content
      const p = document.createElement('p');
      p.setAttribute('data-edit-text', 'value');
      p.setAttribute('data-node-id', 'test-0');

      const text1 = document.createTextNode('Hello ');
      const span = document.createElement('span');
      span.setAttribute('data-node-id', 'test-0.1');
      span.textContent = 'world';

      p.appendChild(text1);
      p.appendChild(span);
      container.appendChild(p);
      document.body.appendChild(container);

      // Slate value with empty text node at index 2
      const slateValue = [
        {
          type: 'p',
          children: [
            { text: 'Hello ' },
            { type: 'strong', children: [{ text: 'world' }], nodeId: 'test-0.1' },
            { text: '' }, // Empty text at index 2 - this is where cursor should be
          ],
          nodeId: 'test-0',
        },
      ];

      // Slate selection after toggling bold off: path [0, 2], offset 0
      const slateSelection = {
        anchor: { path: [0, 2], offset: 0 },
        focus: { path: [0, 2], offset: 0 },
      };

      // getNodeIdFromPath now returns {nodeId, textChildIndex, parentChildren}
      const nodeIdResult = (window as any).bridge.getNodeIdFromPath(
        slateValue,
        slateSelection.anchor.path
      );

      // Find the DOM element
      const element = document.querySelector('[data-node-id="' + nodeIdResult.nodeId + '"]');

      // Use calculateAbsoluteOffset to get the correct offset
      // This should sum text from all children before the target child
      let absoluteOffset = slateSelection.anchor.offset;
      if (nodeIdResult.textChildIndex !== null && nodeIdResult.parentChildren) {
        absoluteOffset = (window as any).bridge.calculateAbsoluteOffset(
          nodeIdResult.parentChildren,
          nodeIdResult.textChildIndex,
          slateSelection.anchor.offset
        );
      }

      // Now find the text node with the correct absolute offset
      const textResult = (window as any).bridge.findPositionByVisibleOffset(element, absoluteOffset);

      container.remove();

      return {
        // The fixed behavior using calculateAbsoluteOffset
        foundText: textResult?.node?.textContent,
        foundOffset: textResult?.offset,
        // Debug info
        nodeIdResult: nodeIdResult,
        calculatedAbsoluteOffset: absoluteOffset,
      };
    });

    console.log('Found:', result.foundText, 'at offset', result.foundOffset);
    console.log('Absolute offset calculated:', result.calculatedAbsoluteOffset);

    // After the fix: cursor should be at end of "world" (offset 5)
    // calculateAbsoluteOffset([{text:"Hello "}, {strong...}, {text:""}], 2, 0) = 6 + 5 + 0 = 11
    expect(result.calculatedAbsoluteOffset).toBe(11); // 6 ("Hello ") + 5 ("world") = 11
    expect(result.foundText).toBe('world');
    expect(result.foundOffset).toBe(5); // End of "world"
  });

  test('getNodeIdFromPath with text inside nested inline element', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const slateValue = [
        {
          type: 'p',
          children: [
            { text: 'Normal ' },
            {
              type: 'strong',
              children: [
                {
                  type: 'em',
                  children: [{ text: 'bold-italic' }],
                  nodeId: '0.1.0',
                },
              ],
              nodeId: '0.1',
            },
            { text: ' end' },
          ],
          nodeId: '0',
        },
      ];

      return {
        // Path to text node inside nested em
        nestedText: (window as any).bridge.getNodeIdFromPath(slateValue, [0, 1, 0, 0]),
        // Path to em element
        emElement: (window as any).bridge.getNodeIdFromPath(slateValue, [0, 1, 0]),
        // Path to strong element
        strongElement: (window as any).bridge.getNodeIdFromPath(slateValue, [0, 1]),
        // Path to trailing text
        trailingText: (window as any).bridge.getNodeIdFromPath(slateValue, [0, 2]),
      };
    });

    // Text inside em uses em's nodeId
    expect(result.nestedText.nodeId).toBe('0.1.0');
    expect(result.nestedText.textChildIndex).toBe(0);
    // em element has its own nodeId (not a text node)
    expect(result.emElement.nodeId).toBe('0.1.0');
    expect(result.emElement.textChildIndex).toBeNull();
    // strong element has its own nodeId
    expect(result.strongElement.nodeId).toBe('0.1');
    expect(result.strongElement.textChildIndex).toBeNull();
    // Trailing text uses paragraph's nodeId
    expect(result.trailingText.nodeId).toBe('0');
    expect(result.trailingText.textChildIndex).toBe(2);
  });

  test('getNodeIdFromPath returns null for invalid path', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const slateValue = [
        { type: 'p', children: [{ text: 'Hello' }], nodeId: '0' },
      ];
      return (window as any).bridge.getNodeIdFromPath(slateValue, [0, 5]); // Index 5 doesn't exist
    });

    expect(result).toBeNull();
  });

  // ZWS-specific tests for cursor exit scenarios
  test('ZWS text node after inline element returns correct path', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const paths = await body.evaluate(() => {
      const fragment = (window as any).preserveWhitespaceDOM(
        '<div id="test-zws-after" data-edit-text="value">' +
        '<p data-node-id="0">Hello <span data-node-id="0.1">world</span>\uFEFF</p>' +
        '</div>'
      );
      document.body.appendChild(fragment);

      const container = document.getElementById('test-zws-after')!;
      const p = container.querySelector('p')!;
      const span = p.querySelector('span')!;

      const result = {
        helloText: (window as any).bridge.getNodePath(p.childNodes[0]),
        worldText: (window as any).bridge.getNodePath(span.firstChild),
        zwsText: (window as any).bridge.getNodePath(p.childNodes[2]),
        childNodesCount: p.childNodes.length,
      };

      container.remove();
      return result;
    });

    expect(paths.childNodesCount).toBe(3);
    expect(paths.helloText).toEqual([0, 0]);
    expect(paths.worldText).toEqual([0, 1, 0]);
    // ZWS after span should be at index 2 (third child of paragraph)
    expect(paths.zwsText).toEqual([0, 2]);
  });

  test('ZWS inside empty inline element (prospective formatting)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const paths = await body.evaluate(() => {
      const fragment = (window as any).preserveWhitespaceDOM(
        '<div id="test-zws-inside" data-edit-text="value">' +
        '<p data-node-id="0">Hello <span data-node-id="0.1">\uFEFF</span></p>' +
        '</div>'
      );
      document.body.appendChild(fragment);

      const container = document.getElementById('test-zws-inside')!;
      const p = container.querySelector('p')!;
      const span = p.querySelector('span')!;

      const result = {
        helloText: (window as any).bridge.getNodePath(p.childNodes[0]),
        zwsInsideSpan: (window as any).bridge.getNodePath(span.firstChild),
        childNodesCount: p.childNodes.length,
      };

      container.remove();
      return result;
    });

    expect(paths.childNodesCount).toBe(2);
    expect(paths.helloText).toEqual([0, 0]);
    // ZWS inside span should have path inside the span element
    expect(paths.zwsInsideSpan).toEqual([0, 1, 0]);
  });

  test('ZWS + typed text inside span with ZWS after (cursor exit scenario)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const paths = await body.evaluate(() => {
      const fragment = (window as any).preserveWhitespaceDOM(
        '<div id="test-zws-both" data-edit-text="value">' +
        '<p data-node-id="0">Hello <span data-node-id="0.1">\uFEFFworld</span>\uFEFF</p>' +
        '</div>'
      );
      document.body.appendChild(fragment);

      const container = document.getElementById('test-zws-both')!;
      const p = container.querySelector('p')!;
      const span = p.querySelector('span')!;

      const result = {
        helloText: (window as any).bridge.getNodePath(p.childNodes[0]),
        zwsPlusWorldText: (window as any).bridge.getNodePath(span.firstChild),
        zwsAfterSpan: (window as any).bridge.getNodePath(p.childNodes[2]),
        childNodesCount: p.childNodes.length,
      };

      container.remove();
      return result;
    });

    expect(paths.childNodesCount).toBe(3);
    expect(paths.helloText).toEqual([0, 0]);
    // Text with ZWS prefix inside span should have path inside the span
    expect(paths.zwsPlusWorldText).toEqual([0, 1, 0]);
    // ZWS after span should be at index 2
    expect(paths.zwsAfterSpan).toEqual([0, 2]);
  });

  test('isOnInvalidWhitespace: element node inside block but outside data-node-id is invalid', async () => {
    // When clicking at the edge of a block, the cursor may land on the wrapper DIV
    // instead of inside the P element with data-node-id. This should be flagged as
    // invalid so correctInvalidWhitespaceSelection can fix it.
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      // Structure: block wrapper DIV containing editable P with data-node-id
      // <div data-block-uid="test-block">
      //   <p data-edit-text="value" data-node-id="0">Hello</p>
      // </div>
      const wrapper = document.createElement('div');
      wrapper.id = 'test-element-outside-nodeid';
      wrapper.setAttribute('data-block-uid', 'test-block');
      wrapper.innerHTML = '<p data-edit-text="value" data-node-id="0">Hello</p>';
      document.body.appendChild(wrapper);

      const bridge = (window as any).bridge;
      const p = wrapper.querySelector('p')!;

      // Test the wrapper DIV - cursor lands here when clicking at edge of block
      // This is inside the block but outside data-node-id, should be invalid
      const wrapperIsInvalid = bridge.isOnInvalidWhitespace(wrapper);

      // Test the P element - has data-node-id, should be valid
      const pIsInvalid = bridge.isOnInvalidWhitespace(p);

      // Test text node inside P - should be valid
      const textNode = p.firstChild;
      const textIsInvalid = bridge.isOnInvalidWhitespace(textNode);

      wrapper.remove();

      return {
        wrapperIsInvalid,
        pIsInvalid,
        textIsInvalid,
      };
    });

    // Wrapper DIV is inside block but outside data-node-id - should be INVALID
    // so the cursor can be corrected to a valid position inside the P
    expect(result.wrapperIsInvalid).toBe(true);
    // P element has data-node-id - should be valid
    expect(result.pIsInvalid).toBe(false);
    // Text inside P is valid
    expect(result.textIsInvalid).toBe(false);
  });

  test('serializePoint excludes ZWS from offset calculation', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // Simulate cursor exit scenario: ZWS is prepended to text node after inline element
    // DOM: "Hello " + <strong>bold</strong> + [ZWS + " normal"]
    // Slate: "Hello " + strong + " normal" (no ZWS)
    // When cursor is at end, offset should be 7 (length of " normal"), not 8
    const result = await body.evaluate(() => {
      const fragment = (window as any).preserveWhitespaceDOM(
        '<div id="test-serialize-zws" data-block-uid="test-block" data-edit-text="value">' +
        '<p data-node-id="0">Hello <strong data-node-id="0.1">bold</strong>\uFEFF normal</p>' +
        '</div>'
      );
      document.body.appendChild(fragment);

      const container = document.getElementById('test-serialize-zws')!;
      const p = container.querySelector('p')!;
      // The text node after strong: ZWS + " normal"
      const textNodeAfterStrong = p.childNodes[2];

      // Place cursor at end of this text node (after " normal", position 8 in DOM)
      const range = document.createRange();
      range.setStart(textNodeAfterStrong, 8); // After ZWS + " normal"
      range.setEnd(textNodeAfterStrong, 8);

      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      const bridge = (window as any).bridge;
      const serialized = bridge.serializeSelection();

      container.remove();

      return {
        serialized,
        domTextLength: textNodeAfterStrong.textContent?.length,
        anchorOffset: serialized?.anchor?.offset,
        focusOffset: serialized?.focus?.offset,
      };
    });

    // DOM text is 8 chars (ZWS + " normal")
    expect(result.domTextLength).toBe(8);
    // But serialized offset should be 7 (excluding ZWS)
    expect(result.anchorOffset).toBe(7);
    expect(result.focusOffset).toBe(7);
  });
});
