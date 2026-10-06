/**
 * The MCP server end to end: an MCP client starts it over stdio, as an agent's
 * host would, and it drives its own headless admin against the mock API.
 */
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { test, expect } from '../fixtures';
import { TEST_AUTH_TOKEN } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

const SERVER = new URL('../../packages/inka-mcp/server.mjs', import.meta.url).pathname;
const PAGE = '/_test_data/test-page';

test.describe('MCP server', () => {
  let client: Client;
  // The mock keys its state by token, so this test has the page to itself.
  const token = `${TEST_AUTH_TOKEN}-${randomUUID()}`;

  test.beforeEach(async () => {
    client = new Client({ name: 'mcp-server-spec', version: '0.0.1' });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      env: { ...process.env, INKA_ADMIN_URL: URLS.voltoSsr, INKA_TOKEN: token } as Record<string, string>,
    }));
  });

  test.afterEach(async () => {
    await client.close();
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { text: string }[])[0].text;
    return { isError: !!result.isError, text, json: () => {
      if (result.isError) throw new Error(`${name} failed: ${text}`);
      return JSON.parse(text);
    } };
  };

  test('lists get_page and edit_blocks', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['edit_blocks', 'get_page']);
  });

  test('reads, dry-runs, saves, and refuses a stale version', async ({ request }) => {
    // Every call opens the editor afresh — that is what keeps the server stateless.
    test.setTimeout(180000);
    const read = (await call('get_page', { path: PAGE })).json();
    expect(read.blocks.find((b: any) => b['@uid'] === 'block-1-uuid')['@type']).toBe('slate');

    const ops = [{ op: 'add', after: 'block-1-uuid', blocks: [{ '@uid': 'new', '@type': 'slate', value: 'From the *MCP server*' }] }];

    // A dry run returns the page as it would be, and saves nothing.
    const dry = (await call('edit_blocks', { path: PAGE, expectedVersion: read.version, ops, dryRun: true })).json();
    expect(dry.page.blocks.find((b: any) => b['@uid'] === dry.ids.new).value.md).toBe('From the *MCP server*');
    const after = (await call('get_page', { path: PAGE })).json();
    expect(after.blocks.map((b: any) => b['@uid'])).toEqual(read.blocks.map((b: any) => b['@uid']));
    expect(after.version).toBe(read.version);

    // Saved for real.
    const saved = (await call('edit_blocks', { path: PAGE, expectedVersion: read.version, ops })).json();
    const stored = await (await request.get(`${URLS.mockApi}${PAGE}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    expect(stored.blocks_layout.items[1]).toBe(saved.ids.new);

    // The version read before the save is now stale.
    const stale = await call('edit_blocks', { path: PAGE, expectedVersion: read.version, ops });
    expect(stale.isError).toBe(true);
    expect(stale.text).toMatch(/changed since it was read/);
  });
});
