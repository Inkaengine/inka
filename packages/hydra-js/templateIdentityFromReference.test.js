import { expandTemplatesSync } from '@volto-hydra/helpers';

/**
 * A template's identity is the id it was referenced by, never data stored inside it.
 *
 * A definition need not name itself (its blocks carry slotId / fixed / readOnly, no
 * templateId): where it lives already says what it is. And a definition that does name
 * itself may name an address it no longer has — moved, renamed, or served under a
 * mount prefix. Either way, applied to a page it must behave exactly as a definition
 * labelled with the very id the page used.
 */

const page = (templateId) => ({
  blocks: {
    fill: { '@type': 'slate', templateId, slotId: 'main', fixed: false, readOnly: false, value: [{ text: 'Page' }] },
  },
  layout: ['fill'],
});

const definition = (label) => {
  const withLabel = (block) => (label === undefined ? block : { ...block, templateId: label });
  return {
    '@id': '/t/layout',
    blocks: {
      cols: withLabel({
        '@type': 'columns', fixed: true, readOnly: true, slotId: 'cols',
        blocks: {
          cell: withLabel({ '@type': 'slate', fixed: true, readOnly: true, slotId: 'cell', value: [{ text: 'Cell' }] }),
        },
        blocks_layout: { items: ['cell'] },
      }),
      main: withLabel({ '@type': 'slate', fixed: false, readOnly: false, slotId: 'main' }),
    },
    blocks_layout: { items: ['cols', 'main'] },
  };
};

function apply(templateId, template) {
  const { blocks, layout } = page(templateId);
  return expandTemplatesSync(layout, {
    blocks,
    templates: { [templateId]: template },
    templateState: {},
  });
}

function shape(items) {
  // What a renderer relies on: types, which template each block belongs to, and that
  // nested template content is stamped like the top level.
  return items.map((b) => ({
    type: b['@type'],
    templateId: b.templateId,
    instanced: Boolean(b.templateInstanceId),
    nested: Object.values(b.blocks || {}).map((c) => ({
      type: c['@type'], templateId: c.templateId, instanced: Boolean(c.templateInstanceId),
    })),
  }));
}

describe('a template is the id it was referenced by', () => {
  const labelled = shape(apply('/t/layout', definition('/t/layout')));

  test('the baseline: a definition labelled with the referenced id', () => {
    expect(labelled.map((b) => b.type)).toEqual(['columns', 'slate']);
    expect(labelled[0].nested).toEqual([{ type: 'slate', templateId: '/t/layout', instanced: true }]);
  });

  test('an unlabelled definition applies exactly like a labelled one', () => {
    expect(shape(apply('/t/layout', definition(undefined)))).toEqual(labelled);
  });

  test('a definition labelled with an address it no longer has applies under the referenced id', () => {
    // e.g. moved from /old/layout, or served under a mount prefix
    expect(shape(apply('/t/layout', definition('/old/layout')))).toEqual(labelled);
  });
});
