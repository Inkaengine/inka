/**
 * The MCP server end to end: an MCP client starts it over stdio, as an agent's
 * host would, and it drives its own headless admin against the mock API.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { test, expect } from '../fixtures';
import { TEST_AUTH_TOKEN } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

const SERVER = new URL('../../packages/inka-mcp/server.mjs', import.meta.url).pathname;
const PAGE = '/_test_data/test-page';

// A call loads an editor (and a preview loads the front end too); the SDK's
// default 60s per request is less than that under a loaded test machine.
const CALL = { timeout: 170000 };

/** An MCP client on a fresh server, started over stdio as an agent's host does. */
async function connect(env: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'mcp-server-spec', version: '0.0.1' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env, INKA_ADMIN_URL: URLS.voltoSsr, ...env } as Record<string, string>,
  }));
  return client;
}

test.describe('MCP server', () => {
  let client: Client;
  // The mock keys its state by token, so this test has the page to itself.
  const token = `${TEST_AUTH_TOKEN}-${randomUUID()}`;

  test.beforeEach(async () => {
    client = await connect({ INKA_TOKEN: token });
  });

  test.afterEach(async () => {
    await client.close();
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }, undefined, CALL);
    const text = (result.content as { text: string }[])[0].text;
    return { isError: !!result.isError, text, json: () => {
      if (result.isError) throw new Error(`${name} failed: ${text}`);
      return JSON.parse(text);
    } };
  };

  test('lists its tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['create_page', 'delete_page', 'edit_blocks', 'get_page', 'list_block_types', 'list_children', 'move_page', 'rename_page', 'search']);
  });

  test('list_children runs without an editor', async () => {
    test.setTimeout(90000);
    const listed = (await call('list_children', { path: '/_test_data', limit: 3 })).json();
    expect(listed.items).toHaveLength(3);
    expect(listed.items[0].path).toMatch(/^\/_test_data\//);
  });

  test('reads, dry-runs, saves, and refuses a stale version', async () => {
    // Every call opens the editor afresh — that is what keeps the server stateless.
    test.setTimeout(180000);
    const read = (await call('get_page', { path: PAGE })).json();
    expect(read.blocks.find((b: any) => b['@uid'] === 'block-1-uuid')['@type']).toBe('slate');

    const ops = [{ op: 'add', after: 'block-1-uuid', blocks: [{ '@uid': 'new', '@type': 'slate', value: 'From the *MCP server*' }] }];

    // A dry run returns the page as it would be, and saves nothing.
    const dryCall = await client.callTool({
      name: 'edit_blocks', arguments: { path: PAGE, expectedVersion: read.version, ops, dryRun: true, preview: 'desktop' },
    }, undefined, CALL);
    const [text, image] = dryCall.content as any[];
    const dry = JSON.parse(text.text);
    expect(dry.page.blocks.find((b: any) => b['@uid'] === dry.ids.new).value.md).toBe('From the *MCP server*');
    // The preview: the draft as a visitor sees it, as a screenshot and its text.
    expect(dry.renderedText).toContain('From the MCP server');
    // Without INKA_FRONTEND_URL, the admin's own default front end.
    expect(dry.renderedOn).not.toBe(URLS.nuxt);
    expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' });
    // MCP_PREVIEW_PNG=<file> keeps the screenshot to look at.
    if (process.env.MCP_PREVIEW_PNG) writeFileSync(process.env.MCP_PREVIEW_PNG, Buffer.from(image.data, 'base64'));
    const after = (await call('get_page', { path: PAGE })).json();
    expect(after.blocks.map((b: any) => b['@uid'])).toEqual(read.blocks.map((b: any) => b['@uid']));
    expect(after.version).toBe(read.version);

    // Saved for real.
    const saved = (await call('edit_blocks', { path: PAGE, expectedVersion: read.version, ops })).json();
    // Plain fetch: the `request` fixture would carry a frontend project's storageState.
    const stored = await (await fetch(`${URLS.mockApi}${PAGE}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    expect(stored.blocks_layout.items[1]).toBe(saved.ids.new);

    // The version read before the save is now stale.
    const stale = await call('edit_blocks', { path: PAGE, expectedVersion: read.version, ops });
    expect(stale.isError).toBe(true);
    expect(stale.text).toMatch(/changed since it was read/);
  });
});

test.describe('MCP server on a chosen front end', () => {
  test('INKA_FRONTEND_URL: the editor, and so the preview, use that front end', async () => {
    test.setTimeout(180000);
    const client = await connect({ INKA_TOKEN: `${TEST_AUTH_TOKEN}-${randomUUID()}`, INKA_FRONTEND_URL: URLS.nuxt });
    try {
      const read = JSON.parse((await client.callTool({ name: 'get_page', arguments: { path: PAGE } }, undefined, CALL)).content[0].text);
      const ops = [{ op: 'add', after: 'block-1-uuid', blocks: [{ '@type': 'slate', value: 'Previewed on *Nuxt*' }] }];
      const result = await client.callTool({
        name: 'edit_blocks', arguments: { path: PAGE, expectedVersion: read.version, ops, dryRun: true, preview: 'desktop' },
      }, undefined, CALL);
      expect(result.isError, (result.content as any[])[0].text).toBeFalsy();
      const dry = JSON.parse((result.content as any[])[0].text);
      expect(dry.renderedOn).toBe(URLS.nuxt);
      // The edit is in the page, then in the render.
      expect(JSON.stringify(dry.page)).toContain('Previewed on *Nuxt*');
      expect(dry.renderedText).toContain('Previewed on Nuxt');
    } finally {
      await client.close();
    }
  });
});
