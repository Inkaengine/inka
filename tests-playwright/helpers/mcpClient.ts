/**
 * An MCP client on a fresh Inka MCP server, started over stdio as an agent's
 * host does, driving its own headless admin against the mock API.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { URLS } from '../ports';

const SERVER = new URL('../../packages/inka-mcp/server.mjs', import.meta.url).pathname;

// A call loads an editor (and a preview loads the front end too); the SDK's
// default 60s per request is less than that under a loaded test machine.
export const CALL = { timeout: 170000 };

export async function connect(env: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'mcp-server-spec', version: '0.0.1' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env, INKA_ADMIN_URL: URLS.voltoSsr, ...env } as Record<string, string>,
  }));
  return client;
}
