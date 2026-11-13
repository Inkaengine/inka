/**
 * A save the CMS can't take tells the author what happened, in her terms.
 *
 * A production author got "Error: 'dict' object has no attribute 'startswith'"
 * on nine saves running and asked what it meant. Plone's block deserializer
 * calls `.startswith` on every link `@id` in every block, and one that isn't a
 * string crashed the whole save (500) without naming the block.
 *
 * - A link the CMS can't store is refused in the editor, naming the block and
 *   its field, and never sent.
 * - Any save the CMS crashes on says the page wasn't saved and the changes are
 *   still here, and keeps the server's words for whoever supports the site.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/** Make a page in this login's session: broken on purpose, so never a committed fixture. */
async function createPage(page: any, mockApi: string, id: string, blocks: Record<string, any>) {
  const token = (await page.context().cookies()).find((c: any) => c.name === 'auth_token')!.value;
  const created = await page.request.post(`${mockApi}/_test_data`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    data: {
      '@type': 'Document',
      id,
      title: id,
      blocks,
      blocks_layout: { items: Object.keys(blocks) },
    },
  });
  expect(created.status()).toBe(201);
}

const intro = (text: string) => ({ '@type': 'slate', value: [{ type: 'p', children: [{ text }] }] });

/** Every PATCH of the page itself. */
function pagePatches(page: any, mockApi: string, id: string) {
  const patches: string[] = [];
  page.on('request', (req: any) => {
    if (req.method() === 'PATCH' && req.url().startsWith(mockApi) && new URL(req.url()).pathname.endsWith(`/${id}`)) {
      patches.push(req.url());
    }
  });
  return patches;
}

test.describe('a save the CMS cannot take', () => {
  test("a link the CMS can't store is refused in the editor, naming its block", async ({ page, urls }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    // The production traceback put the bad value one level into a block: a field
    // holding `{ '@id': <not a string> }`. It sits on a text block here because
    // the check doesn't depend on a block's type, and the test frontend's own
    // renderers can't draw such a link either (its teaser throws on it).
    await createPage(page, urls.mockApi, 'unstorable-link-page', {
      'intro-1': {
        ...intro('This block holds a link whose address is an object, not text.'),
        link: { '@id': { '@id': '/_test_data/test-page', title: 'Test page' } },
      },
    });
    const patches = pagePatches(page, urls.mockApi, 'unstorable-link-page');
    await helper.navigateToEdit('/unstorable-link-page');
    await expect(helper.getIframe().locator('[data-block-uid="intro-1"]')).toBeVisible({ timeout: 15000 });

    await page.locator('#toolbar-save, button:has-text("Save")').first().click();

    const alert = page.getByRole('alert').filter({ hasText: "Can't save yet" });
    await expect(alert).toBeVisible({ timeout: 10000 });
    await expect(alert).toContainText("This link can't be saved");
    await expect(alert.locator('.block-save-error-link')).toHaveCount(1);
    await expect(page).toHaveURL(/\/edit(\?|$)/);
    expect(patches, 'the page is never sent').toEqual([]);
  });

  test("a save the CMS crashes on says the page wasn't saved and the work is still here", async ({ page, urls }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await createPage(page, urls.mockApi, 'server-crash-page', {
      'intro-1': intro('Saving this page fails on the server.'),
    });
    // The CMS crashes on this page's save, as Plone did: a 500 with its JSON error.
    await page.route(
      (url: URL) => url.origin === urls.mockApi && url.pathname.endsWith('/server-crash-page'),
      (route: any) => route.request().method() === 'PATCH'
        ? route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ type: 'AttributeError', message: "'dict' object has no attribute 'startswith'" }),
        })
        : route.fallback(),
    );
    await helper.navigateToEdit('/server-crash-page');
    const editor = await helper.enterEditMode('intro-1');
    await helper.moveCursorToEnd(editor);
    await editor.pressSequentially(' edited', { delay: 10 });

    await page.locator('#toolbar-save, button:has-text("Save")').first().click();

    const alert = page.getByRole('alert').filter({ hasText: "wasn't saved" });
    await expect(alert).toBeVisible({ timeout: 10000 });
    await expect(alert).toContainText('changes are still here');
    await expect(alert).toContainText("AttributeError: 'dict' object has no attribute 'startswith'");
    await expect(page).toHaveURL(/\/edit(\?|$)/);
    await expect(helper.getIframe().locator('[data-block-uid="intro-1"]')).toContainText('edited');
  });
});
