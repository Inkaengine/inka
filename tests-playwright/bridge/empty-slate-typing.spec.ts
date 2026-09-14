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
});
