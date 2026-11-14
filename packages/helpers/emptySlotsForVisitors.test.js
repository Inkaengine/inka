/**
 * A template keeps its empty slots as `empty` blocks (inka#708): the editor
 * shows each one as a place to add to. A visitor's page never has one: the
 * merge a frontend runs leaves a template's `empty` slot out, so no frontend
 * draws editing furniture (a ghost outline, a '+') for visitors. The admin's
 * merge (mergeTemplatesIntoPage) keeps them, for editing and for committing.
 */
import { describe, test, expect } from 'vitest';
import { expandTemplatesSync } from './index.js';
import { mergeTemplatesIntoPage } from './mergeTemplates.js';

const T = '/templates/band';
const template = {
  '@id': T,
  blocks: {
    head: { '@type': 'slate', templateId: T, slotId: 'head', fixed: true, readOnly: true, plaintext: 'Heading' },
    links: { '@type': 'empty', templateId: T, slotId: 'links', fixed: false },
  },
  blocks_layout: { items: ['head', 'links'] },
};
const page = {
  blocks: { mine: { '@type': 'slate', templateId: T, slotId: 'head', fixed: true, readOnly: true } },
  blocks_layout: { items: ['mine'] },
};

describe("a template's empty slot", () => {
  test('a visitor gets none: the frontend merge leaves it out', () => {
    const out = expandTemplatesSync(page.blocks_layout.items, {
      blocks: page.blocks,
      templates: { [T]: template },
      templateState: {},
      editMode: false,
    });
    expect(out.map((b) => b['@type'])).toEqual(['slate']);
  });

  test('the editor gets it, as the slot to add to', async () => {
    const { merged } = await mergeTemplatesIntoPage(page, {
      loadTemplate: async () => template,
      uuidGenerator: (() => { let n = 0; return () => `u${++n}`; })(),
    });
    const types = merged.blocks_layout.items.map((id) => [merged.blocks[id]['@type'], merged.blocks[id].slotId]);
    expect(types).toEqual([['slate', 'head'], ['empty', 'links']]);
  });
});
