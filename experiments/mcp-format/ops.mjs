/**
 * The `edit_blocks` mode: the agent reads the page with a uid on every block
 * and returns operations instead of the whole page.
 *
 *   {"op": "update", "id": "b3", "set": {"field": value, …}}
 *   {"op": "add",    "after"|"before": "b3", "blocks": [{…}, …]}   // inserted in order
 *   (a single "block": {…} is accepted too; a new block may carry its own "@uid"
 *   so later operations can refer to it)
 *   {"op": "add",    "into": {"id": "b5", "field": "blocks"}, "block": {…}}   // appends
 *   {"op": "move",   "id": "b7", "after"|"before": "b2"}   (or "into")
 *   {"op": "delete", "id": "b7"}
 *
 * `into` a list field whose entries are items rather than blocks (accordion
 * panels) appends the given object as an item.
 */
import { isLayoutField } from './formats.mjs';

export class OpError extends Error {}

/** Pre-order uids on every block in a canonical page (a copy). */
export function withUids(blocks) {
  let n = 0;
  const tag = (list) => list.map((b) => {
    const out = { '@uid': `b${++n}`, ...b };
    for (const [k, v] of Object.entries(b)) {
      if (!Array.isArray(v)) continue;
      if (isLayoutField(b['@type'], k)) out[k] = tag(v);
      else out[k] = v.map((it) => (it && typeof it === 'object' && Array.isArray(it.blocks) ? { ...it, blocks: tag(it.blocks) } : it));
    }
    return out;
  });
  return tag(blocks);
}

export function stripUids(v) {
  if (Array.isArray(v)) return v.map(stripUids);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (k !== '@uid') out[k] = stripUids(x);
    return out;
  }
  return v;
}

/** Find the list holding block `id`, and its index there. */
function locate(list, id) {
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b?.['@uid'] === id) return { list, i, block: b };
    for (const [k, v] of Object.entries(b ?? {})) {
      if (!Array.isArray(v)) continue;
      const found = isLayoutField(b['@type'], k) ? locate(v, id)
        : v.reduce((acc, it) => acc ?? (Array.isArray(it?.blocks) ? locate(it.blocks, id) : null), null);
      if (found) return found;
    }
  }
  return null;
}

const need = (page, id, op) => {
  const at = locate(page, id);
  if (!at) throw new OpError(`${op}: no block with id "${id}"`);
  return at;
};

/** Where an add/move puts a block: [list, index]. */
function target(page, op) {
  if (op.after) { const at = need(page, op.after, op.op); return [at.list, at.i + 1]; }
  if (op.before) { const at = need(page, op.before, op.op); return [at.list, at.i]; }
  if (op.into) {
    const at = need(page, op.into.id, op.op);
    const field = op.into.field ?? 'blocks';
    at.block[field] ??= [];
    if (!Array.isArray(at.block[field])) throw new OpError(`${op.op}: field "${field}" of ${op.into.id} is not a list`);
    return [at.block[field], at.block[field].length];
  }
  throw new OpError(`${op.op}: needs "after", "before" or "into"`);
}

/** Apply ops to a uid-tagged canonical page (mutated). Rich text: {"md": …}. */
export function applyOps(page, ops, { richFields }) {
  if (!Array.isArray(ops)) throw new OpError('the reply must be a JSON array of operations');
  const toRich = (type, fields) => {
    const rich = richFields(type);
    return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, rich.has(k) && typeof v === 'string' ? { md: v } : v]));
  };
  const asBlock = (b) => {
    if (!b || typeof b !== 'object') throw new OpError('"block" must be an object');
    const out = b['@type'] ? toRich(b['@type'], b) : { ...b };
    for (const [k, v] of Object.entries(out)) {
      if (Array.isArray(v) && (isLayoutField(out['@type'], k))) out[k] = v.map(asBlock);
      else if (Array.isArray(v)) out[k] = v.map((it) => (it && typeof it === 'object' && Array.isArray(it.blocks) ? { ...it, blocks: it.blocks.map(asBlock) } : it));
    }
    return out;
  };
  for (const op of ops) {
    switch (op?.op) {
      case 'update': {
        const at = need(page, op.id, 'update');
        if (!op.set || typeof op.set !== 'object') throw new OpError('update: needs "set": {field: value}');
        Object.assign(at.block, asBlock({ '@type': at.block['@type'], ...op.set }), { '@uid': at.block['@uid'] });
        break;
      }
      case 'add': {
        const blocks = op.blocks ?? (op.block ? [op.block] : null);
        if (!Array.isArray(blocks) || !blocks.length) throw new OpError('add: needs "blocks": [ … ]');
        for (const b of blocks) {
          if (b?.['@uid'] && locate(page, b['@uid'])) throw new OpError(`add: id "${b['@uid']}" is already used`);
        }
        const [list, i] = target(page, op);
        list.splice(i, 0, ...blocks.map(asBlock));
        break;
      }
      case 'move': {
        const from = need(page, op.id, 'move');
        const [moved] = from.list.splice(from.i, 1);
        const [list, i] = target(page, op);
        list.splice(i, 0, moved);
        break;
      }
      case 'delete': {
        const at = need(page, op.id, 'delete');
        at.list.splice(at.i, 1);
        break;
      }
      default: throw new OpError(`unknown op ${JSON.stringify(op?.op)}`);
    }
  }
  return page;
}
