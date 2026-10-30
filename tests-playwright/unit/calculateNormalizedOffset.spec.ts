/**
 * Unit tests for calculateNormalizedOffset() - Vue whitespace handling
 * Uses real browser Range API which jsdom cannot properly simulate
 */

import { test, expect, URLS } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('calculateNormalizedOffset() - Vue whitespace handling', () => {
  let helper: AdminUIHelper;

  test.beforeEach(async ({ page }) => {
    helper = new AdminUIHelper(page);
    await page.goto(`${URLS.testFrontend}/mock-parent.html`);
    await helper.waitForIframeReady();
    await helper.waitForIframeBlockHandle('mock-block-1');
  });

  test('offset calculation in plain paragraph without formatting', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">This is a test</p>' +
        '</div>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const textNode = p.firstChild as Text;

      // Offset 10 in "This is a test" should give offset 10
      const normalizedOffset = (window as any).bridge.calculateNormalizedOffset(
        textNode,
        10
      );

      container.remove();

      return {
        normalizedOffset,
        textContent: textNode.textContent,
      };
    });

    expect(result.textContent).toBe('This is a test');
    expect(result.normalizedOffset).toBe(10);
  });

  test('offset calculation works for text after formatted element', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">Hello <strong data-node-id="0.1">bold</strong> world</p>' +
        '</div>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const textAfterStrong = p.lastChild as Text; // " world"

      // Offset 3 in " world" = "wor" = should give offset 3 relative to this text leaf
      const normalizedOffset = (window as any).bridge.calculateNormalizedOffset(
        textAfterStrong,
        3
      );

      container.remove();

      return {
        normalizedOffset,
        textContent: textAfterStrong.textContent,
      };
    });

    expect(result.textContent).toBe(' world');
    expect(result.normalizedOffset).toBe(3);
  });

  test('offset calculation for text before formatted element', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">Hello <strong data-node-id="0.1">bold</strong> world</p>' +
        '</div>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const textBeforeStrong = p.firstChild as Text; // "Hello "

      // Offset 3 in "Hello " should give offset 3
      const normalizedOffset = (window as any).bridge.calculateNormalizedOffset(
        textBeforeStrong,
        3
      );

      container.remove();

      return {
        normalizedOffset,
        textContent: textBeforeStrong.textContent,
      };
    });

    expect(result.textContent).toBe('Hello ');
    expect(result.normalizedOffset).toBe(3);
  });

  test('offset calculation for text inside formatted element', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">Hello <strong data-node-id="0.1">bold</strong> world</p>' +
        '</div>';
      document.body.appendChild(container);

      const strong = container.querySelector('strong')!;
      const textInStrong = strong.firstChild as Text; // "bold"

      // Offset 2 in "bold" should give offset 2
      const normalizedOffset = (window as any).bridge.calculateNormalizedOffset(
        textInStrong,
        2
      );

      container.remove();

      return {
        normalizedOffset,
        textContent: textInStrong.textContent,
      };
    });

    expect(result.textContent).toBe('bold');
    expect(result.normalizedOffset).toBe(2);
  });

  test('offset calculation with multiple formatted elements', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.innerHTML =
        '<div data-edit-text="value">' +
        '<p data-node-id="0">' +
        '<strong data-node-id="0.0">first</strong>' +
        ' middle ' +
        '<em data-node-id="0.2">last</em>' +
        '</p>' +
        '</div>';
      document.body.appendChild(container);

      const p = container.querySelector('p')!;
      const middleText = p.childNodes[1] as Text; // " middle "

      // Offset 4 in " middle " should give offset 4
      const normalizedOffset = (window as any).bridge.calculateNormalizedOffset(
        middleText,
        4
      );

      container.remove();

      return {
        normalizedOffset,
        textContent: middleText.textContent,
      };
    });

    expect(result.textContent).toBe(' middle ');
    expect(result.normalizedOffset).toBe(4);
  });
});
