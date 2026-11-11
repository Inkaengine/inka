/**
 * The Inka MCP server's tools (createServer). Agents read and edit pages
 * through a headless Inka admin: each tool call moves it to the page's editor,
 * works through the admin's agent API, and leaves the editor. Nothing is held
 * between calls — a dry run is dropped and the page's lock let go when the
 * editor is left.
 *
 * Nothing here starts a server: stdio.mjs runs these tools for one person over
 * stdio, http.mjs for many over HTTP. The hosted server is bundled into one
 * file, where a module that started itself when it was the program being run
 * would start there too.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { adminPool } from './adminPool.mjs';
import { subjectOf } from './tokenStore.mjs';
import { renewDelay, watchSignOut } from './signIn.mjs';
import { SCREENSHOT_VIEW, screenshotViewHtml } from './screenshotView.mjs';
import { DROP_VIEW, dropViewHtml } from './dropView.mjs';
import { PictureGone, MediaGone, MEDIA_MS } from './codes.mjs';
import { fetchMedia, isPublicAddress, mediaIn, MediaRefused, MEDIA_PREFIX } from './media.mjs';
import { draftCheck } from './checkDraft.mjs';
import {
  previewLayout, getPage, editPage, listBlockTypes, describeBlock, search, listChildren, contentTypes, fillNewPage, movePage, renamePage, deletePage,
  getTransitions, transitionPage, draftInfo, draftForAgent, editTarget, LIVE_EDIT_WARNING, findUndeclaredFields,
} from './tools.mjs';

const OPS_HELP = `Operations, applied in order:
- {"op":"update","id":"<uid>","set":{field: value}} — change fields of a block. Only the fields named change: a field set to null is removed; a field that is an object of fields (such as "styles") takes the fields named inside it and keeps the others; a region named (a list of blocks) becomes the blocks given, keeping each by its "@uid", and the block's other regions are left as they are; any other value is replaced whole.
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

- A page is a block of its content type (the site's own: list_content_types says which a section takes): its own fields (title, summary and the rest of its content type's fields) and its regions, which hold its blocks. Blocks have types (Text, Image, Hero, …; list_block_types gives each type's title, fields and regions), and some hold blocks of their own. In the editor, blocks are known by those titles and fields by their labels; ids and JSON are never shown.
- The site's own front end draws every page. view_page shows a page as visitors see it; preview_layout (a whole proposed layout) and edit_blocks with dryRun and preview (a change to the page) show the result the same way. None of them saves anything. In clients that show them, the person sees these pictures too. A long page's picture may show only its top ("cropped" says how much); its text ("renderedText") is all there.
- Some blocks come from a template that many pages share (they carry "templateId"; "readOnly" ones are locked, as the editor shows them). A change to one is a change to the template, and so to every page that uses it: edit_blocks with changeTemplates. In the editor, unlocking a template warns of the same.
- Saving (edit_blocks without dryRun, create_page, move_page, rename_page, delete_page, transition_page) changes the site itself: visitors of a published page see the change straight away. Whether a page is published is its "reviewState", which create_page and a save report: a new page may be private, so visitors can't see it yet. get_transitions says what can be done to a page and what each can set at the same time (a publishing date, an expiry); publishing, making a draft of a published page and changing who has access are all transitions, taken with transition_page. Publish only when the person has asked for it.
- A page has at most one draft, and it stays the same page at the same path. While it has one ("draft" in get_transitions and get_page), get_page and edit_blocks work on the draft and visitors keep seeing the page as it was, until the draft is published. view_page shows what visitors see unless asked for the draft. In an emergency, get_page and edit_blocks with "live" change what visitors see now, without publishing the draft; but publishing the draft replaces the live page, so make the same change on the draft too or it will be lost. To show someone the draft, give them its "url": they sign in to see it, and it is only at that address, not the page's.
- search finds pages by their title, their summary and the text of their Text blocks. Text in other blocks' fields (a hero's heading, a teaser's title) may not be searched.
- To find what isn't live yet, use search rather than going through pages one by one: "hasDraft" finds live pages with a draft waiting (the change isn't live), "reviewState" (such as ["private", "pending"]) finds pages visitors can't see at all. They can be asked together.`;

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

/** For the view only: a client lists it to the view, never to the model. */
const FOR_THE_VIEW = { ui: { resourceUri: SCREENSHOT_VIEW, visibility: ['app'] } };

