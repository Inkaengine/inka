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

const slate = (text: string) => [{ type: 'p', children: [{ text }] }];

type Agent = {
  getPage(): { version: string; formData: any };
  insert(op: { refId: string; action: string; field?: string; block: any }): Promise<string>;
  update(op: { id: string; fields: any }): Promise<void>;
  move(op: { id: string; targetId: string; insertAfter: boolean }): Promise<void>;
  remove(id: string): Promise<void>;
  save(op: { expectedVersion: string }): Promise<{ version: string }>;
  holdFile(file: { name: string; type: string; data: string }): Promise<string>;
};

// A 1x1 red PNG, base64: the bytes an agent hands holdFile.
const PNG_BASE64 = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8ffff3f0005fe02fe0000000049454e44ae426082',
  'hex',
).toString('base64');

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
  test('reads the page, edits it through the editor, and saves with a version check', async ({ page, urls }) => {
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
    const stored = await (await page.request.get(`${urls.mockApi}/_test_data/test-page`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    expect(stored.blocks_layout.items).toContain(newId);
    expect(stored.blocks_layout.items).not.toContain('block-2-uuid');
    expect(JSON.stringify(stored.blocks['block-3-uuid'].value)).toContain('Updated by the agent');
  });

  test('holds a file the agent adds until Save, which uploads it beside the page', async ({ page, urls }) => {
    // /deferred-images-page is where the test front end sets deferImageUploads.
    const helper = new AdminUIHelper(page);
    const uploads: any[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.postDataJSON?.()?.['@type'] === 'Image') uploads.push(request.postDataJSON());
    });
    await helper.login();
    await helper.navigateToEdit('/deferred-images-page');
    const { version } = await agent(page, (a) => a.getPage());

    const ref = await agent(page, (a, arg) => a.holdFile(arg), { name: 'agent.png', type: 'image/png', data: PNG_BASE64 });
    expect(ref).toMatch(/^inka-pending:/);
    await agent(page, (a, arg) => a.update(arg), { id: 'image', fields: { url: ref } });
    // The canvas draws it, as it draws an image a person drops.
    const image = helper.getIframe().locator('[data-block-uid="image"] [data-edit-media="url"]');
    await expect(image).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    expect(uploads, 'nothing is uploaded before Save').toHaveLength(0);

    await agent(page, (a, arg) => a.save(arg), { expectedVersion: version });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].image.filename).toBe('agent.png');
    expect(uploads[0].image.data).toBe(PNG_BASE64);

    const stored = await (await page.request.get(`${urls.mockApi}/_test_data/deferred-images-page`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${helper.authToken}` },
    })).json();
    const block = JSON.stringify(stored.blocks.image);
    expect(block, 'the page names the uploaded image').toMatch(/uploaded-image-\d+/);
    expect(block).toContain('"image_scales"');
    expect(block).not.toContain('inka-pending:');
  });

  test("refuses a file when the page's front end doesn't take held images", async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    const refused = await page.evaluate(
      (data) => (window as any).__inkaAgent.holdFile({ name: 'agent.png', type: 'image/png', data }).then(() => null, (e: Error) => e.message),
      PNG_BASE64,
    );
    expect(refused).toMatch(/deferImageUploads/);
  });

  test('refuses to save when someone else saved the page since it was read', async ({ page, urls }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const { version } = await agent(page, (a) => a.getPage());
    await agent(page, (a, arg) => a.update(arg), { id: 'block-3-uuid', fields: { value: slate('Agent edit') } });

    // Someone else saves the page meanwhile.
    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')?.value;
    const res = await page.request.patch(`${urls.mockApi}/_test_data/test-page`, {
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

  test("keeps a template's locked blocks as the editor does; its slots stay the page's to edit", async ({ page }) => {
    // An agent's change to a locked template block used to be accepted and
    // saved, then overwritten by the template on the next load: reported as
    // done, never seen.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    const refusal = (fn: (a: Agent, arg: any) => Promise<unknown>, arg: any) => agent(page, (a, [src, x]) => {
      const run = new Function('a', 'x', `return (${src})(a, x);`);
      return run(a, x).then(() => null, (e: Error) => e.message);
    }, [fn.toString(), arg]);

    // Locked (fixed + read-only): not editable, not removable; the refusal names the template.
    expect(await refusal((a, x) => a.update(x), { id: 'template-header', fields: { value: slate('Changed') } }))
      .toMatch(/template-header.*locked.*\/_test_data\/templates\/test-layout/);
    expect(await refusal((a, x) => a.remove(x), 'template-header')).toMatch(/template-header.*cannot be (re)?moved/);
    // Nothing goes between two of a template's fixed blocks.
    expect(await refusal((a, x) => a.insert(x), { refId: 'template-header', action: 'after', block: { '@type': 'slate', value: slate('Wedged') } }))
      .toMatch(/cannot add .* after template-header/);
    expect(await layout(page)).toContain('template-header');

    // A slot's blocks are the page's own.
    await agent(page, (a, arg) => a.update(arg), { id: 'user-content-1', fields: { value: slate('Slot text by the agent') } });
    await expect(helper.getIframe().locator('[data-block-uid="user-content-1"]')).toContainText('Slot text by the agent');
    await agent(page, (a, arg) => a.remove(arg), 'user-content-2');
    expect(await layout(page)).not.toContain('user-content-2');
  });

  test("a page using a template keeps its blocks' ids from one load to the next", async ({ page }) => {
    // The page doesn't store the template's grid block yet, so loading merges
    // it in. The merge minted it a random id on every load: an agent reads the
    // page in one call and edits it in the next (a fresh editor each time), so
    // the id it had just been given was gone.
    const helper = new AdminUIHelper(page);
    await helper.login();
    const ids = async () => {
      await helper.navigateToEdit('/template-test-page');
      await expect.poll(() => agent(page, (a) => a.getPage().formData.blocks_layout.items.length)).toBeGreaterThan(0);
      const { formData } = await agent(page, (a) => a.getPage());
      return formData.blocks_layout.items.map((id: string) => `${id}:${formData.blocks[id]['@type']}`);
    };
    const first = await ids();
    expect(first.some((id: string) => id.endsWith(':gridBlock')), 'the template merged in its grid').toBe(true);
    await page.goto(helper.contentUrl('/template-test-page'));
    expect(await ids()).toEqual(first);
  });

  test('changes a template as a person does: unlock, edit, lock with "Change on all pages"', async ({ page, urls }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    expect(await agent(page, (a) => a.unlockTemplateOf('template-header'))).toBe('tpl-instance-1');
    expect(await agent(page, (a) => a.unlockTemplateOf('standalone-block-1')), 'a page block has no template').toBeNull();
    await agent(page, (a, arg) => a.update(arg), { id: 'template-header', fields: { value: [{ type: 'h1', children: [{ text: 'Header for every page' }] }] } });
    const saved = await agent(page, (a) => a.lockTemplates());
    expect(saved).toEqual(['/_test_data/templates/test-layout']);

    // The template document itself now has it, so every page using it does.
    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')?.value;
    const template = await (await page.request.get(`${urls.mockApi}/_test_data/templates/test-layout`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    const header = Object.values(template.blocks as Record<string, any>).find((b) => b.slotId === 'header');
    expect(JSON.stringify(header.value)).toContain('Header for every page');
    // Locked again.
    expect(await agent(page, (a) => a.update({ id: 'template-header', fields: {} }).then(() => null, (e: Error) => e.message)))
      .toMatch(/locked/);
  });
});
