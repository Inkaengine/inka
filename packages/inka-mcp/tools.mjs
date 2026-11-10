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
import { whereItBelongs } from './checkDraft.mjs';
import validator from '@inka/content-validator';

const { checkBlockSchemas, fieldMapFromSchemas, idFieldMapFor } = validator;

export class StaleVersion extends Error {}

/** Someone else is editing the page (they hold its lock): an agent waits, it never takes over. */
export class Locked extends Error {
  constructor(path, { user, since }) {
    super(`${path} is being edited by ${user} since ${since}. Try again once they have finished; don't take the page over.`);
  }
}

/**
 * `value` with each link on the site's API (`apiPath`) as a path on the site. An
 * address a person never sees, and one an agent copied into new links and warned
 * about, though front ends draw the site's own links as paths either way.
 */
function withSitePaths(value, apiPath) {
  const onSite = new RegExp(`${apiPath.replace(/[.*+?^\\${}()|[\]\\]/g, '\\$&')}(?![\\w.:-])(/?)`, 'g');
  const walk = (v) => {
    if (typeof v === 'string') return v.replace(onSite, '/');
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, inner]) => [k, walk(inner)]));
    return v;
  };
  return walk(value);
}

/** The page in the agent format, with the version a later save is checked against. */
export async function getPage(agent) {
  const { path, version, formData, lockedBy, apiPath } = await agent.getPage();
  const { page, types } = await agent.getBlockSchemas();
  const type = types[page.contentType];
  if (!type) throw new Error(`the page's content type "${page.contentType}" has no schema`);
  const asAgent = toAgentPage(formData, type);
  return { path, version, ...(lockedBy && { lockedBy }), ...(apiPath ? withSitePaths(asAgent, apiPath) : asAgent) };
}

/**
 * A block that is only what the add form leaves to type in: its type has rich
 * text, that is empty, and it holds nothing else, and it is no template's. A
 * title block holds nothing either, but has no text of its own: it draws the
 * page's title.
 */
function isLeftToTypeIn(block, type) {
  const { '@uid': _uid, '@type': _type, ...held } = block;
  if (held.fixed || held.readOnly) return false;
  const fields = type.blockSchema.properties;
  const text = Object.keys(fields).filter((name) => fields[name].widget === 'slate');
  if (!text.length) return false;
  return Object.entries(held).every(([name, value]) => value === undefined || value === null || value === ''
    || (text.includes(name) && !(value.md ?? '').trim()));
}

/**
 * A page just created (open in its editor), given its first blocks: they go
 * after the blocks the page starts with (its title), in place of the empty one
 * the add form leaves to type in, and the page is saved.
 * Returns { path, version, reviewState, ids } — ids maps each new block's own @uid.
 * `check` refuses blocks that would leave the page invalid, as editPage's does.
 */
export async function fillNewPage(agent, { blocks, mintId, check }) {
  const created = await getPage(agent);
  if (!blocks?.length) {
    const { formData } = await agent.getPage();
    return { path: created.path, version: created.version, reviewState: formData.review_state, ids: {} };
  }
  const last = created.blocks.at(-1);
  const { types } = await agent.getBlockSchemas();
  const ops = [{ op: 'add', after: last['@uid'], blocks }];
  if (isLeftToTypeIn(last, types[last['@type']])) ops.push({ op: 'delete', id: last['@uid'] });
  const { version, reviewState, ids } = await editPage(agent, { ops, expectedVersion: created.version, mintId, check });
  return { path: created.path, version, reviewState, ids };
}

/**
 * Find pages: by text, narrowed by content type and to a section (`path`).
 * Returns { total, items: [{ path, title, type, description, reviewState }] }.
 */
/** What a text search looks in: Plone's SearchableText, with the text of Text blocks (plone.restapi's blocks indexer). */
const SEARCHED = 'titles, summaries and the text of Text blocks; other blocks\' fields may not be searched';

