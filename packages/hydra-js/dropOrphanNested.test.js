import { expandTemplatesSync } from '@volto-hydra/helpers';

/**
 * A well-formed template stores templateId (and slotId) on EVERY block, including
 * nested ones. A nested block with no templateId is malformed — it doesn't belong
 * to the template — so the merge must DROP it, not invent a templateId for it
 * (which is what `child.templateId || parentTemplateId` used to do, papering over
 * malformed fixtures).
 */
describe('expandTemplatesSync — a template sub-block without templateId is dropped', () => {
  const template = {
    '@id': '/t/drop',
    blocks: {
      cols: {
        '@type': 'columns', fixed: true, readOnly: true, templateId: '/t/drop', slotId: 'cols',
        blocks: {
          good: {
            '@type': 'slate', fixed: true, readOnly: true,
            templateId: '/t/drop', slotId: 'good', value: [{ text: 'G' }],
          },
          orphan: {
            // NO templateId — malformed, must be dropped
            '@type': 'slate', fixed: true, readOnly: true,
            slotId: 'orphan', value: [{ text: 'O' }],
          },
        },
        blocks_layout: { items: ['good', 'orphan'] },
      },
    },
    blocks_layout: { items: ['cols'] },
  };

  test('the orphan (no templateId) is dropped from the emitted nested blocks + layout', () => {
    const out = expandTemplatesSync([], {
      blocks: {},
      templates: { '/t/drop': template },
      templateState: {},
      allowedLayouts: ['/t/drop'],
    });
    const cols = out.find((b) => b['@type'] === 'columns');
    expect(cols).toBeDefined();
    // Nested ids are minted from the instance, so assert structurally:
    // exactly one child survives, it's the good one (kept, not invented), orphan gone.
    expect(cols.blocks_layout.items).toHaveLength(1);
    const kept = cols.blocks[cols.blocks_layout.items[0]];
    expect(kept.slotId).toBe('good');
    expect(kept.templateId).toBe('/t/drop'); // kept, not invented
    expect(Object.values(cols.blocks).some((b) => b.slotId === 'orphan')).toBe(false); // dropped
  });
});
