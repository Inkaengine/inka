/**
 * Nested lists: indenting, typing, splitting and pasting.
 *
 * The editor keeps an indented item's sub-list BESIDE the item it belongs to
 * (ul > [li, ul]: volto-slate's indent wraps the item where it stands, and
 * Slate will not keep a list beside an item's text inside the item). The
 * frontend draws the sub-list INSIDE its item (ul > li > ul), which is what
 * HTML allows, and the bridge reads it back beside the item.
 *
 * Every test checks the same three things: the stored value is in the
 * editor's shape, the frontend never draws a list directly inside a list, and
 * no text is lost.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

const blockId = 'block-1-uuid';

/** The stored value reduced to types and text: { ul: [{ li: ['Parent'] }, …] }. */
const shape = (n: any): any =>
  n.text !== undefined ? n.text : { [n.type]: n.children.map(shape).filter((c: any) => c !== '') };

const stored = (page: any) =>
  page.evaluate(
    (id: string) => (window as any).__inkaAgent.getPage().formData.blocks[id].value,
    blockId,
  );

async function expectStored(page: any, expected: any) {
  await expect.poll(async () => (await stored(page)).map(shape), { timeout: 5000 }).toEqual(expected);
}

/** No list drawn directly inside a list: HTML's rule, and axe's `list`. */
async function expectValidListHtml(block: any) {
  await expect(block.locator(':is(ul, ol) > :is(ul, ol)')).toHaveCount(0);
}

/** A block holding "- Parent", then "Child" indented under it. */
async function parentWithChild(page: any, helper: AdminUIHelper, block: any) {
  const editor = await helper.enterEditMode(blockId);
  await helper.selectAllTextInEditor(editor);
  await editor.pressSequentially('-', { delay: 10 });
  await editor.press(' ');
  await expect(block.locator('ul li').first()).toBeVisible({ timeout: 5000 });
  await editor.pressSequentially('Parent', { delay: 10 });
  await editor.press('Enter');
  await editor.pressSequentially('Child', { delay: 10 });
  await editor.press('Tab');
  await expect(block.locator('ul > li > ul > li')).toHaveText('Child', { timeout: 5000 });
  // The indent's round trip is over only once the admin holds it: the field
  // is drawn again after it, and an event sent to the old one goes nowhere.
  await expectStored(page, [{ ul: [{ li: ['Parent'] }, { ul: [{ li: ['Child'] }] }] }]);
  return editor;
}

/** Paste `html` (and its plain text) into the focused field, as a browser does. */
async function paste(editor: any, html: string, text: string) {
  await editor.evaluate(
    (el: HTMLElement, [h, t]: [string, string]) => {
      const dt = new DataTransfer();
      dt.setData('text/html', h);
      dt.setData('text/plain', t);
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: dt });
      el.dispatchEvent(event);
    },
    [html, text],
  );
}