export async function search(site, { text, types, reviewState, hasDraft, path, limit, start }) {
  if (!text && !types && !reviewState && !hasDraft) throw new Error('search needs "text", "types", "reviewState" or "hasDraft"; to browse a section use list_children');
  if (hasDraft && (text || types)) throw new Error('"hasDraft" goes with "reviewState" alone: it finds pages by their state');
  if (hasDraft) return findByState(site, { reviewState, path, limit, start });
  const found = await asPages(site, await site.search({ text, types, reviewState, path, limit, start }));
  return text ? { ...found, searched: SEARCHED } : found;
}

/**
 * A page and its draft are one page, whatever the CMS stores. So a draft is not
 * listed, and the page it belongs to says it has one. The draft comes out after
 * the query, so a page of results can run short by the drafts on it.
 */
async function asPages(site, found) {
  const drafted = new Set((await site.pagesWithDrafts()).map((page) => page.path));
  const pages = found.items.filter((item) => !item.isDraft);
  return {
    ...found,
    total: found.total - (found.items.length - pages.length),
    items: pages.map((item) => (drafted.has(item.path) ? { ...item, hasDraft: true } : item)),
  };
}

/** Pages with a draft, then any pages in `reviewState`, each once. */
async function findByState(site, { reviewState, path, limit, start }) {
  const inSection = (page) => !path || path === '/' || page.path === path || page.path.startsWith(`${path}/`);
  const drafted = (await site.pagesWithDrafts()).filter(inSection).map((page) => ({ ...page, hasDraft: true }));
  if (!reviewState) return { total: drafted.length, items: drafted };
  const found = await asPages(site, await site.search({ reviewState, path, limit, start }));
  const others = found.items.filter((item) => !item.hasDraft);
  return { total: drafted.length + others.length, items: [...drafted, ...others] };
}

/** The pages directly inside `path`, in their order. */
/**
 * The content types the site lets this user add in `path`, by id and title.
 * Which types there are, and which go where, is each site's.
 */
export async function contentTypes(site, { path }) {
  return { path, types: await site.addableTypes(path) };
}

export async function listChildren(site, { path, limit, start }) {
  return asPages(site, await site.search({ path, depth: 1, limit, start }));
}

/** The page's draft: `path`, where it is stored, and the `url` a person can open it at; null if it has none. */
export async function draftInfo(site, path) {
  const draft = await site.draftOf(path);
  return draft && { path: draft, url: await site.adminUrl(draft) };
}

/** A draft as an agent is told of it: it works by the page's own path, so a person's link is all it needs. */
export const draftForAgent = ({ url }) => ({ url });

/** What reading or editing a page reaches: its draft if it has one, unless the live page is asked for. */
export const editTarget = (path, draft, live) => (draft && !live ? draft.path : path);

/** Publishing a draft copies all of it over the live page, so a fix made only on the live page goes. */
export const LIVE_EDIT_WARNING = 'The page\'s draft does not have this change, and publishing the draft replaces the live page with it. '
  + 'Make the same change on the draft too, or it will be lost when the draft is published.';


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

/** The page and its draft are one page, so it stays put until the draft is done with. */
async function refuseWithDraft(site, path) {
  if (await site.draftOf(path)) {
    throw new Error(`${path} has a draft: publish or discard the draft first (get_transitions)`);
  }
}

/** Move a page into another section. Returns its new path. */
export async function movePage(site, { path, target, expectedVersion }) {
  await refuseWithDraft(site, path);
  await checkVersion(site, path, expectedVersion);
  return { path: await site.move({ path, target }) };
}

/** Change a page's short name (the last part of its path) and/or its title. Returns its path. */
export async function renamePage(site, { path, id, title, expectedVersion }) {
  if (!id && !title) throw new Error('rename_page needs a new "id" or "title"');
  await refuseWithDraft(site, path);
  await checkVersion(site, path, expectedVersion);
  return { path: await site.rename({ path, id, title }) };
}

