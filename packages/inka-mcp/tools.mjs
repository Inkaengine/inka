/**
 * What the MCP tools do, given an agent on a page open in a headless admin.
 *
 * Stateless: each tool call works on the page as it is loaded for that call.
 * A dry run changes the open editor and reports the result without saving —
 * the caller discards it by reloading. A save is refused if the page has
 * changed since the agent read it (its version).
 */
import { toAgentPage, toAgentBlock, toStoredBlocks } from './pageFormat.mjs';
import { editBlocks } from './editBlocks.mjs';
import { mediaIn, withMedia, dataUrlOf } from './media.mjs';
import { describeBlockTypes, describeBlockType } from './blockTypes.mjs';

export class StaleVersion extends Error {}

/** Someone else is editing the page (they hold its lock): an agent waits, it never takes over. */
export class Locked extends Error {
  constructor(path, { user, since }) {
    super(`${path} is being edited by ${user} since ${since}. Try again once they have finished; don't take the page over.`);
  }
}

/** The page in the agent format, with the version a later save is checked against. */
export async function getPage(agent) {
  const { path, version, formData, lockedBy } = await agent.getPage();
  const { page, types } = await agent.getBlockSchemas();
  const type = types[page.contentType];
  if (!type) throw new Error(`the page's content type "${page.contentType}" has no schema`);
  return { path, version, ...(lockedBy && { lockedBy }), ...toAgentPage(formData, type) };
}

/**
 * A page just created (open in its editor), given its first blocks: they go
 * after the blocks the page starts with (its title), and the page is saved.
 * Returns { path, version, ids } — ids maps each new block's own @uid.
 * `check` refuses blocks that would leave the page invalid, as editPage's does.
 */
export async function fillNewPage(agent, { blocks, mintId, check }) {
  const created = await getPage(agent);
  if (!blocks?.length) return { path: created.path, version: created.version, ids: {} };
  const last = created.blocks.at(-1)['@uid'];
  const { version, ids } = await editPage(agent, {
    ops: [{ op: 'add', after: last, blocks }], expectedVersion: created.version, mintId, check,
  });
  return { path: created.path, version, ids };
}

/**
 * Find pages: by text, narrowed by content type and to a section (`path`).
 * Returns { total, items: [{ path, title, type, description, reviewState }] }.
 */
/** What a text search looks in: Plone's SearchableText, with the text of Text blocks (plone.restapi's blocks indexer). */
const SEARCHED = 'titles, summaries and the text of Text blocks; other blocks\' fields may not be searched';

export async function search(site, { text, types, path, limit, start }) {
  if (!text && !types) throw new Error('search needs "text" or "types"; to browse a section use list_children');
  const found = await site.search({ text, types, path, limit, start });
  return text ? { ...found, searched: SEARCHED } : found;
}

/** The pages directly inside `path`, in their order. */
export async function listChildren(site, { path, limit, start }) {
  return site.search({ path, depth: 1, limit, start });
}

/** Refuse to act on a page someone else is editing, or one that has changed since the agent read it. */
async function checkVersion(site, path, expectedVersion) {
  if (!expectedVersion) throw new Error('this needs the expectedVersion get_page returned');
  const { version: now, lockedBy } = await site.status(path);
  if (lockedBy) throw new Locked(path, lockedBy);
  if (now !== expectedVersion) {
    throw new StaleVersion(
      `${path} has changed since it was read (read at ${expectedVersion}, now ${now}). Read it again first.`,
    );
  }
}

/** Move a page into another section. Returns its new path. */
export async function movePage(site, { path, target, expectedVersion }) {
  await checkVersion(site, path, expectedVersion);
  return { path: await site.move({ path, target }) };
}

/** Change a page's short name (the last part of its path) and/or its title. Returns its path. */
export async function renamePage(site, { path, id, title, expectedVersion }) {
  if (!id && !title) throw new Error('rename_page needs a new "id" or "title"');
  await checkVersion(site, path, expectedVersion);
  return { path: await site.rename({ path, id, title }) };
}

/** Delete a page. */
export async function deletePage(site, { path, expectedVersion }) {
  await checkVersion(site, path, expectedVersion);
  await site.remove(path);
  return { deleted: path };
}

/** The block types this page can hold, their fields, and where child blocks go. */
export async function listBlockTypes(agent) {
  return describeBlockTypes(await agent.getBlockSchemas());
}

