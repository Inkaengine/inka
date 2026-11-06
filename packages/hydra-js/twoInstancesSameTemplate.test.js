import { expandEveryContainer } from './expandEveryContainer.testutil.js';
import { expandTemplatesSync } from '@volto-hydra/helpers';

/**
 * Two forced layouts of the SAME template, applied to two different containers in one
 * page render (sharing ONE templateState). We must get:
 *   (1) NO duplicate block ids across the two instances — including NESTED blocks, which
 *       live in each container's own blocks dict but must still be globally unique
 *       (the admin's blockPathMap keys by block id; a collision maps one id to two paths).
 *   (2) TWO distinct templateInstanceIds — one per container.
 *
 * This mirrors what snippet insertion already guarantees (cloneBlocksWithNewIds re-ids
 * nested blocks; see expandTemplatesNestedRegions.test.js). The forced-layout apply path
 * must do the same. The template is an all-fixed nested layout (columns > column > slate),
 * the shape a branded footer takes — where nested-id reuse across instances bites.
 */
const template = {
  '@id': '/templates/footer-layout',
  blocks: {
    cols: {
      '@type': 'columns',
      fixed: true,
      readOnly: true,
      templateId: '/templates/footer-layout',
      slotId: 'cols',
      blocks: {
        'col-1': {
          '@type': 'column',
          fixed: true,
          readOnly: true,
          templateId: '/templates/footer-layout',
          slotId: 'col-1',
          blocks: {
            'txt-1': {
              '@type': 'slate',
              fixed: true,
              readOnly: true,
              templateId: '/templates/footer-layout',
              slotId: 'txt-1',
              value: [{ text: 'Footer' }],
            },
          },
          blocks_layout: { items: ['txt-1'] },
        },
      },
      blocks_layout: { columns: ['col-1'] },
    },
  },
  blocks_layout: { items: ['cols'] },
};

// Walk an expand result collecting every block id + its templateInstanceId, descending
// through every nested blocks_layout region.
function collect(items) {
  const rows = [];
  const walk = (b, id) => {
    if (!b) return;
    if (id !== undefined) rows.push({ id, inst: b.templateInstanceId });
    for (const list of Object.values(b.blocks_layout || {})) {
      if (Array.isArray(list)) for (const cid of list) walk(b.blocks?.[cid], cid);
    }
  };
  for (const item of items) walk(item, item['@uid']);
  return rows;
}

test('two forced layouts of the same template → unique block ids + distinct instances', () => {
  const templates = { '/templates/footer-layout': template };
  const templateState = {}; // ONE shared state for the whole page render
  let c = 0;
  const uuidGenerator = () => `u-${++c}`;

  const container1 = expandEveryContainer([], {
    blocks: {},
    templates,
    templateState,
    allowedLayouts: ['/templates/footer-layout'],
    uuidGenerator,
  });
  const container2 = expandEveryContainer([], {
    blocks: {},
    templates,
    templateState,
    allowedLayouts: ['/templates/footer-layout'],
    uuidGenerator,
  });

  const r1 = collect(container1);
  const r2 = collect(container2);

  // (2) two distinct instance ids, one per container.
  const inst1 = new Set(r1.map((r) => r.inst).filter(Boolean));
  const inst2 = new Set(r2.map((r) => r.inst).filter(Boolean));
  expect(inst1.size).toBe(1);
  expect(inst2.size).toBe(1);
  expect([...inst1][0]).not.toBe([...inst2][0]);

  // (1) no duplicate block ids across both instances (including nested).
  const allIds = [...r1, ...r2].map((r) => r.id);
  const dups = [...new Set(allIds.filter((id, i) => allIds.indexOf(id) !== i))];
  expect(dups).toEqual([]);
});
