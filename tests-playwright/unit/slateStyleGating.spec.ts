/**
 * The slate style allow-list (#295) has to hold at the KEYBOARD, not only at
 * the toolbar. A markdown shortcut and a format hotkey both consume the
 * keystroke before the admin ever sees it — rejecting them admin-side is too
 * late, so the bridge checks the rules that ride on its blockPathMap entry.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

const BLOCK = 'mock-block-1';

type Rules = {
  allowedStyles?: string[] | null;
  disallowedStyles?: string[] | null;
} | null;

/**
 * Put `text` in the block's edit field with the cursor at its end, arm the
 * given rules, then run `action` and report every transform the bridge tried
 * to send.
 */
async function withRules(
  iframe: ReturnType<AdminUIHelper['getIframe']>,
  { text, rules, action }: { text: string; rules: Rules; action: 'space' | 'bold' },
) {
  return await iframe.locator('body').evaluate(
    (_el: Element, { blockId, text, rules, action }: any) => {
      const bridge = (window as any).bridge;
      const blockEl = document.querySelector(`[data-block-uid="${blockId}"]`)!;
      const editField = (blockEl.querySelector('[data-edit-text]') || blockEl) as HTMLElement;
      bridge.blockTextMutationObserver?.disconnect();
      editField.innerHTML = `<p>${text}</p>`;

      bridge.selectedBlockUid = blockId;
      bridge.focusedFieldName = 'value';
      bridge.isInlineEditing = true;
      bridge.blockPathMap = {
        ...(bridge.blockPathMap || {}),
        [blockId]: { ...(bridge.blockPathMap?.[blockId] || {}), ...(rules ? { slateRules: rules } : {}) },
      };
      bridge.slateConfig = { hotkeys: { 'mod+b': { type: 'inline', format: 'strong' } }, toolbarButtons: [] };
      // Every field of this mock block is slate for the purposes of the check.
      bridge.isSlateField = () => true;

      const sent: any[] = [];
      bridge.sendTransformRequest = (uid: string, type: string, fields: any) => {
        sent.push({ type, ...fields });
        return 'stub-request-id';
      };

      const textNode = editField.querySelector('p')!.firstChild as Text;
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.setStart(textNode, textNode.length);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      let handled: boolean;
      if (action === 'space') {
        handled = bridge.handleSpaceKey(blockId);
      } else {
        handled = bridge.handleSpecialKey(
          blockId,
          { key: 'b', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, preventDefault() {}, stopPropagation() {} },
          editField,
        );
      }
      return { handled, sent };
    },
    { blockId: BLOCK, text, rules, action },
  );
}

test.describe('slate style gating in the bridge', () => {
  let helper: AdminUIHelper;

  test.beforeEach(async ({ page }) => {
    helper = new AdminUIHelper(page);
    await page.goto(`${URLS.testFrontend}/mock-parent.html`);
    await helper.waitForIframeReady();
    await helper.waitForIframeBlockHandle(BLOCK);
  });

  test('markdown "> " converts to blockquote when nothing is declared', async () => {
    const iframe = helper.getIframe();
    const { handled, sent } = await withRules(iframe, { text: '>', rules: null, action: 'space' });
    expect(handled).toBe(true);
    expect(sent).toEqual([{ type: 'markdown', markdownType: 'block', blockType: 'blockquote' }]);
  });

  test('markdown "> " is inert when blockquote is denied — the space just types', async () => {
    const iframe = helper.getIframe();
    const { handled, sent } = await withRules(iframe, {
      text: '>',
      rules: { disallowedStyles: ['blockquote'] },
      action: 'space',
    });
    expect(sent).toEqual([]);
    expect(handled).toBe(false);
  });

  test('a denied style does not disable the OTHER markdown shortcuts', async () => {
    const iframe = helper.getIframe();
    const { sent } = await withRules(iframe, {
      text: '##',
      rules: { disallowedStyles: ['blockquote'] },
      action: 'space',
    });
    expect(sent).toEqual([{ type: 'markdown', markdownType: 'block', blockType: 'h2' }]);
  });

  test('an inline markdown shortcut obeys the list too', async () => {
    const iframe = helper.getIframe();
    const denied = await withRules(iframe, {
      text: '**bold**',
      rules: { allowedStyles: ['p'] },
      action: 'space',
    });
    expect(denied.sent).toEqual([]);
    const allowed = await withRules(iframe, {
      text: '**bold**',
      rules: { allowedStyles: ['p', 'strong'] },
      action: 'space',
    });
    expect(allowed.sent).toEqual([{ type: 'markdown', markdownType: 'inline', inlineType: 'strong' }]);
  });

  test('a format hotkey for a denied style sends nothing', async () => {
    const iframe = helper.getIframe();
    const allowed = await withRules(iframe, { text: 'x', rules: null, action: 'bold' });
    expect(allowed.sent).toEqual([{ type: 'format', format: 'strong' }]);

    const denied = await withRules(iframe, {
      text: 'x',
      rules: { disallowedStyles: ['strong'] },
      action: 'bold',
    });
    expect(denied.sent).toEqual([]);
  });
});