/** The first block of `type` on a stored page, nested blocks included: [uid, block]. */
function findBlock(node, type) {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findBlock(item, type);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  if (node.blocks && typeof node.blocks === 'object' && !Array.isArray(node.blocks)) {
    for (const [uid, block] of Object.entries(node.blocks)) {
      if (block?.['@type'] === type) return [uid, block];
    }
  }
  for (const value of Object.values(node)) {
    const found = findBlock(value, type);
    if (found) return found;
  }
  return null;
}

/**
 * One block type in full (see describeBlockType), with a real example: a block
 * of that type from a page on the site, in the agent format, and where it is.
 * A type no page uses yet has no site example, and says so.
 *
 * With `render(draft, uid, of)`, each example its front end declares is also
 * rendered on its own — a page holding only that block — as `rendered`; `of`
 * is how many there are, so their pictures can share one result.
 */
export async function describeBlock(agent, site, { type, render }) {
  const schemas = await agent.getBlockSchemas();
  const described = describeBlockType(schemas, type);
  if (render) {
    const declared = schemas.types[type].examples;
    if (!declared?.length) throw new Error(`the front end declares no examples of ${type} to render`);
    for (const [i, { block }] of declared.entries()) {
      const draft = { blocks: { [EXAMPLE_UID]: block }, blocks_layout: { items: [EXAMPLE_UID] } };
      described.examples[i].rendered = await render(draft, EXAMPLE_UID, declared.length);
    }
  }
  const pages = await site.search({ blockTypes: [type], limit: 5 });
  for (const { path } of pages.items) {
    const found = findBlock(await site.get(path), type);
    if (found) return { ...described, siteExample: { from: path, block: toAgentBlock(...found) } };
  }
  return { ...described, siteExample: null, siteExampleNote: `no page on the site uses a ${type} block yet` };
}

const EXAMPLE_UID = 'example';

/**
 * Apply `ops` (see editBlocks.mjs). With `dryRun`, return the resulting page
 * without saving; otherwise save and return the new version. `expectedVersion`
 * is the version the agent read. With a dry run, `render(draft)` (if given)
 * renders the draft as a visitor would see it, and its result is `rendered`.
 * With `changeTemplates`, the operations may change a template's locked
 * blocks: each template is saved before the page (`templatesChanged`), and so
 * changes on every page that uses it. `check({ path, saved, draft })` refuses a
 * change that would leave the page invalid (checkDraft.mjs), before anything
 * is rendered or saved.
 *
 * The operations may name files an agent staged (`media:<id>`, media.mjs):
 * `heldFile(id)` gives each one's `{ name, type, data }`, and the editor holds
 * it until Save (holdFile), so the operations run with the editor's
 * references. A dry run's page names the files by the agent's ids again; a
 * save says which item each file it uploaded became (`media`). A file an
 * earlier save uploaded (`uploaded`, its URL) is that item: it isn't held
 * again. A file the page no longer uses is not uploaded, and not in `media`.
 * A preview hands the front end each file as a data: URL, in place of its
 * reference: the promise a front end makes by setting deferImageUploads.
 */
