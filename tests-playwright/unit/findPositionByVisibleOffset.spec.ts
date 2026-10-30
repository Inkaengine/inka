/**
 * Unit tests for findPositionByVisibleOffset() - Range-based position finding
 * Uses real browser Range API which jsdom cannot properly simulate
 */

import { test, expect, URLS } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('findPositionByVisibleOffset() - Range-based position finding', () => {
  let helper: AdminUIHelper;

  test.beforeEach(async ({ page }) => {
    helper = new AdminUIHelper(page);
    await page.goto(`${URLS.testFrontend}/mock-parent.html`);
    await helper.waitForIframeReady();
    await helper.waitForIframeBlockHandle('mock-block-1');
    // Inject helper for creating DOM with preserved whitespace (Vue/Nuxt template artifacts)
    await helper.injectPreserveWhitespaceHelper();
  });

  test('finds position at offset 0', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">hello world</p>' +
        '</div>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const result = (window as any).bridge.findPositionByVisibleOffset(p, 0);

      container.remove();

      return {
        text: result?.node?.textContent,
        offset: result?.offset,
      };
    });

    expect(result.text).toBe('hello world');
    expect(result.offset).toBe(0);
  });

  test('finds position in middle of text', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">hello world</p>' +
        '</div>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const result = (window as any).bridge.findPositionByVisibleOffset(p, 5);

      container.remove();

      return {
        text: result?.node?.textContent,
        offset: result?.offset,
      };
    });

    expect(result.text).toBe('hello world');
    expect(result.offset).toBe(5);
  });

  test('skips empty text nodes using browser text model', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<strong data-node-id="0.1"></strong>' +
        '</div>';
      document.body.appendChild(container);

      const strong = container.querySelector('strong')!;
      strong.appendChild(document.createTextNode('')); // Empty - ignored by Range
      strong.appendChild(document.createTextNode('test'));

      const result = (window as any).bridge.findPositionByVisibleOffset(strong, 2);

      container.remove();

      return {
        text: result?.node?.textContent,
        offset: result?.offset,
      };
    });

    expect(result.text).toBe('test');
    expect(result.offset).toBe(2);
  });

  test('handles multiple text nodes', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0"></p>' +
        '</div>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      p.appendChild(document.createTextNode('hello'));
      p.appendChild(document.createTextNode(' '));
      p.appendChild(document.createTextNode('world'));

      // Offset 7 should be in "world" (after "hello " = 6 chars)
      const result = (window as any).bridge.findPositionByVisibleOffset(p, 7);

      container.remove();

      return {
        text: result?.node?.textContent,
        offset: result?.offset,
      };
    });

    expect(result.text).toBe('world');
    expect(result.offset).toBe(1); // 7 - 6 = 1
  });

  test('returns end of last text node for offset at end', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">test</p>' +
        '</div>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const result = (window as any).bridge.findPositionByVisibleOffset(p, 4);

      container.remove();

      return {
        text: result?.node?.textContent,
        offset: result?.offset,
      };
    });

    expect(result.text).toBe('test');
    expect(result.offset).toBe(4);
  });

  test('handles nested elements (bold inside paragraph)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">before <strong data-node-id="0.1">bold</strong> after</p>' +
        '</div>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;

      // Offset 9 should be in "bold" (after "before " = 7 chars, then 2 into "bold")
      const result = (window as any).bridge.findPositionByVisibleOffset(p, 9);

      container.remove();

      return {
        text: result?.node?.textContent,
        offset: result?.offset,
      };
    });

    expect(result.text).toBe('bold');
    expect(result.offset).toBe(2);
  });

  test('finds position in text AFTER existing bold', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">before <strong data-node-id="0.1">bold</strong> after</p>' +
        '</div>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;

      // Offset 12 should be in " after" (after "before bold" = 11 chars, then 1 into " after")
      const result = (window as any).bridge.findPositionByVisibleOffset(p, 12);

      container.remove();

      return {
        text: result?.node?.textContent,
        offset: result?.offset,
      };
    });

    expect(result.text).toBe(' after');
    expect(result.offset).toBe(1);
  });

  test('selection range in text after bold with Vue empty nodes', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0"></p>' +
        '</div>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      p.appendChild(document.createTextNode('before '));

      const strong = document.createElement('strong');
      strong.setAttribute('data-node-id', '0.1');
      strong.appendChild(document.createTextNode('')); // Vue artifact
      strong.appendChild(document.createTextNode('bold'));
      p.appendChild(strong);

      p.appendChild(document.createTextNode(' after'));

      // Find position for offset 12 - should be in " after"
      const result = (window as any).bridge.findPositionByVisibleOffset(p, 12);

      container.remove();

      return {
        text: result?.node?.textContent,
        offset: result?.offset,
      };
    });

    expect(result.text).toBe(' after');
    expect(result.offset).toBe(1);
  });

  test('find start and end of word after bold', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0"><strong data-node-id="0.0">This</strong> bold text</p>' +
        '</div>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;

      // Find position for "text" which starts at offset 10
      const startResult = (window as any).bridge.findPositionByVisibleOffset(p, 10);
      const endResult = (window as any).bridge.findPositionByVisibleOffset(p, 14);

      container.remove();

      return {
        startText: startResult?.node?.textContent,
        startOffset: startResult?.offset,
        endText: endResult?.node?.textContent,
        endOffset: endResult?.offset,
      };
    });

    expect(result.startText).toBe(' bold text');
    expect(result.startOffset).toBe(6); // " bold " = 6 chars, then start of "text"
    expect(result.endText).toBe(' bold text');
    expect(result.endOffset).toBe(10); // end of " bold text"
  });

  test('prospective formatting: offset 0 in ZWS-only inline element positions after ZWS', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">Hello <span data-node-id="0.1"></span></p>' +
        '</div>';
      document.body.appendChild(container);

      const span = container.querySelector('span')!;
      // Add ZWS to empty span (like ensureZeroWidthSpaces does)
      span.appendChild(document.createTextNode('\uFEFF'));

      // Find position at offset 0 inside the span (for prospective formatting)
      const result = (window as any).bridge.findPositionByVisibleOffset(span, 0);

      container.remove();

      return {
        text: result?.node?.textContent,
        offset: result?.offset,
        isZWS: result?.node?.textContent === '\uFEFF',
      };
    });

    // Should position AFTER the ZWS (offset 1) so typing inserts inside the span
    expect(result.isZWS).toBe(true);
    expect(result.offset).toBe(1); // After the ZWS, not before
  });

  test('cursor exit: offset at end of inline element returns end of text inside', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // When exiting bold: "Hello " (6) + "world" (5) = offset 11
    // Without text after span, position should be at end of "world"
    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      const p = document.createElement('p');
      p.setAttribute('data-edit-text', 'value');
      p.setAttribute('data-node-id', '0');

      p.appendChild(document.createTextNode('Hello '));
      const span = document.createElement('span');
      span.setAttribute('data-node-id', '0.1');
      span.textContent = 'world';
      p.appendChild(span);
      // No text node after span

      container.appendChild(p);
      document.body.appendChild(container);

      const result = (window as any).bridge.findPositionByVisibleOffset(p, 11);

      container.remove();

      return {
        text: result?.node?.textContent,
        offset: result?.offset,
      };
    });

    // Offset 11 = end of "world" (only option without text after)
    expect(result.text).toBe('world');
    expect(result.offset).toBe(5);
  });

  test('cursor exit: offset at end of inline element with text after returns start of next text', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // When there IS text after: "Hello " (6) + "world" (5) + " after"
    // Offset 11 should prefer start of " after" over end of "world"
    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      const p = document.createElement('p');
      p.setAttribute('data-edit-text', 'value');
      p.setAttribute('data-node-id', '0');

      p.appendChild(document.createTextNode('Hello '));
      const span = document.createElement('span');
      span.setAttribute('data-node-id', '0.1');
      span.textContent = 'world';
      p.appendChild(span);
      p.appendChild(document.createTextNode(' after'));

      container.appendChild(p);
      document.body.appendChild(container);

      const result = (window as any).bridge.findPositionByVisibleOffset(p, 11);

      container.remove();

      return {
        text: result?.node?.textContent,
        offset: result?.offset,
      };
    });

    // Offset 11 should be at start of " after" (offset 0), not end of "world"
    // This ensures cursor exits the inline element
    expect(result.text).toBe(' after');
    expect(result.offset).toBe(0);
  });

  test('cursor exit: with ZWS inside span from prospective formatting', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // After prospective formatting + typing "world", span contains "﻿world" (ZWS + text)
    // After toggling off, offset 11 should land in ZWS after span
    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      const p = document.createElement('p');
      p.setAttribute('data-edit-text', 'value');
      p.setAttribute('data-node-id', '0');

      p.appendChild(document.createTextNode('Hello '));
      const span = document.createElement('span');
      span.setAttribute('data-node-id', '0.1');
      // ZWS from prospective formatting + typed text
      span.appendChild(document.createTextNode('\uFEFF' + 'world'));
      p.appendChild(span);
      // ZWS after span (added by ensureZeroWidthSpaces)
      p.appendChild(document.createTextNode('\uFEFF'));

      container.appendChild(p);
      document.body.appendChild(container);

      // Visible chars: "Hello " (6) + "world" (5) = 11
      // ZWS chars are not counted
      const result = (window as any).bridge.findPositionByVisibleOffset(p, 11);

      container.remove();

      return {
        text: result?.node?.textContent,
        offset: result?.offset,
        parentTagName: result?.node?.parentElement?.tagName,
      };
    });

    // Offset 11 should land in the ZWS AFTER the span, not inside the span
    // Offset is 1 (after the ZWS) so cursor is clearly inside the ZWS text node
    // This prevents browser from putting typed text inside the preceding inline element
    expect(result.text).toBe('\uFEFF');
    expect(result.offset).toBe(1);
    // Parent should be P (paragraph), not SPAN
    expect(result.parentTagName).toBe('P');
  });

  test('returns null when element contains only empty text nodes', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const fragment = (window as any).vueStyleDOM(
        '<p id="test-all-empty" data-node-id="0">\n\n\n</p>'
      );
      document.body.appendChild(fragment);

      const p = document.getElementById('test-all-empty')!;

      // All text nodes are empty, so any offset should return null
      const result = (window as any).bridge.findPositionByVisibleOffset(p, 0);

      p.remove();

      return result;
    });

    expect(result).toBeNull();
  });

  test('offset beyond text length with Vue empty text nodes returns end of last non-empty node', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // Vue/Nuxt creates empty text nodes ("") from template interpolation boundaries
    // Structure after vueStyleDOM: [empty ""][Hello world][empty ""]
    const result = await body.evaluate(() => {
      const fragment = (window as any).vueStyleDOM(
        '<p id="test-trailing-empty" data-node-id="0">\n' +
        'Hello world\n' +
        '</p>'
      );
      document.body.appendChild(fragment);

      const p = document.getElementById('test-trailing-empty')!;

      // Request offset 12, but "Hello world" is only 11 chars
      // Should return end of "Hello world", NOT offset 0 in trailing empty node
      const result = (window as any).bridge.findPositionByVisibleOffset(p, 12);

      p.remove();

      return {
        text: result?.node?.textContent,
        offset: result?.offset,
        textLength: result?.node?.textContent?.length,
      };
    });

    // Should be at end of "Hello world" (offset 11), not in an empty text node
    expect(result.text).toBe('Hello world');
    expect(result.offset).toBe(11);
  });
});
