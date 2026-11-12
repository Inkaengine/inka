/**
 * inka#705: editing a page changed the templates it uses, though the author
 * never meant to. A template is written by its own commit ("Change on all
 * pages") with what the author changed in it, and by nothing else.
 */
import { test, expect } from '../fixtures';
import { randomUUID } from 'node:crypto';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { whileEditing } from '../helpers/otherUser';
import { URLS } from '../ports';

const TEMPLATE_HEADER_CONTENT = 'Template Header - From Template';

/** Every write (PATCH, POST) to the mock API, by path. */
function recordWrites(page: any, mockApi: string) {
  const writes: Array<{ method: string; path: string }> = [];
  page.on('request', (req: any) => {
    const method = req.method();
    if (method !== 'PATCH' && method !== 'POST') return;
    if (!req.url().startsWith(mockApi)) return;
    writes.push({ method, path: new URL(req.url()).pathname });
  });
  return writes;
}
// Writes to a template document itself; its @lock is not one.
const templateWrites = (writes: Array<{ path: string }>) => writes.filter((w) => /\/templates\//.test(w.path) && !w.path.endsWith('/@lock'));

test.describe('a template is written only by its own commit', () => {
  // Case 1: every page save PATCHed every template the page used, unlocked or
  // not, so an editor's cached copy (and whatever had drifted in it) reached
  // every page, over anyone else's later change.
  test('saving a page writes no template it never unlocked', async ({ page, urls }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    const writes = recordWrites(page, urls.mockApi);

    const editor = await helper.enterEditMode('standalone-block-1');
    await helper.moveCursorToEnd(editor);
    await editor.pressSequentially(' edited', { delay: 10 });
    await helper.saveContent();

    await expect.poll(() => writes.filter((w) => w.path.endsWith('/template-test-page')).length,
      { message: 'the page itself is saved' }).toBeGreaterThanOrEqual(1);
    expect(templateWrites(writes), 'no template is written by a page save').toEqual([]);
  });

  test("a template's commit writes it once, and the page save after it doesn't again", async ({ page, urls }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    const writes = recordWrites(page, urls.mockApi);

    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.unlockTemplate(headerBlockId);
    const header = await helper.enterEditMode(headerBlockId);
    await helper.moveCursorToEnd(header);
    await header.pressSequentially(' changed', { delay: 10 });
    await helper.lockTemplate(headerBlockId, 'commit');
    await expect.poll(() => templateWrites(writes).length, { message: 'the commit writes the template' }).toBe(1);

    await helper.saveContent();
    await expect.poll(() => writes.filter((w) => w.path.endsWith('/template-test-page')).length,
      { message: 'the page itself is saved' }).toBeGreaterThanOrEqual(1);
    expect(templateWrites(writes), 'the page save writes no template').toHaveLength(1);
  });
});

/**
 * A template and a page using it, of the test's own: a lock is the document's,
 * seen by every user, so locking a shared fixture template would refuse the
 * unlocks of every other test using it at the same time.
 */
async function freshTemplatePage(token: string, { emptySection = false, framed = false } = {}): Promise<{ template: string; page: string }> {
  const post = async (folder: string, body: object) => {
    const response = await fetch(`${URLS.mockApi}${folder}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(201);
    return new URL((await response.json())['@id']).pathname;
  };
  const id = `own-template-${randomUUID()}`;
  const template = await post('/_test_data/templates', {
    '@type': 'Document', id, title: 'A template of its own',
    blocks: {
      head: { '@type': 'slate', templateId: `/_test_data/templates/${id}`, slotId: 'head', fixed: true, readOnly: true,
        value: [{ type: 'p', children: [{ text: 'Its own heading' }] }], plaintext: 'Its own heading' },
      body: { '@type': 'slate', templateId: `/_test_data/templates/${id}`, slotId: 'default',
        value: [{ type: 'p', children: [{ text: 'Its slot' }] }], plaintext: 'Its slot' },
      ...(emptySection && { aside: { '@type': 'section', templateId: `/_test_data/templates/${id}`, slotId: 'aside', fixed: true, readOnly: true,
        blocks: {}, blocks_layout: { items: [] } } }),
      // A locked section holding a fixed heading of its own, as a layout's hero holds its title.
      ...(framed && { frame: { '@type': 'section', templateId: `/_test_data/templates/${id}`, slotId: 'frame', fixed: true, readOnly: true,
        blocks: { framed: { '@type': 'slate', templateId: `/_test_data/templates/${id}`, slotId: 'framed', fixed: true, readOnly: true,
          value: [{ type: 'p', children: [{ text: 'Framed heading' }] }], plaintext: 'Framed heading' } },
        blocks_layout: { items: ['framed'] } } }),
    },
    blocks_layout: { items: ['head', 'body', ...(emptySection ? ['aside'] : []), ...(framed ? ['frame'] : [])] },
  });
  const instance = `instance-${randomUUID()}`;
  const page = await post('/_test_data', {
    '@type': 'Document', id: `own-page-${randomUUID()}`, title: 'A page using it',
    blocks: {
      h: { '@type': 'slate', templateId: template, templateInstanceId: instance, slotId: 'head', fixed: true, readOnly: true,
        value: [{ type: 'p', children: [{ text: 'Its own heading' }] }], plaintext: 'Its own heading' },
      b: { '@type': 'slate', templateId: template, templateInstanceId: instance, slotId: 'default',
        value: [{ type: 'p', children: [{ text: 'Page text' }] }], plaintext: 'Page text' },
      ...(emptySection && { s: { '@type': 'section', templateId: template, templateInstanceId: instance, slotId: 'aside', fixed: true, readOnly: true,
        blocks: {}, blocks_layout: { items: [] } } }),
      ...(framed && {
        f: { '@type': 'section', templateId: template, templateInstanceId: instance, slotId: 'frame', fixed: true, readOnly: true,
          blocks: { fh: { '@type': 'slate', templateId: template, templateInstanceId: instance, slotId: 'framed', fixed: true, readOnly: true,
            value: [{ type: 'p', children: [{ text: 'Framed heading' }] }], plaintext: 'Framed heading' } },
          blocks_layout: { items: ['fh'] } },
        // The page's own, outside the template.
        own: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Not the template' }] }], plaintext: 'Not the template' },
      }),
    },
    blocks_layout: { items: ['h', 'b', ...(emptySection ? ['s'] : []), ...(framed ? ['f', 'own'] : [])] },
  });
  return { template, page };
}

/**
 * The lock on `path`, as the site reports it. Read in the session of `token`
 * (the browser's): the mock keeps content per session, and the test's own
 * template is only in that one. The lock itself is seen by every session.
 */
async function lockOf(path: string, token: string) {
  const response = await fetch(`${URLS.mockApi}${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
  expect(response.status).toBe(200);
  return (await response.json()).lock;
}

test.describe('unlocking a template locks it on the site, as editing a page does', () => {
  test('unlocking takes its lock, and the save that commits it lets it go', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    const { template, page: path } = await freshTemplatePage(helper.authToken);
    await helper.navigateToEdit(path);

    const { blockId: head } = await helper.waitForBlockByContent('Its own heading');
    await helper.unlockTemplate(head);
    await expect.poll(async () => (await lockOf(template, helper.authToken))?.locked, { message: 'unlocking locks the template' }).toBe(true);

    const editor = await helper.enterEditMode(head);
    await helper.moveCursorToEnd(editor);
    await editor.pressSequentially(' changed', { delay: 10 });
    await helper.lockTemplate(head, 'commit');
    await expect.poll(async () => (await lockOf(template, helper.authToken))?.locked, { message: 'committing lets it go' }).toBe(false);
  });

  for (const how of ['unchanged', 'reset'] as const) {
    test(`locking it again ${how === 'reset' ? 'with Reset' : 'unchanged'} lets its lock go`, async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      const { template, page: path } = await freshTemplatePage(helper.authToken);
      await helper.navigateToEdit(path);

      const { blockId: head } = await helper.waitForBlockByContent('Its own heading');
      await helper.unlockTemplate(head);
      await expect.poll(async () => (await lockOf(template, helper.authToken))?.locked).toBe(true);
      if (how === 'reset') {
        const editor = await helper.enterEditMode(head);
        await helper.moveCursorToEnd(editor);
        await editor.pressSequentially(' changed', { delay: 10 });
        await helper.lockTemplate(head, 'reset');
      } else {
        await helper.clickBlockInIframe(head);
        await page.locator('.quanta-toolbar .template-lock-toggle').click();
        await expect(page.locator('.quanta-toolbar .template-lock-toggle')).toHaveAttribute('aria-pressed', 'false');
      }
      await expect.poll(async () => (await lockOf(template, helper.authToken))?.locked).toBe(false);
    });
  }

  test("Cancel in the lock dialog keeps the template unlocked, and so keeps its lock", async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    const { template, page: path } = await freshTemplatePage(helper.authToken);
    await helper.navigateToEdit(path);

    const { blockId: head } = await helper.waitForBlockByContent('Its own heading');
    await helper.unlockTemplate(head);
    const editor = await helper.enterEditMode(head);
    await helper.moveCursorToEnd(editor);
    await editor.pressSequentially(' changed', { delay: 10 });
    await helper.lockTemplate(head, 'cancel');
    await expect(page.locator('.quanta-toolbar .template-lock-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect((await lockOf(template, helper.authToken))?.locked, 'still being edited, so still locked').toBe(true);
  });

  test("cancelling the page's edit while a template is unlocked lets the template's lock go", async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    const { template, page: path } = await freshTemplatePage(helper.authToken);
    await helper.navigateToEdit(path);

    const { blockId: head } = await helper.waitForBlockByContent('Its own heading');
    await helper.unlockTemplate(head);
    await expect.poll(async () => (await lockOf(template, helper.authToken))?.locked).toBe(true);
    await page.getByRole('navigation', { name: 'Toolbar' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(page).not.toHaveURL(/\/edit$/);
    await expect.poll(async () => (await lockOf(template, helper.authToken))?.locked, { message: 'leaving the editor lets it go' }).toBe(false);
  });

  test('a template someone else has unlocked can not be unlocked, and says who has it', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    const { template, page: path } = await freshTemplatePage(helper.authToken);
    await helper.navigateToEdit(path);
    const { blockId: head } = await helper.waitForBlockByContent('Its own heading');

    await whileEditing('jane', template, async () => {
      await helper.clickBlockInIframe(head);
      const toggle = page.locator('.quanta-toolbar .template-lock-toggle');
      await toggle.click();
      await page.locator('.template-unlock-modal .template-confirm').click();
      await expect(page.locator('.Toastify'), 'the author is told who has it').toContainText('jane');
      await expect(toggle, 'it stays locked').toHaveAttribute('aria-pressed', 'false');
      expect((await lockOf(template, helper.authToken)).creator, "jane's lock is left as it is").toBe('jane');
    });
  });
});

/** The template as the site has it now, in the session of `token`. */
async function stored(path: string, token: string) {
  const response = await fetch(`${URLS.mockApi}${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
  expect(response.status).toBe(200);
  return response.json();
}

test.describe("a commit stores the author's change and nothing the editor made", () => {
  // Case 2: an empty region of a locked block is given an `empty` placeholder
  // in the editor (#700). A commit stored them as the template's own blocks.
  test('the placeholders in empty regions are not stored', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    const { template, page: path } = await freshTemplatePage(helper.authToken, { emptySection: true });
    await helper.navigateToEdit(path);

    const { blockId: head } = await helper.waitForBlockByContent('Its own heading');
    await helper.unlockTemplate(head);
    const editor = await helper.enterEditMode(head);
    await helper.moveCursorToEnd(editor);
    await editor.pressSequentially(' changed', { delay: 10 });
    await helper.lockTemplate(head, 'commit');

    await expect.poll(async () => JSON.stringify((await stored(template, helper.authToken)).blocks), { message: 'the edit is stored' })
      .toContain('Its own heading changed');
    const saved = await stored(template, helper.authToken);
    expect(JSON.stringify(saved), 'no placeholder is stored').not.toContain('"@type":"empty"');
    const aside = Object.values(saved.blocks).find((b: any) => b['@type'] === 'section') as any;
    expect(aside.blocks_layout.items, 'the empty region is stored empty').toEqual([]);
  });
});

test.describe("a block the author adds in a template's empty region", () => {
  // Case 5: added with the sidebar's "+" while the template was unlocked, it
  // was stored fixed and read-only beside the placeholder, so no page could
  // edit it.
  test('replaces the placeholder, and stays the author\'s to edit', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    const { template, page: path } = await freshTemplatePage(helper.authToken, { emptySection: true });
    await helper.navigateToEdit(path);

    const { blockId: head } = await helper.waitForBlockByContent('Its own heading');
    await helper.unlockTemplate(head);
    // An empty section's body is its placeholder: click it, then Escape up to the section.
    await helper.getIframe().locator('[data-block-uid="s"]').first().click();
    await page.keyboard.press('Escape');
    await helper.waitForBlockSelectedInAdmin('s');
    await helper.addBlockViaSidebar('Blocks', 'Text');
    await helper.lockTemplate(head, 'commit');

    await expect.poll(async () => {
      const saved = await stored(template, helper.authToken);
      const aside = Object.values(saved.blocks).find((b: any) => b['@type'] === 'section') as any;
      return aside.blocks_layout.items.map((id: string) => aside.blocks[id]).map((b: any) => [b['@type'], !!b.fixed, !!b.readOnly]);
    }, { message: 'the section holds the added block alone, editable' }).toEqual([['slate', false, false]]);
  });
});

test.describe("a commit is checked as a page save is", () => {
  // Case 6: a commit was checked for slot grouping only, so a template could be
  // stored with blocks its own rules refuse on any page that uses it.
  test("a template that breaks its blocks' rules is not saved, and says why", async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    const { template, page: path } = await freshTemplatePage(helper.authToken, { emptySection: true });
    await helper.navigateToEdit(path);
    const writes = recordWrites(page, URLS.mockApi);

    const { blockId: head } = await helper.waitForBlockByContent('Its own heading');
    await helper.unlockTemplate(head);
    await helper.getIframe().locator('[data-block-uid="s"]').first().click();
    await page.keyboard.press('Escape');
    await helper.waitForBlockSelectedInAdmin('s');
    // An image with no image: its `url` is required.
    await helper.addBlockViaSidebar('Blocks', 'Image');

    await helper.clickBlockInIframe(head);
    await page.locator('.quanta-toolbar .template-lock-toggle').click();
    await page.locator('.template-lock-modal .template-commit').click();

    await expect(page.locator('.Toastify'), 'the author is told why').toContainText(/image|required/i);
    await expect(page.locator('.quanta-toolbar .template-lock-toggle'), 'it stays unlocked to fix').toHaveAttribute('aria-pressed', 'true');
    expect(templateWrites(writes), 'the template is not written').toEqual([]);
    expect(JSON.stringify((await stored(template, helper.authToken)).blocks)).not.toContain('"@type":"image"');
  });
});

test.describe('a drop goes only where it is allowed, and where its indicator can be seen', () => {
  // Case 4: the layout's title, dragged over a paragraph in `main`, landed at
  // page level after the layout block: where the drag walked up to, at an edge
  // the author could not see.
  const blockOrder = async (iframe: any) => Promise.all((await iframe.locator('[data-block-uid]').all())
    .map((b: any) => b.getAttribute('data-block-uid')));

  test('a block allowed in only one container is dropped nowhere else', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');
    const iframe = helper.getIframe();
    await helper.waitForIframeBlockHandle('col-2').catch(() => {});
    const before = await blockOrder(iframe);

    await helper.dragBlockAfterNoReorderAssert('col-2', 'text-after');

    await expect.poll(() => blockOrder(iframe), { message: 'nothing moved' }).toEqual(before);
    await expect(iframe.locator('[data-block-uid="columns-1"] [data-block-uid="col-2"]'), 'still in its columns').toHaveCount(1);
  });

  test('a drop whose place is off-screen is refused', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    // A page of its own: a columns block far taller than the window, and a
    // section after it. A section can't go in a column.
    const paras = Object.fromEntries(Array.from({ length: 40 }, (_, n) => [`p${n}`,
      { '@type': 'slate', value: [{ type: 'p', children: [{ text: `Paragraph ${n}` }] }], plaintext: `Paragraph ${n}` }]));
    const response = await fetch(`${URLS.mockApi}/_test_data`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${helper.authToken}` },
      body: JSON.stringify({
        '@type': 'Document', id: `own-page-${randomUUID()}`, title: 'A tall page',
        blocks: {
          cols: { '@type': 'columns', blocks: { col: { '@type': 'column', blocks: paras, blocks_layout: { items: Object.keys(paras) } } }, blocks_layout: { columns: ['col'] } },
          sec: { '@type': 'section', blocks: { inner: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'In the section' }] }], plaintext: 'In the section' } }, blocks_layout: { items: ['inner'] } },
        },
        blocks_layout: { items: ['cols', 'sec'] },
      }),
    });
    expect(response.status).toBe(201);
    await helper.navigateToEdit(new URL((await response.json())['@id']).pathname);
    const iframe = helper.getIframe();
    const before = await blockOrder(iframe);

    // A section's body is its children: select one, then Escape up to the section.
    await helper.clickBlockInIframe('inner');
    await helper.escapeFromEditing();
    await page.keyboard.press('Escape');
    await helper.waitForBlockSelectedInAdmin('sec');

    // Over a paragraph just past the middle of the columns (clear of the window's
    // edges, where a drag scrolls), the drag walks up to the columns block, to
    // after it: its bottom edge, far below the window.
    await helper.dragBlockWithMouseNoDrop(page.locator('.quanta-toolbar'), iframe.locator('[data-block-uid="p21"]').first(), true);
    const columnsBottom = await iframe.locator('[data-block-uid="cols"]').first().evaluate((el: Element) => el.getBoundingClientRect().bottom - window.innerHeight);
    expect(columnsBottom, "the columns block's bottom edge is out of sight").toBeGreaterThan(0);
    await expect(iframe.locator('.volto-hydra-drop-indicator:visible'), 'no indicator for a place out of sight').toHaveCount(0);
    await page.mouse.up();

    await expect.poll(() => blockOrder(iframe), { message: 'nothing moved' }).toEqual(before);
  });
});
