/**
 * Helpers for tests that drive a frontend through mock-parent.html: acting as
 * the admin, and reading what the frontend drew the way an author sees it.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { AdminUIHelper } from './AdminUIHelper';

/**
 * Act like the admin after an inline edit: send the next FORM_DATA — the page as
 * the admin now holds it (with the edit), plus a change to ANOTHER block. The
 * real admin does this whenever anything else changes (a block added, a sidebar
 * field set). Echoes of the edit itself are not re-rendered, so this is what
 * re-renders the edited block; a bug that only shows on the next render (text
 * the bridge typed into a node the frontend didn't render) needs it.
 *
 * `otherBlock` must be a slate block other than the one being edited. Returns
 * once that block shows `marker`, so the re-render has happened.
 */
export async function sendAdminUpdate(
  page: Page,
  helper: AdminUIHelper,
  otherBlock: string,
  marker: string,
): Promise<void> {
  await page.evaluate(
    ({ otherBlock, marker }) => {
      const mockParent = (window as any).mockParent;
      const data = JSON.parse(JSON.stringify(mockParent.getFormData()));
      data.blocks[otherBlock].value = [{ type: 'p', children: [{ text: marker }] }];
      (document.getElementById('previewIframe') as HTMLIFrameElement).contentWindow!.postMessage(
        { type: 'FORM_DATA', data, blockPathMap: mockParent.buildBlockPathMap() },
        '*',
      );
    },
    { otherBlock, marker },
  );
  await expect(helper.getIframe().locator(`[data-block-uid="${otherBlock}"]`)).toContainText(marker);
}

/** The admin's copy of a block's slate text, as the bridge last sent it. */
export function adminText(page: Page, blockId: string): Promise<string> {
  return page.evaluate((id) => {
    const walk = (n: any): string =>
      typeof n?.text === 'string' ? n.text : (n?.children || []).map(walk).join('');
    return ((window as any).mockParent.getBlock(id)?.value || []).map(walk).join('');
  }, blockId);
}

/**
 * A field's text as the reader sees it: the bridge's zero-width characters
 * removed, and a non-breaking space (what the browser inserts for a space typed
 * at the end of a run) read as a space, as the bridge reads it back.
 */
export function visibleText(field: Locator): Promise<string> {
  return field.evaluate((el) =>
    (el.textContent || '').replace(/[\uFEFF\u200B]/g, '').replace(/\u00A0/g, ' '),
  );
}

/**
 * Whether `text` renders bold, judged by its computed font weight — never by
 * markup. Frontends render bold however they like (one may use
 * <span style="font-weight: bold">, not <strong>), so a test
 * must not assume an element.
 */
export function rendersBold(field: Locator, text: string): Promise<boolean> {
  return field.evaluate((el, t) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const plain = (n.textContent || '').replace(/[\uFEFF\u200B]/g, '').replace(/\u00A0/g, ' ');
      if (plain.includes(t)) {
        return Number(getComputedStyle(n.parentElement as Element).fontWeight) >= 600;
      }
    }
    return false;
  }, text);
}

/**
 * The text nodes under a field that contain `text` (the bridge's zero-width
 * characters ignored) — one, unless it is shown twice. On a mismatch the
 * assertion shows `all`, every text node's content, to tell a doubled text
 * from one split across nodes.
 */
export function textNodesWith(field: Locator, text: string): Promise<{ found: string[]; all: string[] }> {
  return field.evaluate((el, t) => {
    const found: string[] = [];
    const all: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const raw = n.textContent || '';
      all.push(JSON.stringify(raw));
      if (raw.replace(/[\uFEFF\u200B]/g, '').replace(/\u00A0/g, ' ').includes(t)) found.push(raw);
    }
    return { found, all };
  }, text);
}
