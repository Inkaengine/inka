/**
 * Repro: a forced layout whose template is EMPTY ("a layout with nothing in it")
 * — the NSW site announcement, empty by default.
 *
 * Merging an empty forced layout into an empty region must leave the region
 * empty (or hold a well-formed, typed block), never a dataless placeholder
 * (the admin logged "Block data undefined for <uid>").
 */
import { mergeTemplatesIntoPage } from '@volto-hydra/helpers/mergeTemplates.js';

const EMPTY_TEMPLATE = {
  '@id': '/templates/site-announcement',
  '@type': 'Document',
  blocks: {},
  blocks_layout: { items: [] },
};

describe('empty forced layout ("layout with nothing in it")', () => {
  test('merging an empty forced layout into an empty region does not mint a dataless placeholder', async () => {
    const page = {
      '@type': 'Document',
      blocks: { a: { '@type': 'slate' } },
      blocks_layout: { items: ['a'], announcement: [] },
    };

    const { merged } = await mergeTemplatesIntoPage(page, {
      loadTemplate: async () => EMPTY_TEMPLATE,
      pageBlocksFields: {
        announcement: { allowedLayouts: ['/templates/site-announcement'] },
      },
      uuidGenerator: () => 'seed-1',
    });

    const ann = merged.blocks_layout.announcement || [];
    // Merge leaves the empty region empty — the seeding step (tested in the
    // volto-hydra suite) fills it. What matters here: no dataless placeholder.
    for (const id of ann) {
      expect(merged.blocks[id], `region block ${id} must have data`).toBeTruthy();
      expect(
        merged.blocks[id]?.['@type'],
        `region block ${id} must have an @type`,
      ).toBeTruthy();
    }
  });
});
