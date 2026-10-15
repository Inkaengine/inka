/**
 * edit_blocks: an agent's operations on one page, applied through the agent
 * API (window.__inkaAgent in a headless admin), so each runs through the
 * editor's own handlers.
 *
 * Operations, in the agent page format (see pageFormat.mjs):
 *
 *   {"op": "update", "id": "b3", "set": {"field": value}}
 *   {"op": "add", "after": "b3", "blocks": [{…}, …]}            // or "before"
 *   {"op": "add", "into": {"id": "b5", "field": "blocks"}, "blocks": [{…}]}
 *   {"op": "move", "id": "b7", "after": "b2"}                  // or "before"
 *   {"op": "delete", "id": "b7"}
 *
 * `add` inserts its blocks in the order given — the first at the position
 * named, each next one after the previous — so a list can't come out reversed.
 * A new block may carry its own "@uid" so a later operation can refer to it;
 * the editor mints the real id, and this maps one to the other for the rest of
 * the call.
 *
 * `agent` is anything with the agent API's methods: getPage, insert, update,
 * remove, move (each resolving once the editor has taken the change). A failing
 * operation throws an EditError naming it, so the agent knows what to fix.
 */
import { toStoredBlock } from './pageFormat.mjs';

export class EditError extends Error {}

const ACTIONS = ['after', 'before'];

/** Where an op points: { action, refId } from its after/before/into. */
function position(op, real) {
  const named = ACTIONS.filter((a) => op[a] !== undefined);
  if (op.into !== undefined) named.push('into');
  if (named.length !== 1) throw new EditError('needs exactly one of "after", "before" or "into"');
  if (named[0] === 'into') {
    const { id, field = 'blocks' } = op.into ?? {};
    if (!id) throw new EditError('"into" needs an "id"');
    // The agent format calls the usual `items` region `blocks`.
    return { action: 'inside', refId: real(id), field: field === 'blocks' ? 'items' : field };
  }
  return { action: named[0], refId: real(op[named[0]]) };
}

export async function editBlocks(agent, ops, { blocksConfig, mintId }) {
  if (!Array.isArray(ops)) throw new EditError('the operations must be a JSON array');
  const realIds = new Map(); // an agent's "@uid" for a new block → the editor's id
  const real = (id) => {
    if (typeof id !== 'string' || !id) throw new EditError(`not a block id: ${JSON.stringify(id)}`);
    return realIds.get(id) ?? id;
  };
  const stored = (block) => toStoredBlock(block, { blocksConfig, mintId });
  const results = [];

  for (const [i, op] of ops.entries()) {
    const fail = (e) => {
      throw new EditError(`operation ${i + 1} (${op?.op ?? 'no op'}): ${e.message}`);
    };
    try {
      switch (op?.op) {
        case 'update': {
          if (!op.set || typeof op.set !== 'object' || Array.isArray(op.set)) {
            throw new EditError('"update" needs "set": {field: value}');
          }
          const id = real(op.id);
          const type = (await agent.getPage()).blockPathMap?.[id]?.blockType;
          if (!type) throw new EditError(`no block "${op.id}" on this page`);
          const { '@type': _t, ...fields } = stored({ '@type': type, ...op.set });
          await agent.update({ id, fields });
          results.push({ op: 'update', id });
          break;
        }
        case 'add': {
          const blocks = op.blocks ?? (op.block ? [op.block] : null);
          if (!Array.isArray(blocks) || !blocks.length) throw new EditError('"add" needs "blocks": [ … ]');
          let { action, refId, field } = position(op, real);
          const added = [];
          for (const block of blocks) {
            if (block?.['@uid'] && realIds.has(block['@uid'])) {
              throw new EditError(`"@uid" ${block['@uid']} is already used in this call`);
            }
            const id = await agent.insert({ refId, action, field, block: stored(block) });
            if (block?.['@uid']) realIds.set(block['@uid'], id);
            added.push(id);
            // The next block goes after this one, so the list keeps its order.
            action = 'after';
            refId = id;
            field = undefined;
          }
          results.push({ op: 'add', ids: added });
          break;
        }
        case 'move': {
          const { action, refId } = position(op, real);
          if (action === 'inside') throw new EditError('"move" takes "after" or "before" a block');
          await agent.move({ id: real(op.id), targetId: refId, insertAfter: action === 'after' });
          results.push({ op: 'move', id: real(op.id) });
          break;
        }
        case 'delete': {
          await agent.remove(real(op.id));
          results.push({ op: 'delete', id: real(op.id) });
          break;
        }
        default:
          throw new EditError(`unknown op ${JSON.stringify(op?.op)} (use update, add, move or delete)`);
      }
    } catch (e) {
      fail(e);
    }
  }
  return { results, ids: Object.fromEntries(realIds) };
}
