/**
 * Unit tests for findTextNodeInChild() - Vue empty text node handling
 * Tests finding text nodes in children while skipping Vue artifact nodes
 */

import { test, expect, URLS } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('findTextNodeInChild() - Vue empty text node handling', () => {
  let helper: AdminUIHelper;

  test.beforeEach(async ({ page }) => {
    helper = new AdminUIHelper(page);
    await page.goto(`${URLS.testFrontend}/mock-parent.html`);
    await helper.waitForIframeReady();
    await helper.waitForIframeBlockHandle('mock-block-1');
  });

  test('skips empty text node and finds actual content', async () => {
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
      // Add empty text node first (Vue artifact)
      strong.appendChild(document.createTextNode(''));
      // Add actual content
      strong.appendChild(document.createTextNode('test'));

      const result = (window as any).bridge.findTextNodeInChild(strong, 0);

      container.remove();

      return {
        textContent: result?.node?.textContent,
        offset: result?.offset,
      };
    });

    expect(result.textContent).toBe('test');
    expect(result.offset).toBe(0);
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

      const result = (window as any).bridge.findTextNodeInChild(strong, 0);

      container.remove();

      return {
        textContent: result?.node?.textContent,
      };
    });

    expect(result.textContent).toBe('content');
  });

  test('works with direct non-empty text node', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<strong data-node-id="0.1">bold text</strong>' +
        '</div>';
      document.body.appendChild(container);

      const strong = container.querySelector('strong')!;
      const result = (window as any).bridge.findTextNodeInChild(strong, 2);

      container.remove();

      return {
        textContent: result?.node?.textContent,
        offset: result?.offset,
      };
    });

    expect(result.textContent).toBe('bold text');
    expect(result.offset).toBe(2);
  });

  test('handles offset correctly when skipping empty nodes', async () => {
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
      strong.appendChild(document.createTextNode('hello'));

      // Request offset 3 - should be position after "hel"
      const result = (window as any).bridge.findTextNodeInChild(strong, 3);

      container.remove();

      return {
        textContent: result?.node?.textContent,
        offset: result?.offset,
      };
    });

    expect(result.textContent).toBe('hello');
    expect(result.offset).toBe(3);
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

      const result = (window as any).bridge.findTextNodeInChild(strong, 0);

      container.remove();

      return { result };
    });

    expect(result.result).toBeNull();
  });

  test('finds text node in nested element', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">' +
        '<strong data-node-id="0.1"><span>nested text</span></strong>' +
        '</p>' +
        '</div>';
      document.body.appendChild(container);

      const strong = container.querySelector('strong')!;
      const result = (window as any).bridge.findTextNodeInChild(strong, 5);

      container.remove();

      return {
        textContent: result?.node?.textContent,
        offset: result?.offset,
      };
    });

    expect(result.textContent).toBe('nested text');
    expect(result.offset).toBe(5);
  });

  test('handles offset at end of text', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<strong data-node-id="0.1">test</strong>' +
        '</div>';
      document.body.appendChild(container);

      const strong = container.querySelector('strong')!;
      const result = (window as any).bridge.findTextNodeInChild(strong, 4);

      container.remove();

      return {
        textContent: result?.node?.textContent,
        offset: result?.offset,
      };
    });

    expect(result.textContent).toBe('test');
    expect(result.offset).toBe(4);
  });
});
