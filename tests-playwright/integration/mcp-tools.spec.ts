/**
 * The MCP tools against a real (headless-style) admin: get_page reads the page
 * in the agent format; edit_blocks applies operations through the agent API,
 * as a dry run (nothing saved) or for real (saved against the version read).
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';
import { agentOn, waitForAgent, discardEdits } from '../../packages/inka-mcp/adminDriver.mjs';
import { getPage, editPage, listBlockTypes, search, listChildren } from '../../packages/inka-mcp/tools.mjs';
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
    await helper.navigateToEdit('/test-page');
    await waitForAgent(page);
    const agent = agentOn(page);

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
});
