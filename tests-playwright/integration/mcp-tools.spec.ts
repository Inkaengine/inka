/**
 * The MCP tools against a real (headless-style) admin: get_page reads the page
 * in the agent format; edit_blocks applies operations through the agent API,
 * as a dry run (nothing saved) or for real (saved against the version read).
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';
import { agentOn, waitForAgent, discardEdits, createPage, siteOn } from '../../packages/inka-mcp/adminDriver.mjs';
import {
  getPage, editPage, listBlockTypes, describeBlock, search, listChildren, fillNewPage, movePage, renamePage, deletePage,
} from '../../packages/inka-mcp/tools.mjs';
import { frontendUrlOf, previewDraft } from '../../packages/inka-mcp/preview.mjs';

const mintId = () => crypto.randomUUID();

test.describe('MCP tools', () => {
  test('get_page, a dry run, then a real edit', async ({ page }) => {
    // Loads the editor twice (the discard is a full reload) and saves.
    test.setTimeout(90000);
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await waitForAgent(page);
    const agent = agentOn(page);

    // get_page: the agent format — uids, markdown rich text.
    const read = await getPage(agent);
    expect(read.version).toBeTruthy();
    const first = read.blocks.find((b) => b['@uid'] === 'block-1-uuid');
    expect(first['@type']).toBe('slate');
    expect(typeof first.value.md).toBe('string');

    // A dry run shows the result without saving.
    const ops = [{ op: 'add', after: 'block-1-uuid', blocks: [{ '@uid': 'from-mcp', '@type': 'slate', value: 'Added *by the MCP*' }] }];
    const dry = await editPage(agent, { ops, expectedVersion: read.version, dryRun: true, mintId });
    const added = dry.page.blocks.find((b) => b['@uid'] === dry.ids['from-mcp']);
    expect(added?.value.md).toBe('Added *by the MCP*');
    await expect(helper.getIframe().locator(`[data-block-uid="${dry.ids['from-mcp']}"]`)).toContainText('Added by the MCP');

    // Discard: a full reload, and the page is as it was.
    await discardEdits(page);
    const reread = await getPage(agent);
    expect(reread.blocks.map((b) => b['@uid'])).toEqual(read.blocks.map((b) => b['@uid']));

    // For real: saved against the version read.
    const done = await editPage(agent, { ops, expectedVersion: reread.version, mintId });
    expect(done.version).not.toBe(reread.version);
    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')?.value;
    const stored = await (await page.request.get(`${URLS.mockApi}/_test_data/test-page`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    expect(stored.blocks_layout.items[1]).toBe(done.ids['from-mcp']);
  });

  test('edit_blocks refuses a version the page has moved past', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await waitForAgent(page);
    const agent = agentOn(page);
    await expect(editPage(agent, { ops: [], expectedVersion: 'an-old-version', mintId }))
      .rejects.toThrow(/changed since it was read/);
  });

  test('list_block_types: what the page takes, fields and regions', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await waitForAgent(page);
    const described = await listBlockTypes(agentOn(page));

    const pageList = described.page.find((r) => r.field === 'blocks');
    expect(pageList.allowed).toContain('slate');
    expect(described.types.slate.fields.value).toMatchObject({ widget: 'slate', markdown: true });

    // A container's region, with the editor's limit.
    expect(described.types.columns.regions).toEqual([{ field: 'columns', allowed: ['column'], maxLength: 4 }]);
    // A list whose items have no types of their own holds the item type the admin registers.
    expect(described.types.accordion.regions).toEqual([{ field: 'panels', allowed: ['accordion:panels'], list: true }]);
    expect(Object.keys(described.types['accordion:panels'].fields)).toContain('title');
  });

  test('a dry run previewed as a visitor sees it, saving nothing', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await waitForAgent(page);
    const agent = agentOn(page);
    const read = await getPage(agent);
    const frontendUrl = await frontendUrlOf(page);
    expect(new URL(frontendUrl).searchParams.has('_edit')).toBe(false);

    const ops = [{ op: 'add', after: 'block-1-uuid', blocks: [{ '@type': 'slate', value: 'Previewed *draft* text' }] }];
    const dry = await editPage(agent, {
      ops, expectedVersion: read.version, dryRun: true, mintId,
      render: (draft) => previewDraft(page.context(), { frontendUrl, path: '/_test_data/test-page', draft }),
    });
    expect(dry.rendered.text).toContain('Previewed draft text');
    expect(Buffer.from(dry.rendered.image, 'base64').subarray(1, 4).toString()).toBe('PNG');

    // The view-mode frame is a visitor's: no editor, and the saved page is untouched.
    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')?.value;
    const stored = await (await fetch(`${URLS.mockApi}/_test_data/test-page`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    expect(stored.blocks_layout.items).toEqual(read.blocks.map((b) => b['@uid']));
  });

  test('a preview is only for a dry run', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await waitForAgent(page);
    const agent = agentOn(page);
    const read = await getPage(agent);
    await expect(editPage(agent, { ops: [], expectedVersion: read.version, mintId, render: async () => ({}) }))
      .rejects.toThrow(/for a dry run/);
  });

  test('search and list_children, through the admin\'s own @search', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}/contents`);
    await page.waitForFunction(() => !!(window as any).__inkaSite);
    const agent = siteOn(page);

    // By text: site-relative paths, with title and type.
    const found = await search(agent, { text: 'Accordion' });
    expect(found.total).toBeGreaterThan(0);
    expect(found.items).toContainEqual(expect.objectContaining({
      path: '/_test_data/accordion-test-page', title: 'Accordion Test Page', type: 'Document',
    }));

    // Narrowed by type: nothing of another type comes back.
    const events = await search(agent, { text: 'Test', types: ['Event'] });
    expect(events.items.length).toBeGreaterThan(0);
    expect(events.items.every((i) => i.type === 'Event')).toBe(true);

    // A section's children, one level down, paged.
    const children = await listChildren(agent, { path: '/_test_data', limit: 5 });
    expect(children.total).toBeGreaterThan(5);
    expect(children.items).toHaveLength(5);
    expect(children.items.every((i) => i.path.split('/').length === 3 && i.path.startsWith('/_test_data/'))).toBe(true);
    const next = await listChildren(agent, { path: '/_test_data', limit: 5, start: 5 });
    expect(next.items.map((i) => i.path)).not.toContain(children.items[0].path);

    await expect(search(agent, {})).rejects.toThrow(/needs "text" or "types"/);
  });

  test('create_page: through the add form, then its first blocks, saved', async ({ page }) => {
    test.setTimeout(90000);
    const helper = new AdminUIHelper(page);
    await helper.login();

    const path = await createPage(page, { adminUrl: helper.adminUrl, parent: '/_test_data', type: 'Document', title: 'Made by the MCP' });
    expect(path).toMatch(/^\/_test_data\/made-by-the-mcp/);

    const blocks = [{ '@uid': 'intro', '@type': 'slate', value: 'Written *by an agent*' }];
    const made = await fillNewPage(agentOn(page), { blocks, mintId });
    expect(made.path).toBe(path);

    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')?.value;
    const stored = await (await fetch(`${URLS.mockApi}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    expect(stored.title).toBe('Made by the MCP');
    // The page keeps the blocks it starts with (its title block), and ours follow.
    expect(stored.blocks[stored.blocks_layout.items[0]]['@type']).toBe('title');
    expect(stored.blocks_layout.items.at(-1)).toBe(made.ids.intro);
    expect(stored.blocks[made.ids.intro]['@type']).toBe('slate');
  });

  test('create_page: a form the admin refuses says why', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await expect(createPage(page, { adminUrl: helper.adminUrl, parent: '/_test_data', type: 'Document', title: '' }))
      .rejects.toThrow(/add form refused it/);
  });

  test('move_page, rename_page and delete_page, version-checked', async ({ page }) => {
    test.setTimeout(90000);
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}/contents`);
    await page.waitForFunction(() => !!(window as any).__inkaSite);
    const site = siteOn(page);
    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')?.value;
    const status = async (path: string) => (await fetch(`${URLS.mockApi}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).status;
    const versionOf = (path: string) => site.version(path);

    // Move another-page into the accordion test page's section.
    const from = '/_test_data/another-page';
    const moved = await movePage(site, { path: from, target: '/_test_data/accordion-test-page', expectedVersion: await versionOf(from) });
    expect(moved.path).toBe('/_test_data/accordion-test-page/another-page');
    expect(await status(from)).toBe(404);
    expect(await status(moved.path)).toBe(200);

    // Rename it: a new short name and title.
    const renamed = await renamePage(site, { path: moved.path, id: 'moved-page', title: 'Moved page', expectedVersion: await versionOf(moved.path) });
    expect(renamed.path).toBe('/_test_data/accordion-test-page/moved-page');
    const stored = await (await fetch(`${URLS.mockApi}${renamed.path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    expect(stored.title).toBe('Moved page');

    // A version the page has moved past is refused, and nothing is deleted.
    await expect(deletePage(site, { path: renamed.path, expectedVersion: 'an-old-version' })).rejects.toThrow(/changed since it was read/);
    expect(await status(renamed.path)).toBe(200);

    // Delete it.
    await deletePage(site, { path: renamed.path, expectedVersion: await versionOf(renamed.path) });
    expect(await status(renamed.path)).toBe(404);
  });

  test('describe_block: the type in full, with a real example from the site', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await waitForAgent(page);
    const [agent, site] = [agentOn(page), siteOn(page)];

    const teaser = await describeBlock(agent, site, { type: 'teaser' });
    expect(teaser.fields.href).toMatchObject({ widget: 'object_browser', required: true });
    expect(teaser.allowedIn).toContain("the page's blocks");
    // The example is a real teaser from a page on the site: the link's shape is there to copy.
    expect(teaser.example.block['@type']).toBe('teaser');
    expect(teaser.example.from).toMatch(/^\//);
    expect(teaser.example.block.href[0]['@id']).toBeTruthy();

    // A block's display variants, as its variation field offers them.
    const callout = await describeBlock(agent, site, { type: 'callout' });
    expect(callout.variations).toContainEqual({ id: 'note', title: 'Note', isDefault: true });
    expect(callout.variations.map((v) => v.id)).toEqual(['note', 'tip', 'warning', 'important']);
  });
});
