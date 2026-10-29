#!/usr/bin/env node
/**
 * The Inka MCP server (stdio). Agents read and edit pages through a headless
 * Inka admin, loaded once: each tool call moves it to the page's editor, works
 * through the admin's agent API, and leaves the editor. Nothing is held
 * between calls — a dry run is dropped and the page's lock let go when the
 * editor is left.
 *
 * Configuration (environment):
 *   INKA_ADMIN_URL  the admin, e.g. https://admin.example.org
 *   INKA_FRONTEND_URL  optional: the front end the editor (and so a preview)
 *                      uses; without it, the admin's own default
 * Signing in (signIn.mjs): with neither of the below, the first call opens
 * the person's browser at the admin, they sign in as they always do and
 * allow the agent, and the token is kept (INKA_TOKEN_STORE, by default
 * ~/.config/inka-mcp/tokens.json) and renewed from then on.
 *   INKA_TOKEN      a token to use instead, or
 *   INKA_USER + INKA_PASSWORD + INKA_API_URL  to log in to a plain account
 * The agent can do what that CMS user can do, nothing more.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { adminPool } from './adminPool.mjs';
import { subjectOf } from './tokenStore.mjs';
import { signIn, renewDelay } from './signIn.mjs';
import {
  previewLayout, getPage, editPage, listBlockTypes, describeBlock, search, listChildren, fillNewPage, movePage, renamePage, deletePage,
} from './tools.mjs';

const OPS_HELP = `Operations, applied in order:
- {"op":"update","id":"<uid>","set":{field: value}} — change fields of a block.
- {"op":"add","after"|"before":"<uid>","blocks":[...]} — add blocks next to a block, in the order given.
- {"op":"add","into":{"id":"<uid>","field":"<region>"},"blocks":[...]} — add blocks at the end of a container's region.
- {"op":"move","id":"<uid>","after"|"before":"<uid>"} — move a block.
- {"op":"delete","id":"<uid>"} — remove a block.
New blocks are in the get_page format; give each a "@uid" of your own to refer to it in later operations — the result maps it to the real id. Rich text fields take markdown: {"md": "..."} or a plain string.`;

/**
 * The admin for one user, as the local (stdio) server has it: a pool of one
 * page (adminPool.mjs), signed in through `auth` and kept signed in. The page
 * is loaded once and kept: each call moves it to the page the call needs and
 * leaves it parked with no editor, so a call holds nothing afterwards (a dry
 * run's changes dropped, the editor's lock let go). Calls take turns on it.
 */
export function headlessAdmin({ adminUrl, auth, frontendUrl }) {
  const pool = adminPool({ adminUrl, frontendUrl, size: 1 });
  let token;
  let renewal;
  /** Use `next`, and renew it halfway through its life (if `auth` renews). */
  const keep = (next) => {
    token = next;
    if (!auth.renew) return;
    clearTimeout(renewal);
    renewal = setTimeout(() => {
      auth.renew(token).then(keep, (error) => {
        // Signed out: the next call signs in again.
        process.stderr.write(`inka-mcp: renewing the sign-in failed, the next call signs in again: ${error.message}\n`);
        token = null;
      });
    }, renewDelay(token));
    renewal.unref();
  };
  const currentUser = async () => {
    if (!token) keep(await auth.token());
    return { id: subjectOf(token), token };
  };
  return {
    ...pool.forUser(currentUser),
    /** How many times the admin was loaded in full (once, unless it was lost). */
    get adminLoads() {
      return pool.stats.adminLoads;
    },
    async close() {
      clearTimeout(renewal);
      await pool.close();
    },
  };
}

/**
 * Sent to a client when it connects (clients like Claude give it to the model):
 * how to work with an Inka site. Without it an agent asked what a page looks
 * like, or for other ways to lay it out, answered from the block data with
 * guessed wireframes, not knowing it could render pages and tries.
 */
const INSTRUCTIONS = `This server edits a website built with Inka: pages made of blocks, rendered by the site's own front end.

The person you are helping edits the site; they think in pages as visitors see them, not in data. Talk about what a page shows and how it reads: headings, sections, images, buttons. Do not mention blocks, JSON, ids, fields, schemas or code unless they ask, or a change cannot be explained without it. When they ask what something looks like, or for options, render it (view_page, preview_layout) and describe what the renders show; do not describe data structures or draw wireframes from them.

- Read a page's blocks with get_page; see it as visitors do with view_page (a screenshot and its text). Look before you describe or judge how a page looks.
- Explore what you can use: list_block_types for the blocks a page can hold, describe_block (with "preview") for one type in full, with examples rendered.
- To suggest changes or alternative layouts, try them first: preview_layout renders a whole proposed list of blocks for the page, and edit_blocks with dryRun and preview renders a change to the current page. Both save nothing. Render each alternative and compare them before recommending one; describe what each render shows.
- Save (edit_blocks without dryRun, create_page, move_page, rename_page, delete_page) only when asked to change the site.`;

