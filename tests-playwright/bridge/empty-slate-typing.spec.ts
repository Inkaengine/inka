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
import type { Locator } from '@playwright/test';
import { test, expect, adminText, rendersBold, sendAdminUpdate, textNodesWith, visibleText } from './fixtures';

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
              if (/[\uFEFF\u200B]/.test(t.textContent || '') && t.parentElement?.closest('[data-node-id]')) return true;
            }
            return false;
          }),
        {
          message: 'a zero-width caret target (the bridge\'s, or the frontend\'s from the render data) should sit inside the node-id element before typing',
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

  // Typed text must survive the admin's NEXT update. The bridge parks its
  // caret target, or the browser puts the typed text, in a text node the
  // FRONTEND did not render (React renders an empty leaf as no node at all).
  // Echoes of the edit are not re-rendered, so everything looks right while
  // typing; the admin's next FORM_DATA that changes anything re-renders the
  // block, and a frontend that keeps its DOM between renders (stable keys) adds
  // its OWN text node beside that one: the text shows twice. Each case starts
  // from a state with no text node the frontend owns.

  // Wait until the field is ready to type into: editable, with the caret in
  // it. (Not "a zero-width space is in the field": the render data puts one in
  // an empty field before the bridge has made it editable, and keys typed then
  // are lost.)
  async function readyToType(field: Locator) {
    await expect(field).toHaveAttribute('contenteditable', 'true');
    await expect
      .poll(() =>
        field.evaluate((el) => {
          const sel = el.ownerDocument.getSelection();
          return !!sel?.anchorNode && el.contains(sel.anchorNode) && el.ownerDocument.hasFocus();
        }),
      )
      .toBe(true);
  }

  test('text typed while the caret target is still rendering arrives once', async ({
    helper,
    page,
  }) => {
    // Clicking into an empty field that has no text node asks for a render
    // that gives it one (a zero-width space in the render data): the author's
    // text then goes into the frontend's own node. Keys typed before that
    // render lands are held and replayed into it — none lost, none doubled.
    // The test frontend's renderGate holds the render so the keys really do
    // arrive first; a frontend without it renders at once.
    const block = helper.getIframe().locator('[data-block-uid="mock-empty-slate"]');
    const gated = await block.evaluate((el) => !!(el.ownerDocument.defaultView as any).supportsRenderGate);
    if (gated) {
      await block.evaluate((el) => {
        const w = el.ownerDocument.defaultView as any;
        w.renderGate = new Promise<void>((resolve) => (w.releaseRender = resolve));
      });
    }
    await helper.clickBlockInIframe('mock-empty-slate', { waitForToolbar: false });
    const field = helper.getSlateField(block);
    await readyToType(field);
    if (gated) {
      // The click asked for the caret target's render, which is held.
      await expect.poll(() => block.evaluate((el) => !!(el.ownerDocument.defaultView as any).renderWaiting)).toBe(true);
    }
    await page.keyboard.type('Hello');
    if (gated) {
      await block.evaluate((el) => {
        const w = el.ownerDocument.defaultView as any;
        w.renderGate = null;
        w.releaseRender();
      });
    }
    await expect.poll(() => visibleText(field)).toBe('Hello');
    await expect.poll(() => adminText(page, 'mock-empty-slate')).toBe('Hello');

    await sendAdminUpdate(page, helper, 'mock-block-1', 'Changed by the admin');
    expect(await visibleText(field)).toBe('Hello');
    {
      const nodes = await textNodesWith(field, 'Hello');
      expect(nodes.found, `text nodes: ${nodes.all.join(', ')}`).toHaveLength(1);
    }
  });

  test('clicking into an empty field renders once, and a format toggle once more', async ({
    helper,
    page,
  }) => {
    // Renders only when needed: one to give the clicked empty field its caret
    // target, one for the format toggle — none at "DOM settle", none while the
    // author types. The test frontend counts its renders.
    const block = helper.getIframe().locator('[data-block-uid="mock-empty-slate"]');
    const renders = () => block.evaluate((el) => (el.ownerDocument.defaultView as any).hydraRenderCount as number | undefined);
    const before = await renders();
    await helper.clickBlockInIframe('mock-empty-slate', { waitForToolbar: false });
    const field = helper.getSlateField(block);
    await readyToType(field);
    await page.keyboard.type('a');
    await expect.poll(() => adminText(page, 'mock-empty-slate')).toBe('a');
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.type('b');
    await expect.poll(() => visibleText(field)).toBe('ab');
    await expect.poll(() => adminText(page, 'mock-empty-slate')).toBe('ab');
    expect(await rendersBold(field, 'b')).toBe(true);
    if (before !== undefined) {
      expect(await renders(), 'renders: the caret target, then the format toggle').toBe(before + 2);
    }
  });

  test('text typed into an empty slate shows once after the next FORM_DATA', async ({
    helper,
    page,
  }) => {
    const block = await helper.clickBlockInIframe('mock-empty-slate', { waitForToolbar: false });
    const field = helper.getSlateField(block);
    await readyToType(field);
    await page.keyboard.type('Hello');
    await expect.poll(() => visibleText(field)).toBe('Hello');
    await expect.poll(() => adminText(page, 'mock-empty-slate')).toBe('Hello');

    await sendAdminUpdate(page, helper, 'mock-block-1', 'Changed by the admin');
    expect(await visibleText(field)).toBe('Hello');
    {
      const nodes = await textNodesWith(field, 'Hello');
      expect(nodes.found, `text nodes: ${nodes.all.join(', ')}`).toHaveLength(1);
    }
  });

  test('a deletion that removes the text node reaches the admin', async ({ helper, page }) => {
    // Deleting all of a paragraph's text, the browser sometimes empties the text
    // node (a characterData change) and sometimes REMOVES it (childList, nothing
    // added) — which Ctrl+A then Backspace on the Vue frontends often does. The
    // bridge must read the field either way. Removing the node here is what the
    // browser does in the second case, so the outcome doesn't depend on which
    // the browser picks.
    const field = await helper.getEditorLocator('mock-block-1', 'value');
    await field.click();
    await expect.poll(() => adminText(page, 'mock-block-1')).not.toBe('');
    await field.evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes: Node[] = [];
      let n;
      while ((n = walker.nextNode())) nodes.push(n);
      for (const node of nodes) node.parentNode?.removeChild(node);
    });
    await expect.poll(() => adminText(page, 'mock-block-1')).toBe('');
  });

  test('text typed after clearing a slate shows once after the next FORM_DATA', async ({
    helper,
    page,
  }) => {
    // Clearing the paragraph can take its text node with it; the retyped text
    // then goes into a node the frontend did not render.
    const field = await helper.getEditorLocator('mock-block-1', 'value');
    await field.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await expect.poll(() => visibleText(field)).toBe('');
    await expect.poll(() => adminText(page, 'mock-block-1')).toBe('');
    await page.keyboard.type('Fresh');
    await expect.poll(() => visibleText(field)).toBe('Fresh');
    await expect.poll(() => adminText(page, 'mock-block-1')).toBe('Fresh');

    await sendAdminUpdate(page, helper, 'mock-empty-slate', 'Changed by the admin');
    expect(await visibleText(field)).toBe('Fresh');
    {
      const nodes = await textNodesWith(field, 'Fresh');
      expect(nodes.found, `text nodes: ${nodes.all.join(', ')}`).toHaveLength(1);
    }
  });

  test('bold typed into an empty slate shows once after the next FORM_DATA', async ({
    helper,
    page,
  }) => {
    // Ctrl+B with nothing selected gives an empty bold inline; the bridge puts its
    // own caret node in it (ensureZwsPosition), and the text is typed there.
    // Bold is checked by how it renders (rendersBold), not by markup: each
    // frontend chooses its own, and the mock's is deliberately non-standard.
    const block = await helper.clickBlockInIframe('mock-empty-slate', { waitForToolbar: false });
    const field = helper.getSlateField(block);
    await readyToType(field);
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.type('Bold');
    await expect.poll(() => visibleText(field)).toBe('Bold');
    {
      const nodes = await textNodesWith(field, 'Bold');
      expect(nodes.found, `before the update, text nodes: ${nodes.all.join(', ')}`).toHaveLength(1);
    }
    await expect.poll(() => adminText(page, 'mock-empty-slate')).toBe('Bold');

    await sendAdminUpdate(page, helper, 'mock-block-1', 'Changed by the admin');
    expect(await visibleText(field)).toBe('Bold');
    {
      const nodes = await textNodesWith(field, 'Bold');
      expect(nodes.found, `text nodes: ${nodes.all.join(', ')}`).toHaveLength(1);
    }
    expect(await rendersBold(field, 'Bold')).toBe(true);
  });

  test('bold typed at the end of a slate shows once after the next FORM_DATA', async ({
    helper,
    page,
  }) => {
    const field = await helper.getEditorLocator('mock-block-1', 'value');
    const before = await visibleText(field);
    await field.click();
    await page.keyboard.press('End');
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.type(' bold');
    await expect.poll(() => visibleText(field)).toBe(`${before} bold`);
    {
      const nodes = await textNodesWith(field, 'bold');
      expect(nodes.found, `before the update, text nodes: ${nodes.all.join(', ')}`).toHaveLength(1);
    }
    await expect.poll(() => adminText(page, 'mock-block-1')).toBe(`${before} bold`);

    await sendAdminUpdate(page, helper, 'mock-empty-slate', 'Changed by the admin');
    expect(await visibleText(field)).toBe(`${before} bold`);
    {
      const nodes = await textNodesWith(field, 'bold');
      expect(nodes.found, `text nodes: ${nodes.all.join(', ')}`).toHaveLength(1);
    }
    expect(await rendersBold(field, 'bold')).toBe(true);
  });

  test('text typed after toggling bold off shows once after the next FORM_DATA', async ({
    helper,
    page,
  }) => {
    // Toggling bold off with the caret inside it moves the caret to the text
    // leaf after the inline — empty at the end of a line, so the frontend drew no
    // node for it, and the bridge made one (the cursor-exit case). Text typed
    // there showed again beside it on the next render.
    const field = await helper.getEditorLocator('mock-block-1', 'value');
    const before = await visibleText(field);
    await field.click();
    await page.keyboard.press('End');
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.type(' bold');
    await expect.poll(() => adminText(page, 'mock-block-1')).toBe(`${before} bold`);
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.type(' normal');
    await expect.poll(() => visibleText(field)).toBe(`${before} bold normal`);
    await expect.poll(() => adminText(page, 'mock-block-1')).toBe(`${before} bold normal`);

    await sendAdminUpdate(page, helper, 'mock-empty-slate', 'Changed by the admin');
    expect(await visibleText(field)).toBe(`${before} bold normal`);
    {
      const nodes = await textNodesWith(field, 'normal');
      expect(nodes.found, `text nodes: ${nodes.all.join(', ')}`).toHaveLength(1);
    }
    expect(await rendersBold(field, 'bold')).toBe(true);
    expect(await rendersBold(field, 'normal')).toBe(false);
  });

  test('bold toggled on and straight off keeps the caret for the next keys', async ({
    helper,
    page,
  }) => {
    // The second Ctrl+B follows the first at once, so its render is still to
    // come when the first caret placement's bookkeeping is cleared. The bridge
    // must still wait for THIS render before placing the caret: placed on the
    // page as it was, the caret is lost when the frontend's render lands, and
    // the next keys go nowhere.
    const field = await helper.getEditorLocator('mock-block-1', 'value');
    const before = await visibleText(field);
    await field.click();
    await page.keyboard.press('End');
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.type('x');
    await expect.poll(() => adminText(page, 'mock-block-1')).toBe(`${before}x`);
    await expect.poll(() => visibleText(field)).toBe(`${before}x`);
    expect(await rendersBold(field, 'x')).toBe(false);
  });
});
