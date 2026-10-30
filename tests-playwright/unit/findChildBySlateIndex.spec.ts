/**
 * Unit tests for findChildBySlateIndex() - Vue empty text node handling
 * Tests finding children by Slate index while skipping Vue artifact nodes
 */

import { test, expect, URLS } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('findChildBySlateIndex() - Vue empty text node handling', () => {
  let helper: AdminUIHelper;

  test.beforeEach(async ({ page }) => {
    helper = new AdminUIHelper(page);
    await page.goto(`${URLS.testFrontend}/mock-parent.html`);
    await helper.waitForIframeReady();
    await helper.waitForIframeBlockHandle('mock-block-1');
  });

  test('skips empty text node and finds actual content at index 0', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">' +
        '<strong data-node-id="0.1"></strong>' +
        '</p>' +
        '</div>';
      document.body.appendChild(container);

      const strong = container.querySelector('strong')!;
      // Add empty text node first (Vue artifact - not in Slate model)
      strong.appendChild(document.createTextNode(''));
      // Add actual content (Slate index 0)
      strong.appendChild(document.createTextNode('test'));

      const result = (window as any).bridge.findChildBySlateIndex(strong, 0);

      container.remove();

      return {
        textContent: result?.textContent,
        nodeType: result?.nodeType,
      };
    });

    expect(result.textContent).toBe('test');
  });

  test('skips multiple empty text nodes', async () => {
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
      strong.appendChild(document.createTextNode(''));
      strong.appendChild(document.createTextNode(''));
      strong.appendChild(document.createTextNode('content'));

      const result = (window as any).bridge.findChildBySlateIndex(strong, 0);

      container.remove();

      return {
        textContent: result?.textContent,
      };
    });

    expect(result.textContent).toBe('content');
  });

  test('finds correct index when multiple non-empty text nodes exist', async () => {
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
      p.appendChild(document.createTextNode('')); // Vue artifact
      p.appendChild(document.createTextNode('first')); // Slate index 0
      p.appendChild(document.createTextNode('second')); // Slate index 1

      const first = (window as any).bridge.findChildBySlateIndex(p, 0);
      const second = (window as any).bridge.findChildBySlateIndex(p, 1);

      container.remove();

      return {
        firstText: first?.textContent,
        secondText: second?.textContent,
      };
    });

    expect(result.firstText).toBe('first');
    expect(result.secondText).toBe('second');
  });

  test('returns null when only empty text nodes exist', async () => {
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
      strong.appendChild(document.createTextNode(''));
      strong.appendChild(document.createTextNode(''));

      const result = (window as any).bridge.findChildBySlateIndex(strong, 0);

      container.remove();

      return { result };
    });

    expect(result.result).toBeNull();
  });

  test('handles mixed elements and text nodes with empty nodes', async () => {
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
      p.appendChild(document.createTextNode('')); // Vue artifact
      p.appendChild(document.createTextNode('before')); // Slate index 0

      const strong = document.createElement('strong');
      strong.setAttribute('data-node-id', '0.1');
      strong.appendChild(document.createTextNode('')); // Vue artifact
      strong.appendChild(document.createTextNode('bold'));
      p.appendChild(strong); // Slate index 1

      p.appendChild(document.createTextNode('after')); // Slate index 2

      const index0 = (window as any).bridge.findChildBySlateIndex(p, 0);
      const index1 = (window as any).bridge.findChildBySlateIndex(p, 1);
      const index2 = (window as any).bridge.findChildBySlateIndex(p, 2);

      container.remove();

      return {
        index0Text: index0?.textContent,
        index1TagName: index1?.tagName,
        index2Text: index2?.textContent,
      };
    });

    expect(result.index0Text).toBe('before');
    expect(result.index1TagName).toBe('STRONG');
    expect(result.index2Text).toBe('after');
  });

  test('finds element child at correct index', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">' +
        '<strong data-node-id="0.0">bold</strong>' +
        '<em data-node-id="0.1">italic</em>' +
        '</p>' +
        '</div>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;

      const index0 = (window as any).bridge.findChildBySlateIndex(p, 0);
      const index1 = (window as any).bridge.findChildBySlateIndex(p, 1);

      container.remove();

      return {
        index0TagName: index0?.tagName,
        index1TagName: index1?.tagName,
      };
    });

    expect(result.index0TagName).toBe('STRONG');
    expect(result.index1TagName).toBe('EM');
  });

  test('finds ZWS text node after inline element', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p data-node-id="0">Hello <span data-node-id="0.1">world</span>\uFEFF</p>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const result0 = (window as any).bridge.findChildBySlateIndex(p, 0);
      const result1 = (window as any).bridge.findChildBySlateIndex(p, 1);
      const result2 = (window as any).bridge.findChildBySlateIndex(p, 2);

      container.remove();

      return {
        index0Text: result0?.textContent,
        index0Type: result0?.nodeType,
        index1TagName: result1?.tagName,
        index1NodeId: result1?.getAttribute('data-node-id'),
        index2Text: result2?.textContent,
        index2Type: result2?.nodeType,
      };
    });

    expect(result.index0Text).toBe('Hello ');
    expect(result.index0Type).toBe(3); // TEXT_NODE
    expect(result.index1TagName).toBe('SPAN');
    expect(result.index1NodeId).toBe('0.1');
    expect(result.index2Text).toBe('\uFEFF'); // ZWS
    expect(result.index2Type).toBe(3); // TEXT_NODE
  });

  test('skips wrapper elements with same node-id', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      // strong and b both have node-id="0.1", should count as 1 Slate child
      container.innerHTML =
        '<p data-node-id="0">Hello <strong data-node-id="0.1"><b data-node-id="0.1">world</b></strong>\uFEFF</p>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const result0 = (window as any).bridge.findChildBySlateIndex(p, 0);
      const result1 = (window as any).bridge.findChildBySlateIndex(p, 1);
      const result2 = (window as any).bridge.findChildBySlateIndex(p, 2);

      container.remove();

      return {
        index0Text: result0?.textContent,
        index1TagName: result1?.tagName,
        index2Text: result2?.textContent,
      };
    });

    expect(result.index0Text).toBe('Hello ');
    expect(result.index1TagName).toBe('STRONG');
    expect(result.index2Text).toBe('\uFEFF');
  });

  test('text between multiple inline elements', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p data-node-id="0">a <strong data-node-id="0.1">b</strong> c <em data-node-id="0.2">d</em> e</p>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;

      const results = [];
      for (let i = 0; i < 6; i++) {
        const node = (window as any).bridge.findChildBySlateIndex(p, i);
        results.push({
          text: node?.textContent,
          tagName: node?.tagName,
          isNull: node === null,
        });
      }

      container.remove();

      return results;
    });

    expect(result[0].text).toBe('a ');
    expect(result[1].tagName).toBe('STRONG');
    expect(result[2].text).toBe(' c ');
    expect(result[3].tagName).toBe('EM');
    expect(result[4].text).toBe(' e');
    expect(result[5].isNull).toBe(true);
  });

  test('adjacent inline elements (no text between)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p data-node-id="0"><strong data-node-id="0.1">a</strong><em data-node-id="0.2">b</em></p>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const result0 = (window as any).bridge.findChildBySlateIndex(p, 0);
      const result1 = (window as any).bridge.findChildBySlateIndex(p, 1);
      const result2 = (window as any).bridge.findChildBySlateIndex(p, 2);

      container.remove();

      return {
        index0TagName: result0?.tagName,
        index1TagName: result1?.tagName,
        index2IsNull: result2 === null,
      };
    });

    expect(result.index0TagName).toBe('STRONG');
    expect(result.index1TagName).toBe('EM');
    expect(result.index2IsNull).toBe(true);
  });

  test('empty parent element returns null', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML = '<p data-node-id="0"></p>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const result = (window as any).bridge.findChildBySlateIndex(p, 0);

      container.remove();

      return { isNull: result === null };
    });

    expect(result.isNull).toBe(true);
  });

  test('index out of bounds returns null', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML = '<p data-node-id="0">Hello</p>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const result0 = (window as any).bridge.findChildBySlateIndex(p, 0);
      const result1 = (window as any).bridge.findChildBySlateIndex(p, 1);
      const result10 = (window as any).bridge.findChildBySlateIndex(p, 10);

      container.remove();

      return {
        index0Text: result0?.textContent,
        index1IsNull: result1 === null,
        index10IsNull: result10 === null,
      };
    });

    expect(result.index0Text).toBe('Hello');
    expect(result.index1IsNull).toBe(true);
    expect(result.index10IsNull).toBe(true);
  });

  test('negative index returns null', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML = '<p data-node-id="0">Hello</p>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const result = (window as any).bridge.findChildBySlateIndex(p, -1);

      container.remove();

      return { isNull: result === null };
    });

    expect(result.isNull).toBe(true);
  });

  test('invalid data-node-id span does not steal Slate index from valid sibling (Next.js pattern)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // Next.js renders: <p data-node-id="0">
    //   <span data-node-id="undefined">Hello </span>
    //   <strong data-node-id="0.1">world</strong>
    // </p>
    // Without fix: span steals index 0 (nodeId "undefined" is truthy), strong is at index 1
    // With fix: span is skipped (invalid nodeId), strong is at index 0
    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p data-node-id="0">' +
        '<span data-node-id="undefined">Hello </span>' +
        '<strong data-node-id="0.1">world</strong>' +
        '</p>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const child0 = (window as any).bridge.findChildBySlateIndex(p, 0);

      container.remove();
      return {
        child0Tag: child0?.tagName || null,
      };
    });

    // Strong should be at index 0 (invalid span doesn't count)
    expect(result.child0Tag).toBe('STRONG');
  });

  test('invalid data-node-id span not counted when followed by text node (Next.js pattern)', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    // Inside a <strong>, Next.js renders:
    //   <strong data-node-id="0.1"><span data-node-id="undefined">bold text</span></strong>
    // findChildBySlateIndex(strong, 0) should find the text, not the span as a Slate child.
    // The span with invalid nodeId should be treated as a wrapper.
    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      // Put a real text node and an invalid-nodeId span as siblings inside strong
      container.innerHTML =
        '<strong data-node-id="0.1">' +
        '<span data-node-id="undefined">bold</span>' +
        '</strong>';
      document.body.appendChild(container);

      const strong = container.querySelector('strong')!;
      const child0 = (window as any).bridge.findChildBySlateIndex(strong, 0);
      // With the bug: span is counted as Slate child (nodeId is truthy)
      // With the fix: span has invalid nodeId, is skipped as wrapper, no children found
      // Actually the span's text content IS the child, but the span element shouldn't
      // steal an index. Since there's no real text node sibling, index 0 should be null
      // because the only content is wrapped inside the invalid span.

      container.remove();
      return {
        // The span with invalid nodeId should NOT be returned as a Slate child
        isSpan: child0?.tagName === 'SPAN',
        isNull: child0 === null,
      };
    });

    // Invalid nodeId span should not be counted as a Slate element child
    expect(result.isSpan).toBe(false);
  });
});
