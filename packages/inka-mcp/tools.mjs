/**
 * What the MCP tools do, given an agent on a page open in a headless admin.
 *
 * Stateless: each tool call works on the page as it is loaded for that call.
 * A dry run changes the open editor and reports the result without saving —
 * the caller discards it by reloading. A save is refused if the page has
 * changed since the agent read it (its version).
 */
import { toAgentBlocks } from './pageFormat.mjs';
import { editBlocks } from './editBlocks.mjs';
import { describeBlockTypes } from './blockTypes.mjs';

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
export async function search(agent, { text, types, path, limit, start }) {
  if (!text && !types) throw new Error('search needs "text" or "types"; to browse a section use list_children');
  return agent.search({ text, types, path, limit, start });
}

/** The pages directly inside `path`, in their order. */
export async function listChildren(agent, { path, limit, start }) {
  return agent.search({ path, depth: 1, limit, start });
}

/** The block types this page can hold, their fields, and where child blocks go. */
export async function listBlockTypes(agent) {
  return describeBlockTypes(await agent.getBlockSchemas());
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
