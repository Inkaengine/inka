import { describe, test, expect } from 'vitest';
import { expandTemplatesSync } from '@volto-hydra/helpers';

/**
 * The blocks_layout analogue of the object_list "cloned array re-entry" test — and the
 * unit-level guard for the nuxt `block.vue` stack overflow.
 *
 * A container is fully expanded + instance-stamped at apply time. The renderer then
 * re-enters the container's children by calling expand again on them — but across the
 * per-level boundary the blocks dict arrives as a Vue reactive PROXY / serialized copy,
 * a DIFFERENT object with the same data. The old object-reference `nestedContainers`
 * Map missed on that clone, so the template re-applied for every block carrying a
 * templateId → infinite recursion. Data-derived recognition (by the minted
 * templateInstanceId) survives the clone: the children are recognized as finished
 * content and passed through.
 */
describe('blocks_layout re-entry with a CLONED dict (recognition miss) passes through', () => {
  const template = {
    '@id': '/t/cols',
    blocks: {
      cols: {
        '@type': 'columns', fixed: true, readOnly: true,
        templateId: '/t/cols', slotId: 'cols',
        blocks: {
          cell: {
            '@type': 'slate', fixed: true, readOnly: true,
            templateId: '/t/cols', slotId: 'cell', value: [{ text: 'Cell' }],
          },
        },
        blocks_layout: { items: ['cell'] },
      },
    },
    blocks_layout: { items: ['cols'] },
  };

  test('a cloned container-children dict renders the children, not the whole template again', () => {
    const templates = { '/t/cols': template };
    const templateState = {};

    // Apply (forced layout): produces the columns container, fully expanded + stamped.
    const items = expandTemplatesSync([], {
      blocks: {}, templates, templateState, allowedLayouts: ['/t/cols'],
    });
    const cols = items.find((b) => b['@type'] === 'columns');
    expect(cols).toBeDefined();
    expect(cols.blocks).toBeDefined();
    const instanceId = cols.templateInstanceId;
    expect(instanceId).toBeTruthy();

    // The renderer re-enters the container's children — but the dict arrives as a
    // clone (model a Vue proxy / postMessage copy), so an object-identity lookup would
    // MISS. Same shared templateState, and `templates` available so a wrong re-apply
    // would actually re-produce the columns container (the infinite-loop shape).
    const clonedBlocks = JSON.parse(JSON.stringify(cols.blocks));
    const region = cols.blocks_layout.items;
    const childItems = expandTemplatesSync(region, {
      blocks: clonedBlocks, templates, templateState,
    });

    // Must render the CELL (already-expanded content), not re-apply /t/cols.
    expect(childItems.length).toBe(1);
    expect(childItems[0]['@type']).toBe('slate');
    expect(childItems[0]['@type']).not.toBe('columns');
    expect(childItems[0].templateInstanceId).toBe(instanceId);
  });
});