const SCREENSHOT_VIEW_HTML = screenshotViewHtml();

/** The most a file an agent stages may be. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const DROP_VIEW_HTML = dropViewHtml({ maxBytes: MAX_FILE_BYTES });

/** A picture's file extension, for its name when the agent gives none. */
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg' };

/**
 * The MCP server's tools. `adminFor(extra)` is the admin to work in for a
 * request: the one signed-in user's (stdio), or the requesting user's, from
 * their access token (http.mjs). `pictures` keeps each picture a tool takes,
 * for the screenshot view to fetch (codes.mjs), or is null to keep none;
 * `userOf(extra)` is the request's user, whose pictures they are.
 *
 * A picture goes in the tool's result, for the model; a client that shows
 * views (Claude) hands the view that result without it, so the result also
 * names it (`pictures`, ids), and the view asks for each with `picture`.
 *
 * `media` keeps the files an agent stages (stage_media, media.mjs) until a page
 * change uses them, or is null to keep none: then there is no stage_media.
 * `localFiles` reads a file on the person's own computer from the folders they
 * allowed (media.mjs), or is null where there is no such source (hosted).
 */
export function createServer(adminFor, { pictures, media, localFiles, userOf }) {
  if (pictures === undefined) throw new Error('createServer: `pictures` is required (codes.mjs), or null to keep none');
  if (media === undefined) throw new Error('createServer: `media` is required (codes.mjs), or null to keep none');
  if (localFiles === undefined) throw new Error('createServer: `localFiles` is required (media.mjs), or null for none');
  const server = new McpServer({ name: 'inka', version: '0.0.1' }, { instructions: INSTRUCTIONS });
  /** The ids `rendered` pictures are kept under, for the request's user (none when nothing is kept). */
  const keep = async (extra, rendered) => (pictures === null ? [] : Promise.all(rendered.map(({ image, mimeType }) => (
    pictures.issue({ user: userOf(extra), mimeType, data: image })
  ))));
  /** A picture this server took for `user`, as a file named `name` (or picture.<extension>). */
  const pictureFile = async (picture, name, user) => {
    if (pictures === null) throw new PictureGone('this server keeps no pictures');
    const held = await pictures.peek(picture);
    if (held.user !== user) throw new PictureGone('not a picture this server took');
    const extension = EXTENSIONS[held.mimeType];
    if (!extension) throw new Error(`stage_media: a picture of type ${held.mimeType} has no file extension here`);
    return { name: name ?? `picture.${extension}`, type: held.mimeType, data: held.data };
  };
  /** The file `id` (a media id) names, as the request's user added it: `{ name, type, data }`. */
  const heldFile = (extra) => media && (async (id) => {
    const { user, ...file } = await media.peek(id.slice(MEDIA_PREFIX.length));
    if (user !== userOf(extra)) throw new MediaGone(`${id} is not a file you added`);
    return file;
  });

  /** The page's draft, which is what reading and editing it reach; null if it has none. */
  const draftOf = (extra, path) => adminFor(extra).withSite((site) => draftInfo(site, path));

  server.registerTool('get_page', {
    title: 'Read a page',
    annotations: SAVES_NOTHING,
    description: 'Read a page. The page is itself a block of its content type: "@uid" "_page", "@type" its content type (one of the site\'s; see list_content_types), its own fields (title, description — the summary — and the rest of its content type\'s fields), and its regions as lists of blocks ("blocks", and any others such as a footer). Each block has "@uid" and "@type"; containers hold their child blocks in lists named for the region; rich text is {"md": "..."}. Change the page\'s own fields with edit_blocks, an "update" on "_page". Keep "version" — edit_blocks needs it.',
    inputSchema: z.object({
      path: z.string().describe('The page path, e.g. /about'),
      live: z.boolean().optional().describe('If the page has a draft: read what visitors see now, not the draft'),
    }),
  }, async ({ path, live }, extra) => {
    const draft = await draftOf(extra, path);
    const read = await adminFor(extra).withEditor(editTarget(path, draft, live), getPage);
    return asResult(draft ? { ...read, path, draft: draftForAgent(draft), ...(live && { live: true }) } : read);
  });

  registerAppTool(server, 'preview_layout', {
    title: 'Try a layout',
    annotations: SAVES_NOTHING,
    _meta: SHOWS_PICTURES,
    description: 'Render a whole proposed layout for a page as a visitor would see it, without saving anything: the page with "blocks" (in the get_page format; containers hold their child blocks in lists) in place of its own. Returns a screenshot and the rendered text. To change part of the current page, use edit_blocks with dryRun and preview instead.',
    inputSchema: z.object({
      path: z.string().describe('The page path, e.g. /about'),
      blocks: z.array(z.object({ '@type': z.string() }).loose()).describe('The proposed blocks, in order'),
      viewport: z.enum(['desktop', 'mobile']).optional().describe('The screen width to render at (default desktop)'),
    }),
  }, async ({ path, blocks, viewport = 'desktop' }, extra) => {
    const rendered = await adminFor(extra).withEditor(path, (agent, { site, render }) => previewLayout(agent, {
      blocks, mintId: randomUUID, check: draftCheck(agent, site), heldFile: heldFile(extra), render: (draft) => render(draft, viewport, { maxChars: IMAGE_CHARS }),
    }));
    const { text, renderedOn, cropped } = rendered;
    const kept = await keep(extra, [rendered]);
    return {
      content: [
        { type: 'text', text: JSON.stringify({ path, viewport, renderedOn, cropped, renderedText: text, saved: false, pictures: kept }, null, 2) },
        asImage(rendered),
      ],
    };
  });

  registerAppTool(server, 'view_page', {
    title: 'See a page',
    annotations: SAVES_NOTHING,
    _meta: SHOWS_PICTURES,
    description: 'See a page as a visitor sees it: a screenshot rendered by the site\'s own front end, and the page\'s visible text. get_page gives the blocks, not how they render. To see a change before saving it, use edit_blocks with dryRun and preview.',
    inputSchema: z.object({
      path: z.string().describe('The page path, e.g. /about'),
      viewport: z.enum(['desktop', 'mobile']).optional().describe('The screen width to render at (default desktop)'),
      draft: z.boolean().optional().describe('Show the page\'s draft rather than what visitors see now'),
    }),
  }, async ({ path, viewport = 'desktop', draft: wantsDraft }, extra) => {
    const draft = wantsDraft && await draftOf(extra, path);
    if (wantsDraft && !draft) throw new Error(`${path} has no draft`);
    const rendered = await adminFor(extra).withEditor(
      draft?.path ?? path, async (agent, { render }) => render(await agent.getDraft(), viewport, { maxChars: IMAGE_CHARS }),
    );
    const { text, renderedOn, cropped } = rendered;
    const kept = await keep(extra, [rendered]);
    return {
      content: [
        { type: 'text', text: JSON.stringify({ path, ...(draft && { draft: draftForAgent(draft) }), viewport, renderedOn, cropped, renderedText: text, pictures: kept }, null, 2) },
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
    description: 'Find pages by their text, content type or state (workflow state, or having a draft), narrowed to a section. Returns the total and a page of results: path, title, type, description and workflow state ("reviewState"). A page with a draft says "hasDraft". Use a result\'s path with get_page.',
    inputSchema: z.object({
      text: z.string().optional().describe('Words to find (each word matches as a prefix)'),
      types: z.array(z.string()).optional().describe('Content type ids, as list_content_types gives them'),
      reviewState: z.array(z.string()).optional().describe('Workflow states, e.g. ["private", "pending"] to find what visitors can\'t see yet'),
      hasDraft: z.boolean().optional().describe('Find pages with a draft waiting. With "reviewState", pages in either state. Not with "text" or "types"'),
      path: z.string().optional().describe('Only inside this section, e.g. /news'),
      ...paging,
    }),
  }, async (args, extra) => asResult(await adminFor(extra).withSite((site) => search(site, args))));

  server.registerTool('find_undeclared_fields', {
    title: 'Find fields nothing reads',
    annotations: SAVES_NOTHING,
    description: 'Fields stored on the blocks of a section\'s pages that no block type declares. Nothing reads them and the editor cannot show them, so what they say never reached the page: a style written beside "styles" instead of inside it, or a misspelt name. Each block type and field once, with the pages that hold it ("pages") and, when the block has a field of that name inside one of its own, where it belongs ("belongsIn", e.g. "styles.align"). Checks a page of pages at a time: pass "next" as "start" for more. To fix one, ask the person first: an edit_blocks "update" that sets the field to null removes it; to put it where it belongs, set it there in the same update, e.g. {"styles": {"align": "center"}, "align": null}. Moving a value changes how the page looks, since it starts to take effect; if the block already has a value there, keep that one and only remove the stray.',
    inputSchema: z.object({ path: z.string().describe('The section to check, e.g. / or /news'), ...paging }),
  }, async ({ path, limit, start }, extra) => asResult(await adminFor(extra).withEditor(
    path, (agent, { site }) => findUndeclaredFields(agent, site, { path, limit, start }),
  )));

  server.registerTool('list_children', {
    title: 'List a section',
    annotations: SAVES_NOTHING,
    description: 'The pages directly inside a section, in their order: path, title, type, description, workflow state and "hasDraft" if it has a draft. "/" lists the top of the site.',
    inputSchema: z.object({ path: z.string().describe('The section, e.g. / or /docs'), ...paging }),
  }, async (args, extra) => asResult(await adminFor(extra).withSite((site) => listChildren(site, args))));

  const version = z.string().describe('The version get_page returned; refused if the page has changed since');

  server.registerTool('move_page', {
    title: 'Move a page',
    description: 'Move a page (and everything inside it) into another section, and/or change where it comes among its section\'s pages: that order is the order of the section\'s menu, as list_children shows it. Give "target" to move it, "position" to place it, or both. Returns its path.',
    inputSchema: z.object({
      path: z.string().describe('The page to move, e.g. /news/old-item'),
      target: z.string().optional().describe('The section to move it into, e.g. /archive'),
      position: z.union([
        z.enum(['first', 'last']),
        z.object({ before: z.string() }).strict(),
        z.object({ after: z.string() }).strict(),
      ]).optional().describe('Where it goes among the pages of its section (the one it is moved into, if "target" is given): "first", "last", {"before": "<path>"} or {"after": "<path>"} of a page in that section'),
      expectedVersion: version,
    }),
  }, async (args, extra) => asResult(await adminFor(extra).withSite((site) => movePage(site, args))));

  server.registerTool('rename_page', {
    title: 'Rename a page',
    description: 'Change a page\'s short name (the last part of its path, so its URL) and/or its title. Returns its path.',
    inputSchema: z.object({
      path: z.string().describe('The page, e.g. /about/team'),
      id: z.string().optional().describe('The new short name, e.g. people'),
      title: z.string().optional().describe('The new title'),
      expectedVersion: version,
    }),
  }, async (args, extra) => asResult(await adminFor(extra).withSite((site) => renamePage(site, args))));

  server.registerTool('delete_page', {
    title: 'Delete a page',
    annotations: { destructiveHint: true },
    description: 'Delete a page and everything inside it. This cannot be undone here. If other pages link to it or to anything in it, nothing is deleted and the refusal names those pages, as the editor warns a person: tell the person, and delete with "breakLinks" only if they still want it gone. Returns how many items went with it ("alsoDeleted") and the pages left with broken links ("brokenLinksOn").',
    inputSchema: z.object({
      path: z.string().describe('The page to delete'),
      expectedVersion: version,
      breakLinks: z.boolean().optional().describe('Delete even though other pages link to it, leaving those links broken'),
    }),
  }, async (args, extra) => asResult(await adminFor(extra).withSite((site) => deletePage(site, args))));

  server.registerTool('get_transitions', {
    title: 'What can be done to a page',
    annotations: SAVES_NOTHING,
    description: 'A page\'s workflow state ("state"), its "version", and the "transitions" the signed-in user can take now: one not listed can\'t be taken from this state or by this user. Each transition has an "id", a "label" (call it that to the person), "takes" (the settings it can make at the same time, such as a publishing date or an expiry: a field\'s "type" says what value it wants) and "current" (what those settings are now). Making a draft of a published page is a transition, and so are publishing and discarding it; a page with a draft says so ("draft"). "update" is one too: it stays in the same state and changes who has access (a field per role, listing the people and groups who hold it), the address and the menu listing.',
    inputSchema: z.object({ path: z.string().describe('The page, e.g. /about/team') }),
  }, async (args, extra) => asResult(await adminFor(extra).withSite((site) => getTransitions(site, args))));

  server.registerTool('transition_page', {
    title: 'Take a transition',
    description: 'Take one of the transitions get_transitions offers, such as publishing the page, with any of the settings it "takes". Publishing makes the page visible to visitors, or at its publishing date. Returns the page\'s "path" (changed only if the transition gave it a new address), its "reviewState", its new "version" and its "draft" if it has one. A transition not on offer, or a setting it does not take, is refused and nothing changes.',
    inputSchema: z.object({
      path: z.string().describe('The page, e.g. /about/team'),
      id: z.string().describe('The transition\'s id, as get_transitions gives it, e.g. publish'),
      data: z.record(z.string(), z.unknown()).optional().describe('Settings to make at the same time, named as in its "takes", e.g. {"effective": "2027-01-01T09:00:00"}'),
      expectedVersion: z.string().describe('The version get_transitions or get_page returned; refused if the page has changed since'),
    }),
  }, async (args, extra) => asResult(await adminFor(extra).withSite((site) => transitionPage(site, args))));

  server.registerTool('list_block_types', {
    title: 'List block types',
    annotations: SAVES_NOTHING,
    description: 'The block types a page can hold: each type\'s fields (required ones marked; "markdown" fields take {"md": "..."}; a field with "fields" of its own takes an object of them, e.g. "styles": {"align": "center"}, never those fields at the block\'s top level) and its regions — the lists of child blocks, named as in get_page, with the types each allows. "page" lists what the page itself takes; "contentType" names the page\'s own type, listed with the others — its fields are the page\'s own (title, summary, …).',
    inputSchema: z.object({ path: z.string().describe('The page path, e.g. /about') }),
  }, async ({ path }, extra) => asResult(await adminFor(extra).withEditor(path, listBlockTypes)));

  registerAppTool(server, 'describe_block', {
    title: 'Describe a block type',
    annotations: SAVES_NOTHING,
    _meta: SHOWS_PICTURES,
    description: 'One block type in full, as the page at "path" can use it: what it is, its front end\'s guidance on using it, its variations, every field (required ones marked; "markdown" fields take {"md": "..."}; a field with "fields" of its own takes an object of them), its regions, where on the page it can go, examples of it filled in from its front end, and a real one from a page on the site, showing the exact value each field takes (links, images, choices). With "preview", each front-end example is also rendered as a visitor sees it: use that to see what a block type looks like before proposing it.',
    inputSchema: z.object({
      path: z.string().describe('The page you will add it to, e.g. /about'),
      type: z.string().describe('The block type, as list_block_types names it, e.g. teaser'),
      preview: z.enum(['desktop', 'mobile']).optional().describe('Render each example at this width'),
    }),
  }, async ({ path, type, preview }, extra) => {
    const described = await adminFor(extra).withEditor(path, (agent, { site, render }) => describeBlock(agent, site, {
      // The examples share the room for pictures.
      type, render: preview && ((draft, uid, of) => render(draft, preview, { focus: uid, maxChars: Math.floor(IMAGE_CHARS / of) })),
    }));
    if (!preview) return asResult(described);
    // Each example's picture follows the text, in the examples' order.
    const images = described.examples.map(({ rendered }) => asImage(rendered));
    const kept = await keep(extra, described.examples.map(({ rendered }) => rendered));
    for (const example of described.examples) {
      const { text, renderedOn, cropped } = example.rendered;
      example.rendered = { renderedOn, cropped, text };
    }
    return {
      content: [
        { type: 'text', text: JSON.stringify({ ...described, pictures: kept }, null, 2) },
        ...images,
      ],
    };
  });

  server.registerTool('list_content_types', {
    title: 'List content types',
    annotations: SAVES_NOTHING,
    description: 'The kinds of page (content types) you may add inside a section: each one\'s id, for create_page, and its title, as the editor names it. Which there are, and which go where, is the site\'s.',
    inputSchema: z.object({ path: z.string().describe('The section, e.g. / or /docs') }),
  }, async (args, extra) => asResult(await adminFor(extra).withSite((site) => contentTypes(site, args))));

  server.registerTool('create_page', {
    title: 'Create a page',
    description: 'Add a page inside a section, as an editor does through the admin\'s add form, and save it. Optional "blocks" (in the get_page format, each with your own "@uid" if you will refer to it) are added after the blocks the page starts with. For an item that is a file, such as an Image or a File, "file" is the media id of a file you staged (stage_media), and the item is made of it: the result\'s "media" gives the item, which the id names from then on. Returns the new page\'s path, its version for edit_blocks, its "reviewState" (a new page may be private, so visitors can\'t see it yet) and the ids of your blocks.',
    inputSchema: z.object({
      parent: z.string().describe('The section to add it to, e.g. /docs'),
      title: z.string().describe('The page title'),
      type: z.string().describe('The content type id: one list_content_types gives for this section'),
      blocks: z.array(z.object({ '@type': z.string() }).loose()).optional().describe('Blocks to start with'),
      ...(media && { file: z.string().optional().describe('For an Image, a File or another item that is a file: the media id of its file') }),
    }),
  }, async ({ parent, title, type, blocks, file }, extra) => {
    if (mediaIn(blocks ?? []).size) {
      throw new MediaRefused('a new page does not take new files yet: create the page first, then add them with edit_blocks');
    }
    if (!file) {
      return asResult(await adminFor(extra).withNewPage({ parent, type, title }, (agent, { site }) => (
        fillNewPage(agent, { blocks, mintId: randomUUID, check: draftCheck(agent, site) })
      )));
    }
    if (mediaIn(file).size !== 1) throw new MediaRefused(`"file" is a media id from stage_media, not ${JSON.stringify(file)}`);
    if (blocks?.length) throw new MediaRefused('an item that is a file has no blocks: give "file" or "blocks", not both');
    const held = await heldFile(extra)(file);
    if (held.uploaded) throw new MediaRefused(`${file} is already on the site, as ${held.uploaded}: use that item`);
    const { name, type: fileType, data } = held;
    const made = await adminFor(extra).withNewPage({ parent, type, title, file: { name, type: fileType, data } }, async (_, { site, created }) => ({
      ...created, version: (await site.status(created.path)).version, reviewState: (await site.get(created.path)).review_state,
    }));
    // The media id names the item from now on, as one a save uploaded does.
    const code = file.slice(MEDIA_PREFIX.length);
    await media.update(code, { user: userOf(extra), name, type: fileType, uploaded: made.url });
    return asResult({ path: made.path, version: made.version, reviewState: made.reviewState, media: { [file]: made.url } });
  });

  registerAppTool(server, 'edit_blocks', {
    title: 'Edit a page',
    _meta: SHOWS_PICTURES,
    description: `Change a page's blocks, or its own fields (an "update" on "_page"). With dryRun the changes are applied but not saved, and the resulting page is returned; resubmit without dryRun to save. With dryRun, "preview" also renders the result as a visitor would see it — a screenshot and the page's text. A save is refused if the page has changed since expectedVersion — read it again and reapply.\n\n${OPS_HELP}`,
    inputSchema: z.object({
      path: z.string().describe('The page path, e.g. /about'),
      expectedVersion: z.string().describe('The version get_page returned'),
      ops: z.array(z.object({ op: z.enum(['update', 'add', 'move', 'delete']) }).loose()),
      live: z.boolean().optional().describe('If the page has a draft: change what visitors see now, not the draft. Only for an emergency, with a version from get_page with "live"'),
      dryRun: z.boolean().optional().describe('Show the result without saving'),
      preview: z.enum(['desktop', 'mobile']).optional().describe('With dryRun: render the result at this width'),
      changeTemplates: z.boolean().optional().describe('Allow changing blocks that belong to a template (marked "templateId"; locked ones are "readOnly"). '
        + 'The template is changed, so the change appears on every page that uses it.'),
    }),
  }, async ({ path, live, expectedVersion, ops, dryRun, preview, changeTemplates }, extra) => {
    const draft = await draftOf(extra, path);
    const result = await adminFor(extra).withEditor(editTarget(path, draft, live), (agent, { site, render }) => editPage(agent, {
      ops, expectedVersion, dryRun, changeTemplates, mintId: randomUUID, check: draftCheck(agent, site), heldFile: heldFile(extra),
      render: preview && ((draft) => render(draft, preview, { maxChars: IMAGE_CHARS })),
    }));
    // Each file the save put on the site: its media id names that item from now on.
    for (const [id, url] of Object.entries(result.media ?? {})) {
      const code = id.slice(MEDIA_PREFIX.length);
      const { user, name, type } = await media.peek(code);
      await media.update(code, { user, name, type, uploaded: url });
    }
    const onDraft = draft ? { draft: draftForAgent(draft), ...(live && { live: true, ...(!dryRun && { warning: LIVE_EDIT_WARNING }) }) } : {};
    if (!result.rendered) return asResult({ ...result, ...onDraft });
    const { rendered, ...rest } = result;
    const { text, renderedOn, cropped } = rendered;
    const kept = await keep(extra, [rendered]);
    return {
      content: [
        { type: 'text', text: JSON.stringify({ ...rest, ...onDraft, renderedOn, cropped, renderedText: text, pictures: kept }, null, 2) },
        asImage(rendered),
      ],
    };
  });

  if (media !== null) {
    /** `files` (`{ name, type, data }`) kept for `user`: what stage_media and stage_dropped answer. */
    const stageAll = async (user, files) => {
      const held = [];
      for (const file of files) {
        held.push({
          media: `${MEDIA_PREFIX}${await media.issue({ user, ...file })}`,
          name: file.name, type: file.type, bytes: Buffer.from(file.data, 'base64').length,
        });
      }
      return { staged: true, onSite: false, keptUntil: new Date(Date.now() + MEDIA_MS).toISOString(), files: held };
    };

    server.registerTool('stage_media', {
      title: 'Stage images or files for a page change (not on the site yet)',
      // It keeps the files on this server, for a change; nothing on the site changes.
      annotations: { readOnlyHint: true, openWorldHint: true },
      description: `Stage images, or any other files, for a page change. Nothing is uploaded to the site: each file is kept on this MCP server for two hours, and goes onto the site only when a change that uses it is saved. Each comes from a "url" on the public internet${localFiles ? ', a "path" to a file on the person\'s computer, in a folder they allowed,' : ''} or a "picture" a tool here took (an id from a result's "pictures"), at most 10 MB. Returns a "media" id for each, in the order given: put it in edit_blocks where an image or a file goes, as you would an existing item's URL, or in a page's own file field (factory "Image" or "File", such as a lead image), which keeps the file in the page. A preview (edit_blocks with dryRun and preview, or preview_layout) shows it. When the change is saved, each file it uses is uploaded beside the page, and the save's "media" gives the item it became; the "media" id names that item from then on, for as long as it is kept. If any file can't be had, none are staged. create_page makes an Image or File item of one (its "file"); for a new page\'s blocks, create the page, then add files with edit_blocks.`,
      inputSchema: z.object({
        files: z.array(z.object({
          url: z.string().optional().describe('The file\'s URL, http or https'),
          picture: z.string().optional().describe('A picture id from a result\'s "pictures"'),
          ...(localFiles && { path: z.string().optional().describe('A whole path to a file on the person\'s computer, in a folder they allowed') }),
          name: z.string().optional().describe('Its file name, e.g. "team.jpg" (from the URL if not given)'),
        })).min(1).describe(`Each file: a "url"${localFiles ? ', a "path"' : ''} or a "picture", and optionally its "name"`),
      }),
    }, async ({ files }, extra) => {
      const user = userOf(extra);
      // Every file first: if one can't be had, none are staged.
      const had = [];
      for (const [i, { url, picture, path, name }] of files.entries()) {
        const which = `file ${i + 1} (${url ?? picture ?? path})`;
        if ([url, picture, path].filter(Boolean).length !== 1) {
          throw new MediaRefused(`file ${i + 1}: give a "url"${localFiles ? ', a "path"' : ''} or a "picture", one of them`);
        }
        try {
          if (url) had.push(await fetchMedia(url, { maxBytes: MAX_FILE_BYTES, isAllowed: isPublicAddress, name }));
          else if (path) had.push(await localFiles(path, name));
          else had.push(await pictureFile(picture, name, user));
        } catch (error) {
          if (!(error instanceof MediaRefused || error instanceof PictureGone)) throw error;
          throw new MediaRefused(`${which}: ${error.message}. Nothing was staged.`, { cause: error });
        }
      }
      return asResult(await stageAll(user, had));
    });

    registerAppTool(server, 'ask_for_files', {
      title: 'Ask the person for files to add',
      // It shows a place to drop them; nothing on the site changes.
      annotations: SAVES_NOTHING,
      _meta: { ui: { resourceUri: DROP_VIEW } },
      description: 'Ask the person for images or files of their own to add to a page, such as a photo on their computer or one they attached to the conversation (whose bytes this server can\'t reach). The conversation shows them a place to drop the files under this call. Each file they drop is staged as stage_media stages one (kept here for two hours, not on the site), and a message from them then gives each one\'s "media" id: use it in edit_blocks as you would one from stage_media. Wait for that message; this call returns at once.',
      inputSchema: z.object({ what: z.string().describe('What you need, as the person will read it, e.g. "the team photo for the About page"') }),
    }, async ({ what }) => asResult({ asked: what, staged: false }));

    registerAppTool(server, 'stage_dropped', {
      title: 'Stage a file the person dropped, for the drop view',
      annotations: SAVES_NOTHING,
      _meta: { ui: { resourceUri: DROP_VIEW, visibility: ['app'] } },
      description: 'A file the person dropped in the drop view (ask_for_files), staged as stage_media stages one: for the view, which a client hands the drop.',
      inputSchema: z.object({
        name: z.string().min(1).describe('The file\'s name'),
        type: z.string().min(1).describe('Its media type, e.g. image/png'),
        data: z.string().describe('Its bytes, base64'),
      }),
    }, async ({ name, type, data }, extra) => {
      if (Buffer.byteLength(data, 'base64') > MAX_FILE_BYTES) throw new MediaRefused(`${name} is larger than ${MAX_FILE_BYTES} bytes, the most a file may be`);
      const result = await stageAll(userOf(extra), [{ name, type, data }]);
      return { ...asResult(result), structuredContent: result };
    });

    registerAppResource(server, 'Add files', DROP_VIEW, {
      description: 'Where the person drops their own files for a page change',
    }, async () => ({ contents: [{ uri: DROP_VIEW, mimeType: RESOURCE_MIME_TYPE, text: DROP_VIEW_HTML }] }));
  }

  if (pictures !== null) {
    registerAppTool(server, 'picture', {
      title: 'A picture, for the screenshot view',
      annotations: SAVES_NOTHING,
      _meta: FOR_THE_VIEW,
      description: 'One of the pictures a tool took (its result names them, "pictures"), as data: for the screenshot view, which a client hands the result without them.',
      inputSchema: z.object({ id: z.string().describe('A picture id from a result\'s "pictures"') }),
    }, async ({ id }, extra) => {
      const held = await pictures.peek(id);
      if (held.user !== userOf(extra)) throw new PictureGone('not a picture this server took');
      return {
        content: [{ type: 'text', text: `the picture ${id}` }],
        structuredContent: { mimeType: held.mimeType, data: held.data },
      };
    });
  }

  registerAppResource(server, 'Screenshot', SCREENSHOT_VIEW, {
    description: 'Shows the person the pictures a tool took of the site\'s pages',
  }, async () => ({ contents: [{ uri: SCREENSHOT_VIEW, mimeType: RESOURCE_MIME_TYPE, text: SCREENSHOT_VIEW_HTML }] }));

  return server;
}
