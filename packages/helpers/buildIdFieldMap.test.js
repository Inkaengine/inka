import { buildIdFieldMap } from './buildBlockPathMap.js';

/**
 * buildIdFieldMap is the ADMIN's derivation of the per-(blockType, field) object_list idField —
 * the resolved hint the merge needs so it stamps item ids into the right field (a form's subblocks
 * by field_id, not @id). It's the type-level projection of what buildBlockPathMap resolves per
 * instance, using the same getBlockTypeSchema (+ its type cache). Types are unique here to avoid
 * cross-test cache collisions in getBlockTypeSchema.
 */
describe('buildIdFieldMap', () => {
  test('derives { blockType: { field: idField } } for object_list fields, defaulting @id', () => {
    const blocksConfig = {
      testform: {
        id: 'testform',
        blockSchema: {
          properties: {
            subblocks: { widget: 'object_list', idField: 'field_id', typeField: 'field_type' },
            title: { widget: 'text' }, // not an object_list → ignored
          },
        },
      },
      testslider: {
        id: 'testslider',
        blockSchema: {
          properties: {
            slides: { widget: 'object_list' }, // no idField declared → defaults to @id
          },
        },
      },
      testslate: { id: 'testslate' }, // no schema → contributes nothing
    };
    const map = buildIdFieldMap(blocksConfig, undefined);
    expect(map).toEqual({
      testform: { subblocks: 'field_id' },
      testslider: { slides: '@id' },
    });
  });
});
