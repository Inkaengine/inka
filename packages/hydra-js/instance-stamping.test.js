import { expandEveryContainer } from './expandEveryContainer.testutil.js';
import { expandTemplatesSync } from '@volto-hydra/helpers';

/**
 * The merge must stamp EVERY block with its resolved instance id:
 *  - a child keeps the parent's id while its `templateId` matches (same-template
 *    nesting = ONE instance at every depth),
 *  - a child whose `templateId` differs starts a NEW id (a nested instance).
 * Then consumers use the plain flat check; no ancestry walk. (See the design
 * block at the head of expandTemplatesSync.)
 */
describe('merge stamps every block with its resolved instance id', () => {
  test('same-template nesting carries ONE instance id at every depth', () => {
    // columns -> column -> slate, all the same template (/t/outer)
    const A = {
      '@id': '/t/outer',
      blocks: {
        cols: {
          '@type': 'columns', fixed: true, slotId: 'cols', templateId: '/t/outer',
          blocks: {
            col1: {
              '@type': 'column', fixed: true, slotId: 'col1', templateId: '/t/outer',
              blocks: { cell: { '@type': 'slate', fixed: true, slotId: 'cell', templateId: '/t/outer', value: [{ text: 'x' }] } },
              blocks_layout: { items: ['cell'] },
            },
          },
          blocks_layout: { columns: ['col1'] },
        },
      },
      blocks_layout: { items: ['cols'] },
    };
    const result = expandEveryContainer([], {
      blocks: {}, templates: { '/t/outer': A }, templateState: {}, allowedLayouts: ['/t/outer'],
    });
    const cols = result.find((b) => b['@type'] === 'columns');
    const topId = cols.templateInstanceId;
    expect(topId).toBeTruthy();
    const col = cols.blocks[cols.blocks_layout.columns[0]];
    const cell = col.blocks[col.blocks_layout.items[0]];
    expect(col.templateInstanceId).toBe(topId);   // currently undefined
    expect(cell.templateInstanceId).toBe(topId);  // currently undefined
  });

  // STEP 5 (template-in-template): a nested block whose templateId DIFFERS must be
  // re-instanced (kept templateId + a distinct id) rather than flattened into the
  // parent. The merge currently flattens it; the spec lives with that work.
});
