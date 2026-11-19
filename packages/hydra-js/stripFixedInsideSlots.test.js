import { describe, test, expect } from 'vitest';
import { stripFixedInsideSlots } from '@volto-hydra/helpers';

/**
 * fixed-XOR-inside-slot: a slot is a per-page user region, so any block inside a slot can
 * only be a slot — never fixed or readOnly. This is the on-save enforcement that catches
 * malformed data from paths that bypass the sidebar dropdown.
 */
describe('stripFixedInsideSlots — enforce fixed-XOR-inside-slot', () => {
  test('a fixed/readOnly block inside a slot is normalized to a plain slot block', () => {
    const form = {
      blocks: {
        // a SLOT: a template block that is neither fixed nor readOnly
        slot1: {
          templateInstanceId: 'i',
          slotId: 'slot1',
          blocks: {
            child: { '@type': 'slate', fixed: true, readOnly: true, templateInstanceId: 'i', slotId: 'child' },
          },
          blocks_layout: { items: ['child'] },
        },
        // a FIXED container: its children may legitimately stay fixed
        fixedbox: {
          fixed: true,
          templateInstanceId: 'i',
          slotId: 'fixedbox',
          blocks: {
            fchild: { '@type': 'slate', fixed: true, readOnly: true, templateInstanceId: 'i', slotId: 'fchild' },
          },
          blocks_layout: { items: ['fchild'] },
        },
      },
      blocks_layout: { items: ['slot1', 'fixedbox'] },
    };
    const out = stripFixedInsideSlots(form);
    // inside a slot → stripped to a plain slot
    expect(out.blocks.slot1.blocks.child.fixed).toBe(false);
    expect(out.blocks.slot1.blocks.child.readOnly).toBe(false);
    // inside a fixed container → NOT stripped
    expect(out.blocks.fixedbox.blocks.fchild.fixed).toBe(true);
    expect(out.blocks.fixedbox.blocks.fchild.readOnly).toBe(true);
    // the containers themselves are unchanged
    expect(out.blocks.slot1.fixed).toBeFalsy();
    expect(out.blocks.fixedbox.fixed).toBe(true);
  });

  test('nested: a slot inside a fixed container strips its own descendants', () => {
    const form = {
      blocks: {
        fixedbox: {
          fixed: true,
          templateInstanceId: 'i',
          slotId: 'fixedbox',
          blocks: {
            slot: {
              templateInstanceId: 'i',
              slotId: 'slot',
              blocks: { deep: { '@type': 'slate', fixed: true, templateInstanceId: 'i', slotId: 'deep' } },
              blocks_layout: { items: ['deep'] },
            },
          },
          blocks_layout: { items: ['slot'] },
        },
      },
      blocks_layout: { items: ['fixedbox'] },
    };
    const out = stripFixedInsideSlots(form);
    expect(out.blocks.fixedbox.blocks.slot.blocks.deep.fixed).toBe(false); // inside the slot
    expect(out.blocks.fixedbox.fixed).toBe(true); // fixed container stays fixed
    expect(out.blocks.fixedbox.blocks.slot.fixed).toBeFalsy(); // the slot stays a slot
  });

  test('no-op (same reference) when nothing is inside a slot', () => {
    const form = {
      blocks: { a: { fixed: true, templateInstanceId: 'i', slotId: 'a' } },
      blocks_layout: { items: ['a'] },
    };
    expect(stripFixedInsideSlots(form)).toBe(form);
  });
});
