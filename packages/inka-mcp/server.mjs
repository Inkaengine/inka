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
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { adminPool } from './adminPool.mjs';
import { subjectOf } from './tokenStore.mjs';
import { signIn, renewDelay, watchSignOut } from './signIn.mjs';
import { SCREENSHOT_VIEW, screenshotViewHtml } from './screenshotView.mjs';
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
    // Signed out (a tool found the site refusing the token): the next call signs in again.
    ...watchSignOut(pool.forUser(currentUser), () => { token = null; }),
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
/**
 * What the server tells a client about the site: facts an agent can't know
 * from the request alone, never how to behave. The person says what they want
 * changed, not how Inka works; this and the tools' own results fill in the rest.
 */
const INSTRUCTIONS = `This server edits a website built with Inka (a Plone-based CMS). The person you are working for edits the site in Inka's editor; they will say what they want changed, not how the site is built.

- A page is a block of its content type (a Page is "Document"): its own fields (title, summary and the rest of its content type's fields) and its regions, which hold its blocks. Blocks have types (Text, Image, Hero, …; list_block_types gives each type's title, fields and regions), and some hold blocks of their own. In the editor, blocks are known by those titles and fields by their labels; ids and JSON are never shown.
- The site's own front end draws every page. view_page shows a page as visitors see it; preview_layout (a whole proposed layout) and edit_blocks with dryRun and preview (a change to the page) show the result the same way. None of them saves anything. In clients that show them, the person sees these pictures too. A long page's picture may show only its top ("cropped" says how much); its text ("renderedText") is all there.
- Some blocks come from a template that many pages share (they carry "templateId"; "readOnly" ones are locked, as the editor shows them). A change to one is a change to the template, and so to every page that uses it: edit_blocks with changeTemplates. In the editor, unlocking a template warns of the same.
- Saving (edit_blocks without dryRun, create_page, move_page, rename_page, delete_page) changes the site itself: visitors of a published page see the change straight away; there is no separate publishing step.
- search finds pages by their title, their summary and the text of their Text blocks. Text in other blocks' fields (a hero's heading, a teaser's title) may not be searched.`;

/**
 * For a tool that changes nothing on the site: a client may then let the
 * person allow it once, for good, instead of on every call.
 */
const SAVES_NOTHING = { readOnlyHint: true };

const asResult = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

/**
 * The room a result's pictures take, in base64 characters. claude.ai keeps a
 * tool result of more than about 150,000 characters out of the conversation
 * (it writes it to a file), and then neither the model nor the person sees the
 * picture; this leaves the rest for the page's text. See fitImage.mjs.
 */
const IMAGE_CHARS = 100_000;

const asImage = ({ image, mimeType }) => ({ type: 'image', data: image, mimeType });

/** Shown to the person as well as the model, by a client that shows MCP Apps. */
const SHOWS_PICTURES = { ui: { resourceUri: SCREENSHOT_VIEW } };

const SCREENSHOT_VIEW_HTML = screenshotViewHtml();

/**
 * The MCP server's tools. `adminFor(extra)` is the admin to work in for a
 * request: the one signed-in user's (stdio), or the requesting user's, from
 * their access token (http.mjs).
 */
