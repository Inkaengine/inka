/**
 * The MCP tools against a real (headless-style) admin: get_page reads the page
 * in the agent format; edit_blocks applies operations through the agent API,
 * as a dry run (nothing saved) or for real (saved against the version read).
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';
import { agentOn, waitForAgent, discardEdits } from '../../packages/inka-mcp/adminDriver.mjs';
import { getPage, editPage } from '../../packages/inka-mcp/tools.mjs';

const mintId = () => crypto.randomUUID();

test.describe('MCP tools', () => {
  test('get_page, a dry run, then a real edit', async ({ page }) => {
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
});
