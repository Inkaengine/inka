/**
 * What the MCP tools do, given an agent on a page open in a headless admin.
 *
 * Stateless: each tool call works on the page as it is loaded for that call.
 * A dry run changes the open editor and reports the result without saving —
 * the caller discards it by reloading. A save is refused if the page has
 * changed since the agent read it (its version).
 */
import { toAgentBlocks, toAgentBlock } from './pageFormat.mjs';
import { editBlocks } from './editBlocks.mjs';
import { describeBlockTypes, describeBlockType } from './blockTypes.mjs';

export class StaleVersion extends Error {}

/** The page in the agent format, with the version a later save is checked against. */
export async function getPage(agent) {
  const { path, version, formData } = await agent.getPage();
  return { path, version, title: formData.title, blocks: toAgentBlocks(formData) };
}

/**
 * A page just created (open in its editor), given its first blocks: they go
 * after the blocks the page starts with (its title), and the page is saved.
 * Returns { path, version, ids } — ids maps each new block's own @uid.
 */
export async function fillNewPage(agent, { blocks, mintId }) {
  const created = await getPage(agent);
  if (!blocks?.length) return { path: created.path, version: created.version, ids: {} };
  const last = created.blocks.at(-1)['@uid'];
  const { version, ids } = await editPage(agent, {
    ops: [{ op: 'add', after: last, blocks }], expectedVersion: created.version, mintId,
  });
  return { path: created.path, version, ids };
}

/**
 * Find pages: by text, narrowed by content type and to a section (`path`).
 * Returns { total, items: [{ path, title, type, description, reviewState }] }.
 */
export async function search(site, { text, types, path, limit, start }) {
  if (!text && !types) throw new Error('search needs "text" or "types"; to browse a section use list_children');
  return site.search({ text, types, path, limit, start });
}

/** The pages directly inside `path`, in their order. */
export async function listChildren(site, { path, limit, start }) {
  return site.search({ path, depth: 1, limit, start });
}

/** Refuse to act on a page that has changed since the agent read it. */
async function checkVersion(site, path, expectedVersion) {
  if (!expectedVersion) throw new Error('this needs the expectedVersion get_page returned');
  const now = await site.version(path);
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
 * A type no page uses yet has no example, and says so.
 */
export async function describeBlock(agent, site, { type }) {
  const described = describeBlockType(await agent.getBlockSchemas(), type);
  const pages = await site.search({ blockTypes: [type], limit: 5 });
  for (const { path } of pages.items) {
    const found = findBlock(await site.get(path), type);
    if (found) return { ...described, example: { from: path, block: toAgentBlock(...found) } };
  }
  return { ...described, example: null, exampleNote: `no page on the site uses a ${type} block yet` };
}

/**
 * Apply `ops` (see editBlocks.mjs). With `dryRun`, return the resulting page
 * without saving; otherwise save and return the new version. `expectedVersion`
 * is the version the agent read. With a dry run, `render(draft)` (if given)
 * renders the draft as a visitor would see it, and its result is `rendered`.
 */
export async function editPage(agent, { ops, expectedVersion, dryRun = false, mintId, render }) {
  if (render && !dryRun) throw new Error('a preview is for a dry run: add dryRun');
  if (!expectedVersion) throw new Error('edit_blocks needs the expectedVersion get_page returned');
  const loaded = (await agent.getPage()).version;
  if (loaded !== expectedVersion) {
    throw new StaleVersion(
      `the page has changed since it was read (read at ${expectedVersion}, now ${loaded}). Read it again and reapply.`,
    );
  }
  const blocksConfig = (await agent.getBlockSchemas()).types;
  const { results, ids } = await editBlocks(agent, ops, { blocksConfig, mintId });
  if (dryRun) {
    const dry = { dryRun: true, results, ids, page: await getPage(agent) };
    if (render) dry.rendered = await render(await agent.getDraft());
    return dry;
  }
  const { version } = await agent.save({ expectedVersion });
  return { results, ids, version };
}
