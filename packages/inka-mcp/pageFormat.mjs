/**
 * The page format an agent reads and writes, and its conversion to and from
 * the editor's stored page.
 *
 * Stored (what the editor and the CMS hold): `blocks` dicts keyed by uid, order
 * in `blocks_layout`, rich text as Slate.
 *
 * Agent (what the MCP shows and accepts): a JSON list of blocks in order, each
 * with its `@uid`, children as nested lists, rich text as markdown. A block's
 * child list is named after its region: `blocks` for the usual `items` region,
 * the region's own name otherwise (columns' `columns`). Rich text is
 * `{"md": "…"}`; coming in, a field the schema marks as rich text (widget slate)
 * may also be a plain markdown string. Derived fields (a slate block's
 * `plaintext`) are left out going out and recomputed coming in.
 *
 * This is the format agents got right most often in the format experiment, and
 * the one the edit_blocks operations address blocks in.
 */
import { slateToMd, mdToSlate, plaintextOf } from '../../lib/slate-md.mjs';

/** A Slate value: an array of element nodes with `children`. */
const isSlate = (v) => Array.isArray(v) && v.length > 0
  && v.every((n) => n && typeof n === 'object' && typeof n.type === 'string' && Array.isArray(n.children));

export const isMd = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === 1 && typeof v.md === 'string';

/** An object holding child blocks in stored shape: a `blocks` dict plus ordered `blocks_layout` lists. */
const holdsBlocks = (o) => !!o && typeof o === 'object' && !Array.isArray(o)
  && o.blocks && typeof o.blocks === 'object' && !Array.isArray(o.blocks)
  && o.blocks_layout && typeof o.blocks_layout === 'object'
  && Object.values(o.blocks_layout).length > 0 && Object.values(o.blocks_layout).every(Array.isArray);

/** The agent name of a layout list: `items` is `blocks`; a named region keeps its name. */
const listName = (layoutKey) => (layoutKey === 'items' ? 'blocks' : layoutKey);

const mapObj = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v, k)]));

/**
 * The schema facts the conversion needs, from the blocks config the frontends
 * registered: which fields hold child blocks, and which are rich text.
 */
export function schemaFacts(blocksConfig) {
  const props = (type) => blocksConfig?.[type]?.blockSchema?.properties ?? {};
  return {
    isRegion: (type, field) => field === 'blocks' || props(type)[field]?.widget === 'blocks_layout',
    isRich: (type, field) => props(type)[field]?.widget === 'slate',
  };
}

// --------------------------------------------------------------- stored → agent

/** The page's blocks, in the agent format. */
export function toAgentBlocks(page) {
  return layoutList(page, 'items');
}

function layoutList(container, key) {
  return container.blocks_layout[key].map((uid) => {
    const block = container.blocks[uid];
    if (!block) throw new Error(`blocks_layout names ${uid}, which is not in blocks`);
    const out = { '@uid': uid, ...simplify(block) };
    if (isSlate(block.value)) delete out.plaintext;
    return out;
  });
}

function simplify(v) {
  if (isSlate(v)) return { md: slateToMd(v) };
  if (Array.isArray(v)) return v.map(simplify);
  if (v && typeof v === 'object') {
    if (holdsBlocks(v)) {
      const { blocks, blocks_layout, ...rest } = v;
      const out = mapObj(rest, simplify);
      for (const key of Object.keys(blocks_layout)) out[listName(key)] = layoutList(v, key);
      return out;
    }
    return mapObj(v, simplify);
  }
  return v;
}

// --------------------------------------------------------------- agent → stored

/**
 * Agent blocks back to stored shape. A block's `@uid` becomes its id; one
 * without gets `mintId()`. Returns `{ blocks, blocks_layout }` for a page.
 */
export function toStoredBlocks(agentBlocks, { blocksConfig, mintId }) {
  const { blocks, items } = restoreList(agentBlocks, schemaFacts(blocksConfig), mintId);
  return { blocks, blocks_layout: { items } };
}

/** One agent block back to stored shape (for an insert or an update). */
export function toStoredBlock(agentBlock, { blocksConfig, mintId }) {
  return restoreBlock(agentBlock, schemaFacts(blocksConfig), mintId);
}

function restoreList(list, facts, mintId) {
  if (!Array.isArray(list)) throw new Error('a block list must be an array');
  const blocks = {};
  const items = [];
  for (const b of list) {
    const block = restoreBlock(b, facts, mintId);
    const uid = b['@uid'] ?? mintId();
    blocks[uid] = block;
    items.push(uid);
  }
  return { blocks, items };
}

function restoreBlock(b, facts, mintId) {
  if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b['@type'] !== 'string') {
    throw new Error(`not a block (needs "@type"): ${JSON.stringify(b)?.slice(0, 120)}`);
  }
  const { '@uid': _uid, ...fields } = b;
  const out = restoreFields(fields, b['@type'], facts, mintId);
  if (isSlate(out.value)) out.plaintext = plaintextOf(out.value);
  return out;
}

function restoreFields(obj, type, facts, mintId) {
  const out = {};
  const blocks = {};
  const layout = {};
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v) && type && facts.isRegion(type, k)) {
      const r = restoreList(v, facts, mintId);
      Object.assign(blocks, r.blocks);
      layout[k === 'blocks' ? 'items' : k] = r.items;
    } else if (type && facts.isRich(type, k) && typeof v === 'string') {
      out[k] = mdToSlate(v);
    } else {
      out[k] = restoreValue(v, facts, mintId);
    }
  }
  if (Object.keys(layout).length) {
    out.blocks = blocks;
    out.blocks_layout = layout;
  }
  return out;
}

function restoreValue(v, facts, mintId, inList = false) {
  if (isMd(v)) return mdToSlate(v.md);
  if (Array.isArray(v)) return v.map((x) => restoreValue(x, facts, mintId, true));
  if (v && typeof v === 'object') {
    // An item holding blocks (an accordion panel): its own `blocks` list.
    const out = restoreFields(v, v['@type'] ?? null, {
      ...facts,
      isRegion: (t, f) => f === 'blocks' || (t ? facts.isRegion(t, f) : false),
    }, mintId);
    // A new list item that holds blocks needs the id the editor addresses it by.
    if (inList && Array.isArray(v.blocks) && !('@id' in out)) out['@id'] = mintId();
    return out;
  }
  return v;
}
