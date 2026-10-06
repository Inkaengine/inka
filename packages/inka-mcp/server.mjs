#!/usr/bin/env node
/**
 * The Inka MCP server (stdio). Agents read and edit pages through a headless
 * Inka admin: each tool call opens the page's editor, works through the
 * admin's agent API, and closes it. Nothing is held between calls — a dry run
 * is thrown away when its page closes.
 *
 * Configuration (environment):
 *   INKA_ADMIN_URL  the admin, e.g. https://admin.example.org
 *   INKA_API_URL    the CMS API the admin talks to (for logging in)
 *   INKA_TOKEN      an auth token for the CMS, or
 *   INKA_USER + INKA_PASSWORD  to log in for one
 * The agent can do what that CMS user can do, nothing more.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openForEdit, agentOn } from './adminDriver.mjs';
import { getPage, editPage } from './tools.mjs';

const OPS_HELP = `Operations, applied in order:
- {"op":"update","id":"<uid>","set":{field: value}} — change fields of a block.
- {"op":"add","after"|"before":"<uid>","blocks":[...]} — add blocks next to a block, in the order given.
- {"op":"add","into":{"id":"<uid>","field":"<region>"},"blocks":[...]} — add blocks at the end of a container's region.
- {"op":"move","id":"<uid>","after"|"before":"<uid>"} — move a block.
- {"op":"delete","id":"<uid>"} — remove a block.
New blocks are in the get_page format; give each a "@uid" of your own to refer to it in later operations — the result maps it to the real id. Rich text fields take markdown: {"md": "..."} or a plain string.`;

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`inka-mcp: ${name} is not set`);
  return value;
}

/** The CMS token: given, or got by logging in. */
export async function authToken(env) {
  if (env.INKA_TOKEN) return env.INKA_TOKEN;
  const apiUrl = required(env, 'INKA_API_URL');
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}/@login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: required(env, 'INKA_USER'), password: required(env, 'INKA_PASSWORD') }),
  });
  if (!response.ok) throw new Error(`inka-mcp: login failed (${response.status})`);
  return (await response.json()).token;
}

/** A headless admin, logged in; `withEditor` opens a page's editor for one call. */
export function headlessAdmin({ adminUrl, token }) {
  let context;
  const ready = async () => {
    if (context) return context;
    const browser = await chromium.launch();
    context = await browser.newContext();
    await context.addCookies([{
      name: 'auth_token', value: token, url: adminUrl, sameSite: 'Lax',
    }]);
    return context;
  };
  return {
    async withEditor(path, work) {
      const page = await (await ready()).newPage();
      try {
        await openForEdit(page, { adminUrl, path });
        return await work(agentOn(page));
      } finally {
        await page.close();
      }
    },
    async close() {
      if (context) await context.browser().close();
    },
  };
}

const asResult = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

export function createServer(admin) {
  const server = new McpServer({ name: 'inka', version: '0.0.1' });

  server.registerTool('get_page', {
    title: 'Read a page',
    description: 'Read a page as an ordered list of blocks. Each block has "@uid" and "@type"; containers hold their child blocks in lists named for the region; rich text is {"md": "..."}. Keep "version" — edit_blocks needs it.',
    inputSchema: { path: z.string().describe('The page path, e.g. /about') },
  }, async ({ path }) => asResult(await admin.withEditor(path, getPage)));

  server.registerTool('edit_blocks', {
    title: 'Edit a page',
    description: `Change a page's blocks. With dryRun the changes are applied but not saved, and the resulting page is returned; resubmit without dryRun to save. A save is refused if the page has changed since expectedVersion — read it again and reapply.\n\n${OPS_HELP}`,
    inputSchema: {
      path: z.string().describe('The page path, e.g. /about'),
      expectedVersion: z.string().describe('The version get_page returned'),
      ops: z.array(z.object({ op: z.enum(['update', 'add', 'move', 'delete']) }).passthrough()),
      dryRun: z.boolean().optional().describe('Show the result without saving'),
    },
  }, async ({ path, expectedVersion, ops, dryRun }) => asResult(
    await admin.withEditor(path, (agent) => editPage(agent, { ops, expectedVersion, dryRun, mintId: randomUUID })),
  ));

  return server;
}

async function main(env) {
  const admin = headlessAdmin({ adminUrl: required(env, 'INKA_ADMIN_URL').replace(/\/$/, ''), token: await authToken(env) });
  const server = createServer(admin);
  server.server.onclose = () => admin.close();
  await server.connect(new StdioServerTransport());
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await main(process.env);
}
