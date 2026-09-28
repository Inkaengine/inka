/**
 * Unit tests for bridge.restoreFocusFromSavedClick() — the caret put back in a
 * field after a re-render, from the position the author clicked.
 *
 * That position is the canvas's: it restores a caret the render destroyed.
 * Once the author is working in the sidebar the page does not have focus, and
 * restoring it would take focus out of the sidebar — which is what happened
 * when a sidebar edit to one field of a block (a question's options) re-rendered
 * the block while a click in another of its fields (its label) was saved.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

test.describe('Bridge.restoreFocusFromSavedClick()', () => {
  let helper: AdminUIHelper;

  test.beforeEach(async ({ page }) => {
    helper = new AdminUIHelper(page);
    await page.goto(`${URLS.testFrontend}/mock-parent.html`);
    await helper.waitForIframeReady();
    await helper.waitForIframeBlockHandle('mock-block-1');
  });

  const restore = (iframeFocused: boolean) =>
    helper.getIframe().locator('body').evaluate((_el, focused) => {
      const bridge = (window as any).bridge;
      const blockEl = document.querySelector('[data-block-uid="mock-block-1"]') as HTMLElement;
      const field = (blockEl.querySelector('[data-edit-text]') || blockEl) as HTMLElement;
      (document.activeElement as HTMLElement | null)?.blur();
      bridge.selectedBlockUid = 'mock-block-1';
      bridge.focusedFieldName = field.getAttribute('data-edit-text');
      bridge.savedClickPosition = { relativeX: 1, relativeY: 1, editableField: bridge.focusedFieldName };
      bridge._iframeFocused = focused;
      let focusCalls = 0;
      const orig = field.focus.bind(field);
      field.focus = (...args: any[]) => {
        focusCalls += 1;
        return orig(...args);
      };
      bridge.restoreFocusFromSavedClick(blockEl, { skipFocus: true });
      return { focusCalls, saved: bridge.savedClickPosition };
    }, iframeFocused);

  test('with focus in the sidebar, a saved click does not take it back to the page', async () => {
    const result = await restore(false);
    expect(result.focusCalls).toBe(0);
    // The click it recorded is over: it is not kept for a later render.
    expect(result.saved).toBeNull();
  });

  test('with focus on the page, the saved click restores the caret after a re-render', async () => {
    const result = await restore(true);
    expect(result.focusCalls).toBe(1);
  });
});
