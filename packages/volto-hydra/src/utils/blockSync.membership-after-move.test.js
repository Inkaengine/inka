/**
 * Where a moved block belongs afterwards.
 *
 * There were two moves and only one of them asked. MOVE_BLOCKS (drag and drop)
 * re-derived membership from the block's new neighbours; the chooser's ask-first
 * drop — convert and move in one update — moved the block and never recomputed,
 * so a block dropped into a template region through that path kept its source
 * membership, or none, and the region it landed in did not own it. One
 * implementation now, and these pin what it owes both callers.
 */
import { describe, test, expect, vi } from 'vitest';

// HydraSchemaContext.js is JSX inside a .js file — esbuild (vitest) can't parse
// it, and nothing here touches the live schema context. Same stub the pathmap
// tests use.
vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
}));

import { buildBlockPathMap } from './blockPath.js';
import { applyMembershipAfterMove } from './blockSync.js';

const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
const blocksConfig = {
  _page: {
    id: '_page',
    schema: () => ({
      properties: { items: { widget: 'blocks_layout', allowedBlocks: ['slate'] } },
    }),
  },
  slate: { id: 'slate' },
};

// A page whose middle block belongs to a template instance, with `moved` sitting
// wherever the test puts it.
const pageWith = (items, moved) => ({
  '@type': 'Document',
  blocks: {
    top: { '@type': 'slate' },
    'tpl-a': { '@type': 'slate', templateId: 't', templateInstanceId: 'i1', slotId: 'body' },
    'tpl-b': { '@type': 'slate', templateId: 't', templateInstanceId: 'i1', slotId: 'body' },
    bottom: { '@type': 'slate' },
    moved,
  },
  blocks_layout: { items },
});

const run = (formData, options = {}) => {
  const map = buildBlockPathMap(formData, blocksConfig, intl);
  return applyMembershipAfterMove(formData, map, 'moved', {
    blocksConfig,
    intl,
    ...options,
  });
};

describe('a moved block takes the membership of where it lands', () => {
  test('landing between two members of an instance joins it', () => {
    const before = pageWith(['top', 'tpl-a', 'moved', 'tpl-b', 'bottom'], {
      '@type': 'slate',
    });
    const after = run(before);
    expect(after.blocks.moved.templateInstanceId).toBe('i1');
    expect(after.blocks.moved.slotId).toBe('body');
  });

  test('landing outside the instance sheds the membership it arrived with', () => {
    // Dragged OUT of the template: it must stop being template content, or it
    // would be saved back into the template from a page it no longer sits in.
    //
    // "Outside" means no template member ADJACENT to it — membership is derived
    // from the neighbours either side, so a block dropped immediately before a
    // member is still at the template's edge and joins it (the next test).
    const before = pageWith(['moved', 'top', 'tpl-a', 'tpl-b', 'bottom'], {
      '@type': 'slate',
      templateId: 't',
      templateInstanceId: 'i1',
      slotId: 'body',
    });
    const after = run(before);
    expect(after.blocks.moved.templateInstanceId).toBeUndefined();
    expect(after.blocks.moved.slotId).toBeUndefined();
  });

  test('a FIXED member keeps its identity wherever it is dragged', () => {
    // fixed IS the template: a fixed member dragged within it stays itself.
    const before = pageWith(['top', 'moved', 'tpl-a', 'tpl-b', 'bottom'], {
      '@type': 'slate',
      templateId: 't',
      templateInstanceId: 'i1',
      slotId: 'body',
      fixed: true,
    });
    const after = run(before);
    expect(after.blocks.moved.templateInstanceId).toBe('i1');
    expect(after.blocks.moved.fixed).toBe(true);
  });

  test('in template edit mode a move INSIDE the template keeps the slot', () => {
    // The author renames slots explicitly; dragging within the template is not
    // how you change one.
    const before = pageWith(['top', 'tpl-a', 'moved', 'tpl-b', 'bottom'], {
      '@type': 'slate',
      templateId: 't',
      templateInstanceId: 'i1',
      slotId: 'aside',
    });
    const after = run(before, { templateEditMode: ['i1'] });
    expect(after.blocks.moved.slotId).toBe('aside');
    expect(after.blocks.moved.templateInstanceId).toBe('i1');
  });

  test('landing at the template\'s edge joins it — the neighbour decides', () => {
    // Immediately before a member: adjacent is inside. This is what makes
    // "add a block after this one" keep working inside a template.
    const before = pageWith(['top', 'moved', 'tpl-a', 'tpl-b', 'bottom'], {
      '@type': 'slate',
    });
    expect(run(before).blocks.moved.templateInstanceId).toBe('i1');
  });

  test('in template edit mode a move OUT of the template still sheds it', () => {
    const before = pageWith(['moved', 'top', 'tpl-a', 'tpl-b', 'bottom'], {
      '@type': 'slate',
      templateId: 't',
      templateInstanceId: 'i1',
      slotId: 'body',
    });
    const after = run(before, { templateEditMode: ['i1'] });
    expect(after.blocks.moved.templateInstanceId).toBeUndefined();
  });

  test('a block that neither arrives nor lands in a template gains nothing', () => {
    const before = pageWith(['top', 'moved', 'bottom', 'tpl-a', 'tpl-b'], {
      '@type': 'slate',
    });
    const moved = run(before).blocks.moved;
    expect(moved.templateInstanceId).toBeUndefined();
    expect(moved.templateId).toBeUndefined();
    expect(moved.slotId).toBeUndefined();
  });
});