export async function editPage(agent, { ops, expectedVersion, dryRun = false, changeTemplates = false, mintId, render, check, heldFile }) {
  if (!check) throw new Error('editPage: `check` is required (checkDraft.mjs draftCheck)');
  if (render && !dryRun) throw new Error('a preview is for a dry run: add dryRun');
  const named = mediaIn(ops);
  if (named.size && !heldFile) throw new Error("this server keeps no files (stage_media), so a change can't add one");
  if (!expectedVersion) throw new Error('edit_blocks needs the expectedVersion get_page returned');
  const { path, version: loaded, lockedBy, formData } = await agent.getPage();
  if (lockedBy && !dryRun) throw new Locked(path, lockedBy);
  if (loaded !== expectedVersion) {
    throw new StaleVersion(
      `the page has changed since it was read (read at ${expectedVersion}, now ${loaded}). Read it again and reapply.`,
    );
  }
  const { page: { contentType }, types: blocksConfig } = await agent.getBlockSchemas();
  // A file in one of the page's own file fields (a lead image) is kept in the
  // page, as Plone keeps it: the field takes the file itself, as the edit
  // form's file widget sets it, and nothing is held or uploaded.
  const inFields = new Map(); // a page field → the agent's media id in it
  const fileFields = named.size ? Object.entries(blocksConfig[contentType].blockSchema.properties)
    .filter(([, field]) => ['Image', 'File'].includes(field.factory)).map(([name]) => name) : [];
  for (const op of ops) {
    if (op.op !== 'update' || op.id !== '_page' || !op.set) continue;
    for (const field of fileFields) if (mediaIn(op.set[field] ?? null).size) inFields.set(field, op.set[field]);
  }
  for (const [field, id] of inFields) {
    const file = await heldFile(id);
    if (file.uploaded) {
      throw new Error(`${id} is already on the site, as ${file.uploaded}: the page's ${field} keeps a file of its own, so stage it again`);
    }
    ops = ops.map((op) => (op.op === 'update' && op.id === '_page' && op.set?.[field] === id
      ? { ...op, set: { ...op.set, [field]: { data: file.data, encoding: 'base64', 'content-type': file.type, filename: file.name } } }
      : op));
  }
  const swaps = new Map(); // an agent's media id → what the operations name the file by
  const refs = new Map(); // an agent's media id → the editor's reference, for a file not uploaded yet
  const dataUrls = new Map(); // the editor's reference → the file as a data: URL, for a preview
  for (const id of mediaIn(ops)) {
    const file = await heldFile(id);
    // A file a save already uploaded is that item now.
    if (file.uploaded) {
      swaps.set(id, file.uploaded);
      continue;
    }
    const ref = await agent.holdFile(file);
    swaps.set(id, ref);
    refs.set(id, ref);
    dataUrls.set(ref, dataUrlOf(file));
  }
  const { results, ids } = await editBlocks(agent, withMedia(ops, swaps), { blocksConfig, mintId, changeTemplates });
  await check({ path, saved: formData, draft: await agent.getDraft(), held: new Set(refs.values()) });
  if (dryRun) {
    const asNamed = new Map([...refs].map(([id, ref]) => [ref, id]));
    const page = withMedia(await getPage(agent), asNamed);
    for (const [field, id] of inFields) page[field] = id;
    const dry = { dryRun: true, results, ids, ...(lockedBy && { lockedBy }), page };
    if (render) {
      const draft = withMedia(await agent.getDraft(), dataUrls);
      // A front end reads a stored file field's download URL.
      for (const [field, id] of inFields) {
        const file = await heldFile(id);
        draft[field] = { filename: file.name, 'content-type': file.type, download: dataUrlOf(file) };
      }
      dry.rendered = await render(draft);
    }
    return dry;
  }
  // Templates are saved as their lock does it ("Change on all pages"), before the page.
  const templatesChanged = changeTemplates ? await agent.lockTemplates() : [];
  const { version, uploaded } = await agent.save({ expectedVersion });
  // Each file now on the site: one this save uploaded, or one an earlier save had.
  const media = Object.fromEntries([...swaps]
    .filter(([id, to]) => !refs.has(id) || to in uploaded)
    .map(([id, to]) => [id, refs.has(id) ? uploaded[to] : to]));
  // Its workflow state: a published page's visitors see the change now.
  return {
    results, ids, version, reviewState: formData.review_state,
    ...(changeTemplates && { templatesChanged }), ...(named.size && { media }),
  };
}

/**
 * A whole proposed layout for the page, rendered as a visitor would see it
 * and not saved: the page as it is, with `blocks` (agent format, as get_page
 * gives them) in place of its own. For trying alternatives before suggesting
 * one; `render(draft)` renders a draft of the page. `check` refuses a layout
 * that would leave the page invalid, as editPage's does.
 */
export async function previewLayout(agent, { blocks: proposedBlocks, render, mintId, check, heldFile }) {
  if (!check) throw new Error('previewLayout: `check` is required (checkDraft.mjs draftCheck)');
  // Nothing is held or saved: each file the layout names is a data: URL in it.
  const named = mediaIn(proposedBlocks);
  if (named.size && !heldFile) throw new Error("this server keeps no files (stage_media), so a layout can't show one");
  const shown = new Map(); // a media id → its item's URL once saved, else the file as a data: URL
  for (const id of named) {
    const file = await heldFile(id);
    shown.set(id, file.uploaded ? file.uploaded : dataUrlOf(file));
  }
  const blocks = withMedia(proposedBlocks, shown);
  const blocksConfig = (await agent.getBlockSchemas()).types;
  for (const block of blocks) {
    if (!blocksConfig[block['@type']]) {
      throw new Error(`no block type "${block['@type']}" (list_block_types lists what this page can hold)`);
    }
  }
  const { path, formData } = await agent.getPage();
  const proposed = { ...(await agent.getDraft()), ...toStoredBlocks(blocks, { blocksConfig, mintId }) };
  await check({ path, saved: formData, draft: proposed });
  return render(proposed);
}
