/**
 * Unit tests for Bridge.caretRangeFromPoint() — cross-browser caret-at-point.
 *
 * Firefox does not implement the WebKit/Chromium `document.caretRangeFromPoint`
 * API; it implements the standard `document.caretPositionFromPoint` returning
 * a CaretPosition instead of a Range. Without a wrapper, hydra.js throws
 * `TypeError: document.caretRangeFromPoint is not a function` in Firefox
 * whenever a block is clicked. The wrapper should:
 *   - prefer native caretRangeFromPoint when available (Chromium/WebKit)
 *   - fall back to caretPositionFromPoint and construct a collapsed Range
 *     when caretRangeFromPoint is missing (Firefox)
 *   - return null when neither API is available
 */

import { test, expect, URLS } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Bridge.caretRangeFromPoint()', () => {
  let helper: AdminUIHelper;

  test.beforeEach(async ({ page }) => {
    helper = new AdminUIHelper(page);
    // MOCK_PARENT_URL and FRONTEND_URL let the test run against a non-default
    // mock-api + frontend (e.g. when port 8889 is taken by another hydra checkout).
    const mockParent = process.env.MOCK_PARENT_URL || `${URLS.testFrontend}/mock-parent.html`;
    const frontend = process.env.FRONTEND_URL || '';
    const url = frontend
      ? `${mockParent}?frontend=${encodeURIComponent(frontend)}`
      : mockParent;
    await page.goto(url);
    await helper.waitForIframeReady();
    await helper.waitForIframeBlockHandle('mock-block-1');
  });

  test('uses native caretRangeFromPoint when available', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      // Fixed position at top-left so the element is guaranteed to be in
      // the viewport and not covered by other content on the test page.
      container.style.cssText = 'position:fixed;top:10px;left:10px;z-index:99999;background:#fff;padding:8px;';
      container.innerHTML = '<p id="caret-t">Hello world</p>';
      document.body.appendChild(container);
      const p = container.querySelector('p')!;
      const rect = p.getBoundingClientRect();

      // Middle of the paragraph — native implementation should return a Range
      const range = (window as any).bridge.caretRangeFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      const out = {
        isRange: range instanceof Range,
        containerIsText: range?.startContainer?.nodeType === Node.TEXT_NODE,
      };
      container.remove();
      return out;
    });

    expect(result.isRange).toBe(true);
    expect(result.containerIsText).toBe(true);
  });

  test('falls back to caretPositionFromPoint when native is missing', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;top:10px;left:10px;z-index:99999;background:#fff;padding:8px;';
      container.innerHTML = '<p id="caret-t">Hello world</p>';
      document.body.appendChild(container);
      const p = container.querySelector('p')!;
      const rect = p.getBoundingClientRect();

      // Simulate Firefox: caretRangeFromPoint missing, caretPositionFromPoint
      // returns a CaretPosition pointing at the paragraph's text node.
      const origRange = (document as any).caretRangeFromPoint;
      const origPosition = (document as any).caretPositionFromPoint;
      try {
        (document as any).caretRangeFromPoint = undefined;
        (document as any).caretPositionFromPoint = (x: number, y: number) => ({
          offsetNode: p.firstChild,
          offset: 3,
        });

        const range = (window as any).bridge.caretRangeFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return {
          isRange: range instanceof Range,
          isCollapsed: range?.collapsed,
          startOffset: range?.startOffset,
          containerIsText: range?.startContainer?.nodeType === Node.TEXT_NODE,
        };
      } finally {
        (document as any).caretRangeFromPoint = origRange;
        (document as any).caretPositionFromPoint = origPosition;
        container.remove();
      }
    });

    expect(result.isRange).toBe(true);
    expect(result.isCollapsed).toBe(true);
    expect(result.startOffset).toBe(3);
    expect(result.containerIsText).toBe(true);
  });

  test('returns null when neither API is available', async () => {
    const iframe = helper.getIframe();
    const body = iframe.locator('body');

    const result = await body.evaluate(() => {
      const origRange = (document as any).caretRangeFromPoint;
      const origPosition = (document as any).caretPositionFromPoint;
      try {
        (document as any).caretRangeFromPoint = undefined;
        (document as any).caretPositionFromPoint = undefined;
        return (window as any).bridge.caretRangeFromPoint(0, 0);
      } finally {
        (document as any).caretRangeFromPoint = origRange;
        (document as any).caretPositionFromPoint = origPosition;
      }
    });

    expect(result).toBeNull();
  });
});
