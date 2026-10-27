import { describe, test, expect } from 'vitest';
import { validateTemplatePlaceholders } from './formDataValidation';

/**
 * validateTemplatePlaceholders enforces the slot-grouping rules a template author must follow:
 *   1. blocks with the same slotId must be contiguous
 *   2. different slot groups must be separated by a fixed block
 *
 * It used to validate ONLY the page's `items` region (a single flat pass over
 * formData.blocks_layout.items), so a violation in ANOTHER page region (footer) or inside a
 * nested container (blocks_layout OR object_list) went unreported. It must walk every region of
 * the whole tree, region-aware.
 */
describe('validateTemplatePlaceholders — every region, every container (region-aware)', () => {
  const twoAdjacentSlots = { message: /separated by a fixed block/ };

  test('catches a slot-grouping violation in a NON-items page region (footer)', () => {
    const formData = {
      blocks: {
        'ok-1': { '@type': 'slate' },
        'slot-a': { '@type': 'slate', slotId: 'x' },
        'slot-b': { '@type': 'slate', slotId: 'y' },
      },
      // items is clean; the footer region has two slot groups with no fixed separator.
      blocks_layout: { items: ['ok-1'], footer: ['slot-a', 'slot-b'] },
    };
    const { valid, blocksErrors } = validateTemplatePlaceholders(formData);
    expect(valid).toBe(false);
    expect(blocksErrors['slot-b']?._layout?.message).toMatch(
      twoAdjacentSlots.message,
    );
  });

  test('catches a violation inside a NESTED blocks_layout container', () => {
    const formData = {
      blocks: {
        cols: {
          '@type': 'columns',
          blocks: {
            sa: { '@type': 'slate', slotId: 'x' },
            sb: { '@type': 'slate', slotId: 'y' },
          },
          blocks_layout: { items: ['sa', 'sb'] },
        },
      },
      blocks_layout: { items: ['cols'] },
    };
    const { valid, blocksErrors } = validateTemplatePlaceholders(formData);
    expect(valid).toBe(false);
    expect(blocksErrors['sb']?._layout?.message).toMatch(
      twoAdjacentSlots.message,
    );
  });

  test('catches a violation inside a NESTED object_list container (slider slides)', () => {
    const formData = {
      blocks: {
        sl: {
          '@type': 'slider',
          slides: [
            { '@id': 'sa', '@type': 'slate', templateId: '/t', slotId: 'x' },
            { '@id': 'sb', '@type': 'slate', templateId: '/t', slotId: 'y' },
          ],
        },
      },
      blocks_layout: { items: ['sl'] },
    };
    // An object_list is a region because the SCHEMA says so: the map names
    // the field and the key its items are addressed by. Without it this walk
    // skips object_lists — the templateId shortcut is the merge's alone now.
    const { valid, blocksErrors } = validateTemplatePlaceholders(formData, {
      slider: { slides: '@id' },
    });
    expect(valid).toBe(false);
    expect(blocksErrors['sb']?._layout?.message).toMatch(
      twoAdjacentSlots.message,
    );
  });

  // --- regression: the original page-items rules still hold ---

  test('still flags two adjacent slot groups in the page items region', () => {
    const formData = {
      blocks: {
        'slot-a': { '@type': 'slate', slotId: 'x' },
        'slot-b': { '@type': 'slate', slotId: 'y' },
      },
      blocks_layout: { items: ['slot-a', 'slot-b'] },
    };
    const { valid } = validateTemplatePlaceholders(formData);
    expect(valid).toBe(false);
  });

  test('valid when slot groups are separated by a fixed block, across regions', () => {
    const formData = {
      blocks: {
        'f-1': { '@type': 'slate', fixed: true, slotId: 'top' },
        'sx-1': { '@type': 'slate', slotId: 'x' },
        'sx-2': { '@type': 'slate', slotId: 'x' },
        'f-2': { '@type': 'slate', fixed: true, slotId: 'mid' },
        'sy-1': { '@type': 'slate', slotId: 'y' },
        foot: { '@type': 'slate', fixed: true, slotId: 'footer' },
      },
      blocks_layout: {
        items: ['f-1', 'sx-1', 'sx-2', 'f-2', 'sy-1'],
        footer: ['foot'],
      },
    };
    const { valid, blocksErrors } = validateTemplatePlaceholders(formData);
    expect(valid).toBe(true);
    expect(Object.keys(blocksErrors)).toHaveLength(0);
  });
});
