/**
 * The agent API: what an MCP server drives inside a headless admin.
 *
 * window.__inkaAgent runs each operation through the editor's OWN handlers — the
 * ones its buttons and drag-and-drop call (insertAndSelectBlock, onDeleteBlock,
 * the move handler) — so an agent's edit gets exactly what a person's does:
 * defaults, template membership, container seeding, the structure tidy-up. Each
 * call resolves once the editor's state has taken the change.
 *
 * Saving checks a version first: if anyone saved the page since the agent read
 * it, the save is refused, never merged.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

const slate = (text: string) => [{ type: 'p', children: [{ text }] }];

type Agent = {
  getPage(): { version: string; formData: any };
  insert(op: { refId: string; action: string; field?: string; block: any }): Promise<string>;
  update(op: { id: string; fields: any }): Promise<void>;
  move(op: { id: string; targetId: string; insertAfter: boolean }): Promise<void>;
  remove(id: string): Promise<void>;
  save(op: { expectedVersion: string }): Promise<{ version: string }>;
};

/** Run a function against window.__inkaAgent in the admin page. */
const agent = <T>(page: any, fn: (a: Agent, arg: any) => T | Promise<T>, arg?: any): Promise<T> =>
  page.evaluate(
    ([src, a]: [string, any]) => {
      const run = new Function('agent', 'arg', `return (${src})(agent, arg);`);
      return run((window as any).__inkaAgent, a);
    },
    [fn.toString(), arg],
  );

const layout = (page: any): Promise<string[]> =>
  agent(page, (a) => a.getPage().formData.blocks_layout.items);

test.describe('Agent API', () => {
  test('reads the page, edits it through the editor, and saves with a version check', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    const iframe = helper.getIframe();

    // Read.
    const { version } = await agent(page, (a) => a.getPage());
    expect(version, 'the page has a version to check a save against').toBeTruthy();
    expect(await layout(page)).toContain('block-1-uuid');

    // Insert a paragraph after the first block.
    const newId = await agent(page, (a, arg) => a.insert(arg), {
      refId: 'block-1-uuid', action: 'after', block: { '@type': 'slate', value: slate('Agent paragraph') },
    });
    expect((await layout(page)).slice(0, 2)).toEqual(['block-1-uuid', newId]);
    await expect(iframe.locator(`[data-block-uid="${newId}"]`)).toContainText('Agent paragraph');

    // Change an existing block's field.
    await agent(page, (a, arg) => a.update(arg), { id: 'block-3-uuid', fields: { value: slate('Updated by the agent') } });
    await expect(iframe.locator('[data-block-uid="block-3-uuid"]')).toContainText('Updated by the agent');

    // Move the new paragraph after block-3.
    await agent(page, (a, arg) => a.move(arg), { id: newId, targetId: 'block-3-uuid', insertAfter: true });
    const moved = await layout(page);
    expect(moved.indexOf(newId), 'moved after block-3').toBe(moved.indexOf('block-3-uuid') + 1);

    // Delete a block.
    await agent(page, (a, arg) => a.remove(arg), 'block-2-uuid');
    expect(await layout(page)).not.toContain('block-2-uuid');
    await expect(iframe.locator('[data-block-uid="block-2-uuid"]')).toHaveCount(0);

    // Save against the version read at the start.
    const saved = await agent(page, (a, arg) => a.save(arg), { expectedVersion: version });
    expect(saved.version, 'saving moves the version on').not.toBe(version);
    await expect(page).not.toHaveURL(/\/edit(\?|$)/, { timeout: 15000 });

    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')?.value;
    const stored = await (await page.request.get(`${URLS.mockApi}/_test_data/test-page`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    expect(stored.blocks_layout.items).toContain(newId);
    expect(stored.blocks_layout.items).not.toContain('block-2-uuid');
    expect(JSON.stringify(stored.blocks['block-3-uuid'].value)).toContain('Updated by the agent');
  });

  test('refuses to save when someone else saved the page since it was read', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const { version } = await agent(page, (a) => a.getPage());
    await agent(page, (a, arg) => a.update(arg), { id: 'block-3-uuid', fields: { value: slate('Agent edit') } });

    // Someone else saves the page meanwhile.
    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')?.value;
    const res = await page.request.patch(`${URLS.mockApi}/_test_data/test-page`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      data: { title: 'Changed by someone else' },
    });
    expect(res.ok()).toBeTruthy();

    const refused = await page.evaluate(
      (v) => (window as any).__inkaAgent.save({ expectedVersion: v }).then(() => null, (e: Error) => e.message),
      version,
    );
    expect(refused, 'a stale save must be refused').toMatch(/changed since/i);
    await expect(page, 'still editing: nothing was saved').toHaveURL(/\/edit(\?|$)/);
  });
});
