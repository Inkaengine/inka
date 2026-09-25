/**
 * The admin keeps its own copy of the caret. A caret move with no text change
 * goes to it at once (SELECTION_CHANGE). When the ADMIN places the caret (a
 * FORM_DATA with transformedSelection), the selection changes the frontend's
 * re-render and the bridge's own restore cause are not news to it — reporting
 * them sent it stale positions. Those must be held back until the restore has
 * happened, and caret moves after that reported again.
 */
import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';

const BLOCK = 'mock-block-1';

/** The admin places the caret: FORM_DATA with new text and a transformedSelection. */
async function adminPlacesCaret(page: Page, text: string, offset: number) {
  await page.evaluate(
    ({ block, text, offset }) => {
      const mockParent = (window as any).mockParent;
      const data = JSON.parse(JSON.stringify(mockParent.getFormData()));
      data.blocks[block].value = [{ type: 'p', children: [{ text }] }];
      const point = { path: [0, 0], offset };
      (document.getElementById('previewIframe') as HTMLIFrameElement).contentWindow!.postMessage(
        {
          type: 'FORM_DATA',
          data,
          blockPathMap: mockParent.buildBlockPathMap(),
          transformedSelection: { anchor: point, focus: point },
        },
        '*',
      );
    },
    { block: BLOCK, text, offset },
  );
}

/** Move the caret without any author input — as a re-render or a script does. */
function moveCaretQuietly(field: Locator, offset: number) {
  return field.evaluate((el, offset) => {
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node.textContent!.replace(/[﻿​]/g, '').length >= offset) break;
    }
    const range = el.ownerDocument.createRange();
    range.setStart(node!, offset);
    range.collapse(true);
    const sel = el.ownerDocument.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }, offset);
}

const reportedOffsets = (page: Page) =>
  page.evaluate(() => ((window as any).__selectionChanges as any[]).map((s) => s.anchor.offset));

test.describe('Caret sync after the admin places the caret', () => {
  async function startRecording(page: Page, field: Locator) {
    await field.click();
    await page.keyboard.press('End');
    await page.evaluate(() => {
      const w = window as any;
      w.__selectionChanges = [];
      window.addEventListener('message', (e) => {
        if (e.data?.type === 'SELECTION_CHANGE') w.__selectionChanges.push(e.data.selection);
      });
    });
  }

  /** Wait for the caret to land, checking often so the next step follows at once. */
  const caretLandsAfter = (helper: any, field: Locator, before: string) =>
    expect
      .poll(async () => (await helper.getTextAroundCursor(field)).textBefore, { intervals: [10] })
      .toBe(before);

  test('caret moves after the admin places the caret are reported at once', async ({ helper, page }) => {
    const field = await helper.getEditorLocator(BLOCK, 'value');
    await startRecording(page, field);

    await adminPlacesCaret(page, 'First text', 4);
    await caretLandsAfter(helper, field, 'Firs');
    // Straight away: the bridge used to hold caret moves back for 100ms after
    // placing the caret, and the admin never heard of this one.
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => reportedOffsets(page)).toContain(3);
    // Without author input too (a script, assistive technology).
    await moveCaretQuietly(field, 6);
    await expect.poll(() => reportedOffsets(page)).toContain(6);
  });

  test('a caret move while the admin\'s placement is still rendering is not reported', async ({
    helper,
    page,
  }) => {
    // Needs a frontend whose render can be held: the test frontend's
    // renderGate hook. The example frontends render at once, so there the
    // placement is done before anything else can happen.
    const field = await helper.getEditorLocator(BLOCK, 'value');
    await startRecording(page, field);
    const gated = await field.evaluate((el) => !!(el.ownerDocument.defaultView as any).supportsRenderGate);

    await adminPlacesCaret(page, 'First text', 2);
    await caretLandsAfter(helper, field, 'Fi');

    if (gated) {
      // Hold the next placement's render. While it is held, move the caret
      // with no author input — what a re-render does to it. That is not news
      // to the admin.
      await field.evaluate((el) => {
        const w = el.ownerDocument.defaultView as any;
        w.renderGate = new Promise<void>((resolve) => (w.releaseRender = resolve));
      });
      await adminPlacesCaret(page, 'Second text', 4);
      await expect
        .poll(() => field.evaluate((el) => !!(el.ownerDocument.defaultView as any).renderWaiting))
        .toBe(true);
      await moveCaretQuietly(field, 1);
      await field.evaluate((el) => {
        const w = el.ownerDocument.defaultView as any;
        w.renderGate = null;
        w.releaseRender();
      });
    } else {
      await adminPlacesCaret(page, 'Second text', 4);
    }

    await expect(field).toContainText('Second text');
    await caretLandsAfter(helper, field, 'Seco');
    expect(await reportedOffsets(page)).not.toContain(1);
  });
});
