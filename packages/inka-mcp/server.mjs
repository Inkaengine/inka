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
 *   INKA_FRONTEND_URL  optional: the front end the editor (and so a preview)
 *                      uses; without it, the admin's own default
 * The agent can do what that CMS user can do, nothing more.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openForEdit, createPage, agentOn, openSite, siteOn } from './adminDriver.mjs';
import { frontendUrlOf, previewDraft } from './preview.mjs';
import {
  getPage, editPage, listBlockTypes, describeBlock, search, listChildren, fillNewPage, movePage, renamePage, deletePage,
} from './tools.mjs';

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
export function headlessAdmin({ adminUrl, token, frontendUrl }) {
  let context;
  const ready = async () => {
    if (context) return context;
    const browser = await chromium.launch();
    context = await browser.newContext();
    await context.addCookies([
      { name: 'auth_token', value: token, url: adminUrl, sameSite: 'Lax' },
      // The admin's front-end choice, as its switcher stores it: a cookie
      // named for the admin's port (utils/cookieNames.js).
      ...(frontendUrl ? [{
        name: `iframe_url_${new URL(adminUrl).port || '80'}`, value: frontendUrl, url: adminUrl, sameSite: 'Lax',
      }] : []),
    ]);
    return context;
  };
  return {
    async withEditor(path, work) {
      const page = await (await ready()).newPage();
      try {
        await openForEdit(page, { adminUrl, path });
        return await work(agentOn(page), {
          // The site-wide API is on every admin page, the editor's included.
          site: siteOn(page),
          // Render a draft of this page as a visitor sees it, in its own page.
          render: async (draft, viewport) => {
            const renderedOn = await frontendUrlOf(page);
            const rendered = await previewDraft(page.context(), { frontendUrl: renderedOn, path, draft, viewport });
            return { ...rendered, renderedOn: new URL(renderedOn).origin };
          },
        });
      } finally {
        await page.close();
      }
    },
    /** Work site-wide, from an admin page that holds no editor (and so no lock). */
    async withSite(work) {
      const page = await (await ready()).newPage();
      try {
        await openSite(page, { adminUrl });
        return await work(siteOn(page));
      } finally {
        await page.close();
      }
    },
    /** Add a page through the admin's add form, then work in its editor. */
    async withNewPage({ parent, type, title }, work) {
      const page = await (await ready()).newPage();
      try {
        await createPage(page, { adminUrl, parent, type, title });
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

  const paging = {
    limit: z.number().int().positive().max(100).optional().describe('At most this many (default 25)'),
    start: z.number().int().nonnegative().optional().describe('Skip this many, to page through'),
  };

  server.registerTool('search', {
    title: 'Search the site',
    description: 'Find pages by their text, narrowed by content type and to a section. Returns the total and a page of results: path, title, type, description and workflow state. Use a result\'s path with get_page.',
    inputSchema: {
      text: z.string().optional().describe('Words to find (each word matches as a prefix)'),
      types: z.array(z.string()).optional().describe('Content types, e.g. ["Document"]'),
      path: z.string().optional().describe('Only inside this section, e.g. /news'),
      ...paging,
    },
  }, async (args) => asResult(await admin.withSite((site) => search(site, args))));

  server.registerTool('list_children', {
    title: 'List a section',
    description: 'The pages directly inside a section, in their order: path, title, type, description and workflow state. "/" lists the top of the site.',
    inputSchema: { path: z.string().describe('The section, e.g. / or /docs'), ...paging },
  }, async (args) => asResult(await admin.withSite((site) => listChildren(site, args))));

  const version = z.string().describe('The version get_page returned; refused if the page has changed since');

  server.registerTool('move_page', {
    title: 'Move a page',
    description: 'Move a page (and everything inside it) into another section. Returns its new path.',
    inputSchema: {
      path: z.string().describe('The page to move, e.g. /news/old-item'),
      target: z.string().describe('The section to move it into, e.g. /archive'),
      expectedVersion: version,
    },
  }, async (args) => asResult(await admin.withSite((site) => movePage(site, args))));

  server.registerTool('rename_page', {
    title: 'Rename a page',
    description: 'Change a page\'s short name (the last part of its path, so its URL) and/or its title. Returns its path.',
    inputSchema: {
      path: z.string().describe('The page, e.g. /about/team'),
      id: z.string().optional().describe('The new short name, e.g. people'),
      title: z.string().optional().describe('The new title'),
      expectedVersion: version,
    },
  }, async (args) => asResult(await admin.withSite((site) => renamePage(site, args))));

  server.registerTool('delete_page', {
    title: 'Delete a page',
    description: 'Delete a page and everything inside it. This cannot be undone here.',
    inputSchema: { path: z.string().describe('The page to delete'), expectedVersion: version },
  }, async (args) => asResult(await admin.withSite((site) => deletePage(site, args))));

  server.registerTool('list_block_types', {
    title: 'List block types',
    description: 'The block types a page can hold: each type\'s fields (required ones marked; "markdown" fields take {"md": "..."}) and its regions — the lists of child blocks, named as in get_page, with the types each allows. "page" lists what the page itself takes. Read this before adding a block type you have not seen on the page.',
    inputSchema: { path: z.string().describe('The page path, e.g. /about') },
  }, async ({ path }) => asResult(await admin.withEditor(path, listBlockTypes)));

  server.registerTool('describe_block', {
    title: 'Describe a block type',
    description: 'One block type in full, as the page at "path" can use it: what it is, its variations, every field (required ones marked; "markdown" fields take {"md": "..."}), its regions, where on the page it can go, and a real example of it from a page on the site, showing the exact value each field takes (links, images, choices). Use it before adding a type you have not used, or to see how to fill a field.',
    inputSchema: {
      path: z.string().describe('The page you will add it to, e.g. /about'),
      type: z.string().describe('The block type, as list_block_types names it, e.g. teaser'),
    },
  }, async ({ path, type }) => asResult(await admin.withEditor(path, (agent, { site }) => describeBlock(agent, site, { type }))));

  server.registerTool('create_page', {
    title: 'Create a page',
    description: 'Add a page inside a section, as an editor does through the admin\'s add form, and save it. Optional "blocks" (in the get_page format, each with your own "@uid" if you will refer to it) are added after the blocks the page starts with. Returns the new page\'s path, its version for edit_blocks, and the ids of your blocks.',
    inputSchema: {
      parent: z.string().describe('The section to add it to, e.g. /docs'),
      title: z.string().describe('The page title'),
      type: z.string().optional().describe('The content type (default "Document")'),
      blocks: z.array(z.object({ '@type': z.string() }).passthrough()).optional().describe('Blocks to start with'),
    },
  }, async ({ parent, title, type = 'Document', blocks }) => asResult(
    await admin.withNewPage({ parent, type, title }, (agent) => fillNewPage(agent, { blocks, mintId: randomUUID })),
  ));

  server.registerTool('edit_blocks', {
    title: 'Edit a page',
    description: `Change a page's blocks. With dryRun the changes are applied but not saved, and the resulting page is returned; resubmit without dryRun to save. With dryRun, "preview" also renders the result as a visitor would see it — a screenshot and the page's text. A save is refused if the page has changed since expectedVersion — read it again and reapply.\n\n${OPS_HELP}`,
    inputSchema: {
      path: z.string().describe('The page path, e.g. /about'),
      expectedVersion: z.string().describe('The version get_page returned'),
      ops: z.array(z.object({ op: z.enum(['update', 'add', 'move', 'delete']) }).passthrough()),
      dryRun: z.boolean().optional().describe('Show the result without saving'),
      preview: z.enum(['desktop', 'mobile']).optional().describe('With dryRun: render the result at this width'),
    },
  }, async ({ path, expectedVersion, ops, dryRun, preview }) => {
    const result = await admin.withEditor(path, (agent, { render }) => editPage(agent, {
      ops, expectedVersion, dryRun, mintId: randomUUID,
      render: preview && ((draft) => render(draft, preview)),
    }));
    if (!result.rendered) return asResult(result);
    const { rendered: { image, text, renderedOn }, ...rest } = result;
    return {
      content: [
        { type: 'text', text: JSON.stringify({ ...rest, renderedOn, renderedText: text }, null, 2) },
        { type: 'image', data: image, mimeType: 'image/png' },
      ],
    };
  });

  return server;
}

async function main(env) {
  const admin = headlessAdmin({
    adminUrl: required(env, 'INKA_ADMIN_URL').replace(/\/$/, ''),
    token: await authToken(env),
    frontendUrl: env.INKA_FRONTEND_URL,
  });
  const server = createServer(admin);
  server.server.onclose = () => admin.close();
  await server.connect(new StdioServerTransport());
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await main(process.env);
}
