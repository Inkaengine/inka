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
async function freshTemplatePage(token: string, { emptySection = false } = {}): Promise<{ template: string; page: string }> {
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
    },
    blocks_layout: { items: ['head', 'body', ...(emptySection ? ['aside'] : [])] },
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
    },
    blocks_layout: { items: ['h', 'b', ...(emptySection ? ['s'] : [])] },
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