test.describe('Nested lists', () => {
  test.beforeEach(async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
  });

  test.describe('indent and type', () => {
    test('an indented item is drawn inside its parent item, and both are still typed into', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const block = helper.getIframe().locator(`[data-block-uid="${blockId}"]`);
      const editor = await parentWithChild(page, helper, block);
      await expectValidListHtml(block);

      // Typing on in the indented item...
      await editor.pressSequentially(' two', { delay: 10 });
      const nested = block.locator('ul > li > ul > li');
      await expect(nested).toHaveText('Child two', { timeout: 5000 });
      // ...and in its parent item, clicked near its top-left corner: the
      // item's box holds the sub-list too.
      await block.locator('ul > li', { hasText: 'Parent' }).first().click({ position: { x: 4, y: 4 } });
      await editor.press('End');
      await editor.pressSequentially(' one', { delay: 10 });

      await expectStored(page, [{ ul: [{ li: ['Parent one'] }, { ul: [{ li: ['Child two'] }] }] }]);
      await expectValidListHtml(block);
    });
  });

  test.describe('split', () => {
    test('Enter in the middle of an indented item makes two indented items', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const block = helper.getIframe().locator(`[data-block-uid="${blockId}"]`);
      const editor = await parentWithChild(page, helper, block);
      // "Child" → "Chi" | "ld"
      await editor.press('ArrowLeft');
      await editor.press('ArrowLeft');
      await editor.press('Enter');

      await expect(block.locator('ul > li > ul > li')).toHaveCount(2, { timeout: 5000 });
      await expectStored(page, [{ ul: [{ li: ['Parent'] }, { ul: [{ li: ['Chi'] }, { li: ['ld'] }] }] }]);
      await expectValidListHtml(block);
    });

    test('Enter at the end of a parent item adds an item at its level; the sub-list follows under the new one', async ({ page }) => {
      // As Google Docs and Word do: the new item goes between the parent and
      // its sub-list, so the sub-list now sits under the new item.
      const helper = new AdminUIHelper(page);
      const block = helper.getIframe().locator(`[data-block-uid="${blockId}"]`);
      const editor = await parentWithChild(page, helper, block);
      await block.locator('ul > li', { hasText: 'Parent' }).first().click({ position: { x: 4, y: 4 } });
      await editor.press('End');
      await editor.press('Enter');
      await editor.pressSequentially('New', { delay: 10 });

      await expectStored(page, [{ ul: [{ li: ['Parent'] }, { li: ['New'] }, { ul: [{ li: ['Child'] }] }] }]);
      await expect(block.locator('ul > li', { hasText: 'New' }).locator('> ul > li')).toHaveText('Child', { timeout: 5000 });
      await expectValidListHtml(block);
    });

    test('Enter on an empty indented item moves it out a level', async ({ page }) => {
      // As Word does. (Enter on an empty top-level item still leaves the list:
      // markdown-shortcuts, "Enter on empty bullet exits list".)
      const helper = new AdminUIHelper(page);
      const block = helper.getIframe().locator(`[data-block-uid="${blockId}"]`);
      const editor = await parentWithChild(page, helper, block);
      await editor.press('Enter');
      await expect(block.locator('ul > li > ul > li')).toHaveCount(2, { timeout: 5000 });
      await editor.press('Enter');
      await expectStored(page, [{ ul: [{ li: ['Parent'] }, { ul: [{ li: ['Child'] }] }, { li: [] }] }]);
      await editor.pressSequentially('Back out', { delay: 10 });

      await expectStored(page, [{ ul: [{ li: ['Parent'] }, { ul: [{ li: ['Child'] }] }, { li: ['Back out'] }] }]);
      await expectValidListHtml(block);
    });
  });

  test.describe('paste', () => {
    test('a nested list copied from a page (the sub-list inside its item) keeps its sub-list', async ({ page }) => {
      // What a browser copies from any page drawing valid HTML, ours included.
      const helper = new AdminUIHelper(page);
      const block = helper.getIframe().locator(`[data-block-uid="${blockId}"]`);
      const editor = await helper.enterEditMode(blockId);
      await helper.selectAllTextInEditor(editor);
      await editor.press('Delete');
      await paste(
        editor,
        '<ul><li>Parent<ul><li>Child</li></ul></li><li>Next</li></ul>',
        'Parent\nChild\nNext',
      );

      await expectStored(page, [{ ul: [{ li: ['Parent'] }, { ul: [{ li: ['Child'] }] }, { li: ['Next'] }] }]);
      await expect(block.locator('ul > li > ul > li')).toHaveText('Child', { timeout: 5000 });
      await expectValidListHtml(block);
    });

    test("a nested list in the editor's own shape (the sub-list beside its item) keeps its sub-list", async ({ page }) => {
      // What a page drawing the editor's shape as it is stored gives a copy.
      const helper = new AdminUIHelper(page);
      const block = helper.getIframe().locator(`[data-block-uid="${blockId}"]`);
      const editor = await helper.enterEditMode(blockId);
      await helper.selectAllTextInEditor(editor);
      await editor.press('Delete');
      await paste(
        editor,
        '<ul><li>Parent</li><ul><li>Child</li></ul><li>Next</li></ul>',
        'Parent\nChild\nNext',
      );

      await expectStored(page, [{ ul: [{ li: ['Parent'] }, { ul: [{ li: ['Child'] }] }, { li: ['Next'] }] }]);
      await expectValidListHtml(block);
    });

    test('a list pasted after text stays a list, in the next block', async ({ page }) => {
      // Slate's own insertFragment merged the first item into the paragraph
      // and split the rest out as blocks of bare list items.
      const helper = new AdminUIHelper(page);
      const editor = await helper.enterEditMode(blockId);
      await helper.selectAllTextInEditor(editor);
      await editor.pressSequentially('Before', { delay: 10 });
      await helper.waitForEditorText(editor, /^Before$/);
      await expectStored(page, [{ p: ['Before'] }]);
      await editor.press('End');
      await paste(
        editor,
        '<ul><li>Parent<ul><li>Child</li></ul></li><li>Next</li></ul>',
        'Parent\nChild\nNext',
      );

      await expectStored(page, [{ p: ['Before'] }]);
      const next = () =>
        page.evaluate((id: string) => {
          const fd = (window as any).__inkaAgent.getPage().formData;
          const items = fd.blocks_layout.items;
          // null until the paste's block is there: it follows the paste.
          return fd.blocks[items[items.indexOf(id) + 1]].value ?? null;
        }, blockId);
      await expect
        .poll(async () => (await next())?.map(shape) ?? null, { timeout: 5000 })
        .toEqual([{ ul: [{ li: ['Parent'] }, { ul: [{ li: ['Child'] }] }, { li: ['Next'] }] }]);
    });

    test('plain text pasted into an indented item stays in that item', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const block = helper.getIframe().locator(`[data-block-uid="${blockId}"]`);
      const editor = await parentWithChild(page, helper, block);
      await editor.evaluate((el: HTMLElement) => {
        const dt = new DataTransfer();
        dt.setData('text/plain', ' pasted');
        const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: dt });
        el.dispatchEvent(event);
      });

      await expectStored(page, [{ ul: [{ li: ['Parent'] }, { ul: [{ li: ['Child pasted'] }] }] }]);
      await expectValidListHtml(block);
    });
  });
});