export function createServer(adminFor) {
  const server = new McpServer({ name: 'inka', version: '0.0.1' }, { instructions: INSTRUCTIONS });

  server.registerTool('get_page', {
    title: 'Read a page',
    annotations: SAVES_NOTHING,
    description: 'Read a page. The page is itself a block of its content type: "@uid" "_page", "@type" its content type (e.g. "Document"), its own fields (title, description — the summary — and the rest of its content type\'s fields), and its regions as lists of blocks ("blocks", and any others such as a footer). Each block has "@uid" and "@type"; containers hold their child blocks in lists named for the region; rich text is {"md": "..."}. Change the page\'s own fields with edit_blocks, an "update" on "_page". Keep "version" — edit_blocks needs it.',
    inputSchema: { path: z.string().describe('The page path, e.g. /about') },
  }, async ({ path }, extra) => asResult(await adminFor(extra).withEditor(path, getPage)));

  registerAppTool(server, 'preview_layout', {
    title: 'Try a layout',
    annotations: SAVES_NOTHING,
    _meta: SHOWS_PICTURES,
    description: 'Render a whole proposed layout for a page as a visitor would see it, without saving anything: the page with "blocks" (in the get_page format; containers hold their child blocks in lists) in place of its own. Returns a screenshot and the rendered text. To change part of the current page, use edit_blocks with dryRun and preview instead.',
    inputSchema: {
      path: z.string().describe('The page path, e.g. /about'),
      blocks: z.array(z.object({ '@type': z.string() }).passthrough()).describe('The proposed blocks, in order'),
      viewport: z.enum(['desktop', 'mobile']).optional().describe('The screen width to render at (default desktop)'),
    },
  }, async ({ path, blocks, viewport = 'desktop' }, extra) => {
    const rendered = await adminFor(extra).withEditor(path, (agent, { render }) => previewLayout(agent, {
      blocks, mintId: randomUUID, render: (draft) => render(draft, viewport, { maxChars: IMAGE_CHARS }),
    }));
    const { text, renderedOn, cropped } = rendered;
    return {
      content: [
        { type: 'text', text: JSON.stringify({ path, viewport, renderedOn, cropped, renderedText: text, saved: false }, null, 2) },
        asImage(rendered),
      ],
    };
  });

  registerAppTool(server, 'view_page', {
    title: 'See a page',
    annotations: SAVES_NOTHING,
    _meta: SHOWS_PICTURES,
    description: 'See a page as a visitor sees it: a screenshot rendered by the site\'s own front end, and the page\'s visible text. get_page gives the blocks, not how they render. To see a change before saving it, use edit_blocks with dryRun and preview.',
    inputSchema: {
      path: z.string().describe('The page path, e.g. /about'),
      viewport: z.enum(['desktop', 'mobile']).optional().describe('The screen width to render at (default desktop)'),
    },
  }, async ({ path, viewport = 'desktop' }, extra) => {
    const rendered = await adminFor(extra).withEditor(
      path, async (agent, { render }) => render(await agent.getDraft(), viewport, { maxChars: IMAGE_CHARS }),
    );
    const { text, renderedOn, cropped } = rendered;
    return {
      content: [
        { type: 'text', text: JSON.stringify({ path, viewport, renderedOn, cropped, renderedText: text }, null, 2) },
        asImage(rendered),
      ],
    };
  });

  const paging = {
    limit: z.number().int().positive().max(100).optional().describe('At most this many (default 25)'),
    start: z.number().int().nonnegative().optional().describe('Skip this many, to page through'),
  };

  server.registerTool('search', {
    title: 'Search the site',
    annotations: SAVES_NOTHING,
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
    annotations: SAVES_NOTHING,
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
    annotations: { destructiveHint: true },
    description: 'Delete a page and everything inside it. This cannot be undone here.',
    inputSchema: { path: z.string().describe('The page to delete'), expectedVersion: version },
  }, async (args, extra) => asResult(await adminFor(extra).withSite((site) => deletePage(site, args))));

  server.registerTool('list_block_types', {
    title: 'List block types',
    annotations: SAVES_NOTHING,
    description: 'The block types a page can hold: each type\'s fields (required ones marked; "markdown" fields take {"md": "..."}) and its regions — the lists of child blocks, named as in get_page, with the types each allows. "page" lists what the page itself takes; "contentType" names the page\'s own type, listed with the others — its fields are the page\'s own (title, summary, …).',
    inputSchema: { path: z.string().describe('The page path, e.g. /about') },
  }, async ({ path }, extra) => asResult(await adminFor(extra).withEditor(path, listBlockTypes)));

  registerAppTool(server, 'describe_block', {
    title: 'Describe a block type',
    annotations: SAVES_NOTHING,
    _meta: SHOWS_PICTURES,
    description: 'One block type in full, as the page at "path" can use it: what it is, its front end\'s guidance on using it, its variations, every field (required ones marked; "markdown" fields take {"md": "..."}), its regions, where on the page it can go, examples of it filled in from its front end, and a real one from a page on the site, showing the exact value each field takes (links, images, choices). With "preview", each front-end example is also rendered as a visitor sees it: use that to see what a block type looks like before proposing it.',
    inputSchema: {
      path: z.string().describe('The page you will add it to, e.g. /about'),
      type: z.string().describe('The block type, as list_block_types names it, e.g. teaser'),
      preview: z.enum(['desktop', 'mobile']).optional().describe('Render each example at this width'),
    },
  }, async ({ path, type, preview }, extra) => {
    const described = await adminFor(extra).withEditor(path, (agent, { site, render }) => describeBlock(agent, site, {
      // The examples share the room for pictures.
      type, render: preview && ((draft, uid, of) => render(draft, preview, { focus: uid, maxChars: Math.floor(IMAGE_CHARS / of) })),
    }));
    if (!preview) return asResult(described);
    // Each example's picture follows the text, in the examples' order.
    const images = described.examples.map(({ rendered }) => asImage(rendered));
    for (const example of described.examples) {
      const { text, renderedOn, cropped } = example.rendered;
      example.rendered = { renderedOn, cropped, text };
    }
    return {
      content: [
        { type: 'text', text: JSON.stringify(described, null, 2) },
        ...images,
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

  registerAppTool(server, 'edit_blocks', {
    title: 'Edit a page',
    _meta: SHOWS_PICTURES,
    description: `Change a page's blocks, or its own fields (an "update" on "_page"). With dryRun the changes are applied but not saved, and the resulting page is returned; resubmit without dryRun to save. With dryRun, "preview" also renders the result as a visitor would see it — a screenshot and the page's text. A save is refused if the page has changed since expectedVersion — read it again and reapply.\n\n${OPS_HELP}`,
    inputSchema: {
      path: z.string().describe('The page path, e.g. /about'),
      expectedVersion: z.string().describe('The version get_page returned'),
      ops: z.array(z.object({ op: z.enum(['update', 'add', 'move', 'delete']) }).passthrough()),
      dryRun: z.boolean().optional().describe('Show the result without saving'),
      preview: z.enum(['desktop', 'mobile']).optional().describe('With dryRun: render the result at this width'),
      changeTemplates: z.boolean().optional().describe('Allow changing blocks that belong to a template (marked "templateId"; locked ones are "readOnly"). '
        + 'The template is changed, so the change appears on every page that uses it.'),
    },
  }, async ({ path, expectedVersion, ops, dryRun, preview, changeTemplates }, extra) => {
    const result = await adminFor(extra).withEditor(path, (agent, { render }) => editPage(agent, {
      ops, expectedVersion, dryRun, changeTemplates, mintId: randomUUID,
      render: preview && ((draft) => render(draft, preview, { maxChars: IMAGE_CHARS })),
    }));
    if (!result.rendered) return asResult(result);
    const { rendered, ...rest } = result;
    const { text, renderedOn, cropped } = rendered;
    return {
      content: [
        { type: 'text', text: JSON.stringify({ ...rest, renderedOn, cropped, renderedText: text }, null, 2) },
        asImage(rendered),
      ],
    };
  });

  registerAppResource(server, 'Screenshot', SCREENSHOT_VIEW, {
    description: 'Shows the person the pictures a tool took of the site\'s pages',
  }, async () => ({ contents: [{ uri: SCREENSHOT_VIEW, mimeType: RESOURCE_MIME_TYPE, text: SCREENSHOT_VIEW_HTML }] }));

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
