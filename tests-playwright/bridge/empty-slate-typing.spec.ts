/**
 * Typing into a slate that is EMPTY from the start.
 *
 * A brand-new/empty slate block renders as an empty node-id'd element (e.g.
 * <p data-node-id="0">, possibly wrapped in a <div data-edit-text>). It carries
 * no ZWS in the value — hydra owns inserting one. If the bridge does not park a
 * ZWS as a caret target, a native keystroke leaks OUT of the node-id'd element
 * to the contenteditable wrapper: the bridge then reads the field as unchanged
 * ("DOM matches formData, skipping"), the slash menu never opens, and the edit
 * is lost.
 *
 * Runs on every bridge frontend (mock, nuxt, react, svelte, vue, astro, nextjs,
 * f7), so the fix is proven wherever the bridge runs — not just the two
 * frontends the admin-integration slash-menu spec covers.
 */
import { test, expect } from './fixtures';

test.describe('Empty slate typing', () => {
  test('a character typed into an empty slate lands inside the node-id element', async ({
    helper,
    page,
  }) => {
    // Selecting the block focuses its editable field and runs the bridge's
    // caret correction, which parks the ZWS inside the empty <p>.
    const block = await helper.clickBlockInIframe('mock-empty-slate', {
      waitForToolbar: false,
    });
    // getSlateField resolves the editable whether data-edit-text is on the block
    // element itself (nuxt) or a child (mock).
    const field = helper.getSlateField(block);
    // Deterministically wait for the bridge's caret correction to finish before
    // typing. A fixed timeout races the correction under CI load — if '/' lands
    // before the ZWS caret target is parked it leaks to the contenteditable
    // wrapper and the test flakes (fails, then passes on retry). Poll the
    // observable post-condition instead: a ZWS (﻿) text node sitting under a
    // [data-node-id] element, which is exactly what the correction creates and
    // moves the caret onto.
    await expect
      .poll(
        async () =>
          field.evaluate((el) => {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let t;
            while ((t = walker.nextNode())) {
              if (t.textContent?.includes('﻿') && t.parentElement?.closest('[data-node-id]')) return true;
            }
            return false;
          }),
        {
          message: 'bridge should park a ZWS caret target inside the node-id element before typing',
          timeout: 5000,
        },
      )
      .toBe(true);

    await page.keyboard.type('/');

    // The '/' must land INSIDE a node-id'd element — i.e. the text node holding
    // it has a [data-node-id] ancestor. A leak (the bug) puts '/' as a bare text
    // node under the contenteditable field, which has no node-id ancestor; the
    // bridge then reads the field as unchanged and the edit is lost. Works
    // whether data-node-id is on the field itself (mock) or a child (nuxt).
    await expect
      .poll(async () =>
        field.evaluate((el) => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let t;
          while ((t = walker.nextNode())) {
            if (t.textContent && t.textContent.includes('/')) {
              return !!t.parentElement?.closest('[data-node-id]');
            }
          }
          return false;
        }),
      )
      .toBe(true);
  });

  test('text typed into an empty slate shows once after the next FORM_DATA', async ({
    helper,
    page,
  }) => {
    // The bridge parks its ZWS caret target in a text node the FRONTEND did not
    // render (an empty leaf renders no text node in React), and the author's
    // text is typed into it. Echoes of the edit are not re-rendered, so all
    // looks right while typing. The admin's next FORM_DATA that changes
    // anything re-renders the block: a frontend that keeps its DOM between
    // renders (stable keys) adds its OWN text node for the same text beside the
    // bridge's, and the field reads the text twice.
    const block = await helper.clickBlockInIframe('mock-empty-slate', {
      waitForToolbar: false,
    });
    const field = helper.getSlateField(block);
    const visibleText = () =>
      field.evaluate((el) => (el.textContent || '').replace(/[\uFEFF\u200B]/g, ''));
    const textNodesWith = (text: string) =>
      field.evaluate((el, t) => {
        const found: string[] = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
          if (n.textContent?.includes(t)) found.push(n.textContent);
        }
        return found;
      }, text);
    // Type once the bridge has parked its caret target (see the test above).
    await expect
      .poll(() =>
        field.evaluate((el) => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let t;
          while ((t = walker.nextNode())) {
            if (t.textContent?.includes('\uFEFF') && t.parentElement?.closest('[data-node-id]')) return true;
          }
          return false;
        }),
      )
      .toBe(true);
    await page.keyboard.type('Hello');
    await expect.poll(visibleText).toBe('Hello');
    expect(await textNodesWith('Hello')).toHaveLength(1);

    // The admin holds the edit (the bridge sent it)…
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).mockParent.getBlock('mock-empty-slate')?.value?.[0]?.children?.[0]?.text,
        ),
      )
      .toBe('Hello');
    // …and sends its next FORM_DATA: the edit, plus a change to another block.
    await page.evaluate(() => {
      const mockParent = (window as any).mockParent;
      const data = JSON.parse(JSON.stringify(mockParent.getFormData()));
      data.blocks['mock-block-1'].value = [
        { type: 'p', children: [{ text: 'Changed by the admin' }] },
      ];
      (document.getElementById('previewIframe') as HTMLIFrameElement).contentWindow!.postMessage(
        { type: 'FORM_DATA', data, blockPathMap: mockParent.buildBlockPathMap() },
        '*',
      );
    });
    // The block re-rendered (the other block shows the admin's change)…
    await expect(helper.getIframe().locator('[data-block-uid="mock-block-1"]')).toContainText(
      'Changed by the admin',
    );
    // …and the typed text is there once.
    await expect.poll(visibleText).toBe('Hello');
    expect(await textNodesWith('Hello')).toHaveLength(1);
  });
});
