/**
 * A SELECT_BLOCK for a block that hasn't rendered yet finishes asynchronously:
 * the bridge waits (MutationObserver / visibility poll) for the element to
 * appear and selects it then. Nothing cancelled that wait, so an author who
 * clicked a different block in the meantime had their selection stolen the
 * moment the frontend's next render happened to produce the awaited element.
 *
 * Worse than a wrong outline: the stolen selection carries the CLICK's
 * focusedFieldName, which the newly selected block usually doesn't have, so
 * `selectBlock` finds no field to focus and the caret lands nowhere — the
 * author's next keystroke goes to the body.
 */
import { test, expect } from './fixtures';

const selectedUid = (helper: any) =>
  helper
    .getIframe()
    .locator('body')
    .evaluate((node: HTMLElement) => (node.ownerDocument.defaultView as any).__hydraBridge?.selectedBlockUid);

test.describe('Deferred SELECT_BLOCK', () => {
  test('a late-arriving block must not steal a selection the author made since', async ({
    helper,
    page,
  }) => {
    // Arm the wait: this uid is not in the DOM, so the bridge starts observing
    // for it instead of selecting immediately.
    await page.evaluate(() => (window as any).mockParent.selectBlock('not-yet-rendered'));

    // The author clicks a real block while that wait is still in flight.
    await helper.clickBlockInIframe('mock-hero-block', { waitForToolbar: false });
    expect(await selectedUid(helper)).toBe('mock-hero-block');

    // The awaited block finally renders (a slow frontend, a data round trip).
    await helper
      .getIframe()
      .locator('body')
      .evaluate((node: HTMLElement) => {
        const el = node.ownerDocument.createElement('div');
        el.setAttribute('data-block-uid', 'not-yet-rendered');
        el.textContent = 'late';
        node.appendChild(el);
      });

    // The author's selection stands.
    //
    // Asserting that something did NOT happen has no positive signal to wait
    // for, so wait for the browser to reach a frame instead of sleeping: the
    // MutationObserver callback that would steal the selection is delivered as
    // a microtask, so if it were going to fire it has fired by then.
    await helper
      .getIframe()
      .locator('body')
      .evaluate(
        (node: HTMLElement) =>
          new Promise<void>((resolve) => {
            const win = node.ownerDocument.defaultView as Window;
            win.requestAnimationFrame(() =>
              win.requestAnimationFrame(() => resolve()),
            );
          }),
      );
    expect(await selectedUid(helper)).toBe('mock-hero-block');
  });
});
