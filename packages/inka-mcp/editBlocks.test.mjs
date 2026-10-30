/**
 * edit_blocks turns an agent's operations into agent API calls. A fake agent
 * stands in for the headless admin: a flat page of blocks it inserts into,
 * updates, moves and deletes, minting ids the way the editor does.
 */
import { describe, it, expect } from 'vitest';
import { sharedBlocksConfig } from '../../tests-playwright/fixtures/shared-block-schemas.js';
import { editBlocks, EditError } from './editBlocks.mjs';
import { slateToMd } from '../../lib/slate-md.mjs';

/** A page as an ordered list of [id, block]; containers not modelled. */
function fakeAgent(initial) {
  let n = 0;
  const page = [...initial];
  const at = (id) => {
    const i = page.findIndex(([pid]) => pid === id);
    if (i < 0) throw new Error(`no block "${id}" on this page`);
    return i;
  };
  const calls = [];
  return {
    calls,
    order: () => page.map(([id]) => id),
    block: (id) => page[at(id)][1],
    async getPage() {
      return { blockPathMap: Object.fromEntries(page.map(([id, b]) => [id, { blockType: b['@type'] }])) };
    },
    async insert({ refId, action, field, block }) {
      calls.push(['insert', refId, action, field ?? null, block['@type']]);
      const id = `real-${++n}`;
      const i = at(refId);
      page.splice(action === 'before' ? i : i + 1, 0, [id, { '@type': block['@type'] }]);
      // The agent API then sets the block's other fields.
      Object.assign(page[at(id)][1], block);
      return id;
    },
    async update({ id, fields }) { calls.push(['update', id]); Object.assign(page[at(id)][1], fields); },
    async remove(id) { calls.push(['remove', id]); page.splice(at(id), 1); },
    async move({ id, targetId, insertAfter }) {
      calls.push(['move', id, targetId, insertAfter]);
      const [entry] = page.splice(at(id), 1);
      const t = at(targetId);
      page.splice(insertAfter ? t + 1 : t, 0, entry);
    },
  };
}

const opts = { blocksConfig: sharedBlocksConfig, mintId: () => 'minted' };
const page = () => fakeAgent([
  ['title', { '@type': 'title' }],
  ['p1', { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'One' }] }] }],
  ['p2', { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Two' }] }] }],
]);

describe('edit_blocks', () => {
  it('adds a list of blocks in the order given', async () => {
    const agent = page();
    await editBlocks(agent, [{
      op: 'add', after: 'title',
      blocks: [{ '@type': 'slate', value: { md: 'First' } }, { '@type': 'slate', value: { md: 'Second' } }],
    }], opts);
    // Not reversed: the second goes after the first, not after the title.
    expect(agent.order()).toEqual(['title', 'real-1', 'real-2', 'p1', 'p2']);
    expect(agent.block('real-1').plaintext).toBe('First');
  });

  it('lets a later operation refer to a new block by its own @uid', async () => {
    const agent = page();
    const { ids } = await editBlocks(agent, [
      { op: 'add', after: 'p2', blocks: [{ '@uid': 'mine', '@type': 'slate', value: 'Mine' }] },
      { op: 'move', id: 'mine', before: 'p1' },
    ], opts);
    expect(ids).toEqual({ mine: 'real-1' });
    expect(agent.order()).toEqual(['title', 'real-1', 'p1', 'p2']);
  });

  it('updates fields, taking markdown for rich text', async () => {
    const agent = page();
    await editBlocks(agent, [{ op: 'update', id: 'p1', set: { value: 'Now **bold**' } }], opts);
    expect(agent.block('p1').plaintext).toBe('Now bold');
    expect(slateToMd(agent.block('p1').value)).toBe('Now **bold**');
  });

  it('moves and deletes', async () => {
    const agent = page();
    await editBlocks(agent, [
      { op: 'move', id: 'p2', before: 'p1' },
      { op: 'delete', id: 'p1' },
    ], opts);
    expect(agent.order()).toEqual(['title', 'p2']);
  });

  it('adds into a container region, the usual one named "blocks"', async () => {
    const agent = page();
    await editBlocks(agent, [{ op: 'add', into: { id: 'p1' }, blocks: [{ '@type': 'slate', value: 'x' }, { '@type': 'slate', value: 'y' }] }], opts);
    expect(agent.calls.filter(([c]) => c === 'insert').map((c) => c.slice(1, 4))).toEqual([
      ['p1', 'inside', 'items'],
      ['real-1', 'after', null],
    ]);
  });

  it('names the operation that failed, and why', async () => {
    const agent = page();
    await expect(editBlocks(agent, [
      { op: 'delete', id: 'p1' },
      { op: 'move', id: 'nope', after: 'p2' },
    ], opts)).rejects.toThrow(/operation 2 \(move\): no block "nope"/);
    await expect(editBlocks(page(), [{ op: 'add', after: 'p1', before: 'p2', blocks: [{ '@type': 'slate' }] }], opts))
      .rejects.toThrow(/operation 1 \(add\): needs exactly one of/);
    await expect(editBlocks(page(), [{ op: 'rename', id: 'p1' }], opts))
      .rejects.toThrow(EditError);
  });
});