/** Delete a page. */
export async function deletePage(site, { path, expectedVersion }) {
  await refuseWithDraft(site, path);
  await checkVersion(site, path, expectedVersion);
  await site.remove(path);
  return { deleted: path };
}

/**
 * A page's state and what can be done to it: each transition with what it can
 * set at the same time ("takes") and what those are now ("current"). "update"
 * stays in the same state, for what can change without moving: who has access,
 * the address, the listing. A page with a draft says so ("draft"), and its
 * "version" is the draft's, as that is what get_page and edit_blocks work on.
 */
export async function getTransitions(site, { path }) {
  const draft = await draftInfo(site, path);
  const [{ state, transitions }, forms, { version, lockedBy }] = await Promise.all([
    site.state(path), site.stateForms(path), site.status(draft?.path ?? path),
  ]);
  const update = forms.update ? [{ id: 'update', label: `Update — stays ${state.label}` }] : [];
  return {
    path,
    version,
    ...(lockedBy && { lockedBy }),
    state,
    ...(draft && { draft: draftForAgent(draft) }),
    transitions: [...transitions, ...update].map(({ relocates: _relocates, ...t }) => ({
      ...t,
      takes: forms[t.id].schema.properties,
      current: forms[t.id].data,
    })),
  };
}

/**
 * Take a transition offered by getTransitions. Returns the page's path and state,
 * and its draft if it has one. Making a draft leaves the page where it is: it is
 * the same page, now with a draft, so only a move changes the path.
 */
export async function transitionPage(site, { path, id, data, expectedVersion }) {
  await checkVersion(site, await site.draftOf(path) ?? path, expectedVersion);
  const moved = await site.transition({ path, id, data });
  const now = id === 'checkout' ? path : moved?.redirect ?? path;
  const [page, draft] = await Promise.all([site.get(now), draftInfo(site, now)]);
  return {
    path: now,
    reviewState: page.review_state,
    version: draft ? (await site.status(draft.path)).version : page.modified,
    ...(draft && { draft: draftForAgent(draft) }),
  };
}

/**
 * find_undeclared_fields: the fields stored on the blocks of a section's pages
 * that no block schema declares (inka#673). Nothing reads such a field and the
 * editor cannot show it: a style written beside `styles` instead of in it, or a
 * misspelt name. The save check refuses new ones; these were there before it.
 *
 * Read with the validator's own pass (checkBlockSchemas) and the site's block
 * schemas, as the editor open on `path` has them. One entry per block type and
 * field, with the pages holding it and where it belongs when the block has a
 * field of that name inside an object of fields. A page of pages at a time:
 * `next` is where to start the next.
 */
export async function findUndeclaredFields(agent, site, { path = '/', limit = 25, start = 0 }) {
  const { types } = await agent.getBlockSchemas();
  const found = await site.search({ path, limit, start });
  const pages = [];
  for (const { path: at } of found.items) pages.push({ rel: at, data: { ...(await site.get(at)), '@id': at } });
  const { findings } = checkBlockSchemas(pages, fieldMapFromSchemas(types), { idFieldMap: idFieldMapFor(types) });
  const fields = new Map();
  for (const { rel, blockType, field } of findings) {
    const key = `${blockType}.${field}`;
    if (!fields.has(key)) {
      const belongsIn = whereItBelongs(types, blockType, field);
      fields.set(key, { block: blockType, field, ...(belongsIn.length && { belongsIn }), pages: [] });
    }
    fields.get(key).pages.push(rel);
  }
  const checked = found.items.length;
  return {
    fields: [...fields.keys()].sort().map((key) => ({ ...fields.get(key), pages: [...fields.get(key).pages].sort() })),
    checked,
    total: found.total,
    ...(start + checked < found.total && { next: start + checked }),
  };
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