const asResult = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

/**
 * The MCP server's tools. `adminFor(extra)` is the admin to work in for a
 * request: the one signed-in user's (stdio), or the requesting user's, from
 * their access token (http.mjs).
 */
export function createServer(adminFor) {
  const server = new McpServer({ name: 'inka', version: '0.0.1' }, { instructions: INSTRUCTIONS });

  server.registerTool('get_page', {
    title: 'Read a page',
    description: 'Read a page as an ordered list of blocks. Each block has "@uid" and "@type"; containers hold their child blocks in lists named for the region; rich text is {"md": "..."}. Keep "version" — edit_blocks needs it.',
    inputSchema: { path: z.string().describe('The page path, e.g. /about') },
  }, async ({ path }, extra) => asResult(await adminFor(extra).withEditor(path, getPage)));

  server.registerTool('preview_layout', {
    title: 'Try a layout',
    description: 'Render a whole proposed layout for a page as a visitor would see it, without saving anything: the page with "blocks" (in the get_page format; containers hold their child blocks in lists) in place of its own. Use it to try alternative layouts or designs before suggesting them: render each one and compare. Returns a screenshot and the rendered text. To change part of the current page, use edit_blocks with dryRun and preview instead.',
    inputSchema: {
      path: z.string().describe('The page path, e.g. /about'),
      blocks: z.array(z.object({ '@type': z.string() }).passthrough()).describe('The proposed blocks, in order'),
      viewport: z.enum(['desktop', 'mobile']).optional().describe('The screen width to render at (default desktop)'),
    },
  }, async ({ path, blocks, viewport = 'desktop' }, extra) => {
    const { image, text, renderedOn } = await adminFor(extra).withEditor(path, (agent, { render }) => previewLayout(agent, {
      blocks, mintId: randomUUID, render: (draft) => render(draft, viewport),
    }));
    return {
      content: [
        { type: 'text', text: JSON.stringify({ path, viewport, renderedOn, renderedText: text, saved: false }, null, 2) },
        { type: 'image', data: image, mimeType: 'image/png' },
      ],
    };
  });

  server.registerTool('view_page', {
    title: 'See a page',
    description: 'See a page as a visitor sees it: a screenshot rendered by the site\'s own front end, and the page\'s visible text. Use it whenever asked what a page looks like, to check a layout, or before suggesting design or layout changes: get_page gives the blocks, not how they render. To see a change before saving it, use edit_blocks with dryRun and preview.',
    inputSchema: {
      path: z.string().describe('The page path, e.g. /about'),
      viewport: z.enum(['desktop', 'mobile']).optional().describe('The screen width to render at (default desktop)'),
    },
  }, async ({ path, viewport = 'desktop' }, extra) => {
    const { image, text, renderedOn } = await adminFor(extra).withEditor(
      path, async (agent, { render }) => render(await agent.getDraft(), viewport),
    );
    return {
      content: [
        { type: 'text', text: JSON.stringify({ path, viewport, renderedOn, renderedText: text }, null, 2) },
        { type: 'image', data: image, mimeType: 'image/png' },
      ],
    };
  });

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
  }, async (args, extra) => asResult(await adminFor(extra).withSite((site) => search(site, args))));

  server.registerTool('list_children', {
    title: 'List a section',
    description: 'The pages directly inside a section, in their order: path, title, type, description and workflow state. "/" lists the top of the site.',
    inputSchema: { path: z.string().describe('The section, e.g. / or /docs'), ...paging },
  }, async (args, extra) => asResult(await adminFor(extra).withSite((site) => listChildren(site, args))));

  const version = z.string().describe('The version get_page returned; refused if the page has changed since');

  server.registerTool('move_page', {
    title: 'Move a page',
    description: 'Move a page (and everything inside it) into another section. Returns its new path.',
    inputSchema: {
      path: z.string().describe('The page to move, e.g. /news/old-item'),
      target: z.string().describe('The section to move it into, e.g. /archive'),
      expectedVersion: version,
    },
  }, async (args, extra) => asResult(await adminFor(extra).withSite((site) => movePage(site, args))));

  server.registerTool('rename_page', {
    title: 'Rename a page',
    description: 'Change a page\'s short name (the last part of its path, so its URL) and/or its title. Returns its path.',
    inputSchema: {
      path: z.string().describe('The page, e.g. /about/team'),
      id: z.string().optional().describe('The new short name, e.g. people'),
      title: z.string().optional().describe('The new title'),
      expectedVersion: version,
    },
  }, async (args, extra) => asResult(await adminFor(extra).withSite((site) => renamePage(site, args))));

  server.registerTool('delete_page', {
    title: 'Delete a page',
    description: 'Delete a page and everything inside it. This cannot be undone here.',
    inputSchema: { path: z.string().describe('The page to delete'), expectedVersion: version },
  }, async (args, extra) => asResult(await adminFor(extra).withSite((site) => deletePage(site, args))));

  server.registerTool('list_block_types', {
    title: 'List block types',
    description: 'The block types a page can hold: each type\'s fields (required ones marked; "markdown" fields take {"md": "..."}) and its regions — the lists of child blocks, named as in get_page, with the types each allows. "page" lists what the page itself takes. Read this before adding a block type you have not seen on the page.',
    inputSchema: { path: z.string().describe('The page path, e.g. /about') },
  }, async ({ path }, extra) => asResult(await adminFor(extra).withEditor(path, listBlockTypes)));

  server.registerTool('describe_block', {
    title: 'Describe a block type',
    description: 'One block type in full, as the page at "path" can use it: what it is, its front end\'s guidance on using it, its variations, every field (required ones marked; "markdown" fields take {"md": "..."}), its regions, where on the page it can go, examples of it filled in from its front end, and a real one from a page on the site, showing the exact value each field takes (links, images, choices). With "preview", each front-end example is also rendered as a visitor sees it: use that to see what a block type looks like before proposing it. Use it before adding a type you have not used, or to see how to fill a field.',
    inputSchema: {
      path: z.string().describe('The page you will add it to, e.g. /about'),
      type: z.string().describe('The block type, as list_block_types names it, e.g. teaser'),
      preview: z.enum(['desktop', 'mobile']).optional().describe('Render each example at this width'),
    },
  }, async ({ path, type, preview }, extra) => {
    const described = await adminFor(extra).withEditor(path, (agent, { site, render }) => describeBlock(agent, site, {
      type, render: preview && ((draft, uid) => render(draft, preview, uid)),
    }));
    if (!preview) return asResult(described);
    // Each example's picture follows the text, in the examples' order.
    const images = described.examples.map(({ rendered }) => rendered.image);
    for (const example of described.examples) {
      const { image: _image, text, renderedOn } = example.rendered;
      example.rendered = { renderedOn, text };
    }
    return {
      content: [
        { type: 'text', text: JSON.stringify(described, null, 2) },
        ...images.map((data) => ({ type: 'image', data, mimeType: 'image/png' })),
      ],
    };
  });

  server.registerTool('create_page', {
    title: 'Create a page',
    description: 'Add a page inside a section, as an editor does through the admin\'s add form, and save it. Optional "blocks" (in the get_page format, each with your own "@uid" if you will refer to it) are added after the blocks the page starts with. Returns the new page\'s path, its version for edit_blocks, and the ids of your blocks.',
    inputSchema: {
      parent: z.string().describe('The section to add it to, e.g. /docs'),
      title: z.string().describe('The page title'),
      type: z.string().optional().describe('The content type (default "Document")'),
      blocks: z.array(z.object({ '@type': z.string() }).passthrough()).optional().describe('Blocks to start with'),
    },
  }, async ({ parent, title, type = 'Document', blocks }, extra) => asResult(
    await adminFor(extra).withNewPage({ parent, type, title }, (agent) => fillNewPage(agent, { blocks, mintId: randomUUID })),
  ));

  server.registerTool('edit_blocks', {
    title: 'Edit a page',
    description: `Change a page's blocks. With dryRun the changes are applied but not saved, and the resulting page is returned; resubmit without dryRun to save. With dryRun, "preview" also renders the result as a visitor would see it — a screenshot and the page's text: the way to try a change and see it before suggesting or saving it. A save is refused if the page has changed since expectedVersion — read it again and reapply.\n\n${OPS_HELP}`,
    inputSchema: {
      path: z.string().describe('The page path, e.g. /about'),
      expectedVersion: z.string().describe('The version get_page returned'),
      ops: z.array(z.object({ op: z.enum(['update', 'add', 'move', 'delete']) }).passthrough()),
      dryRun: z.boolean().optional().describe('Show the result without saving'),
      preview: z.enum(['desktop', 'mobile']).optional().describe('With dryRun: render the result at this width'),
    },
  }, async ({ path, expectedVersion, ops, dryRun, preview }, extra) => {
    const result = await adminFor(extra).withEditor(path, (agent, { render }) => editPage(agent, {
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
  if (!env.INKA_ADMIN_URL) throw new Error('inka-mcp: INKA_ADMIN_URL is not set');
  const adminUrl = env.INKA_ADMIN_URL.replace(/\/$/, '');
  // Signing in waits for the first call, so the agent's host isn't kept
  // waiting at startup while a person signs in.
  const admin = headlessAdmin({ adminUrl, auth: signIn(env, { adminUrl }), frontendUrl: env.INKA_FRONTEND_URL });
  const server = createServer(() => admin);
  server.server.onclose = () => admin.close();
  await server.connect(new StdioServerTransport());
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await main(process.env);
}
