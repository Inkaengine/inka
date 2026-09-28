import { buildBlockPathMap, buildIdFieldMap } from './buildBlockPathMap.js';

/**
 * An object_list is a region of sub-blocks by default: each item is a block
 * with an id, selectable on the canvas, seeded when the list is empty.
 * `subBlocks: false` opts out — the field is a plain list of objects, edited
 * with Volto's object-list widget in the sidebar (a dropdown's options, which
 * cannot be edited where they are drawn). Its items are not blocks.
 */
describe('object_list subBlocks: false', () => {
  const blocksConfig = {
    sbquestion: {
      id: 'sbquestion',
      blockSchema: {
        properties: {
          options: {
            widget: 'object_list',
            subBlocks: false,
            schema: { properties: { value: { type: 'string' }, label: { type: 'string' } } },
          },
          slides: {
            widget: 'object_list',
            schema: { properties: { title: { type: 'string' } } },
          },
        },
      },
    },
  };
  const formData = {
    blocks: {
      q1: {
        '@type': 'sbquestion',
        options: [
          { '@id': 'o1', value: 'yes', label: 'Yes' },
          { '@id': 'o2', value: 'no', label: 'No' },
        ],
        slides: [{ '@id': 's1', title: 'A slide' }],
      },
    },
    blocks_layout: { items: ['q1'] },
  };

  test('its items are not blocks; a default object_list still is a region', () => {
    const map = buildBlockPathMap(formData, blocksConfig, undefined);
    expect(map.o1).toBeUndefined();
    expect(map.o2).toBeUndefined();
    expect(map.s1).toMatchObject({ parentId: 'q1' });
  });

  test('it has no idField to stamp', () => {
    expect(buildIdFieldMap(blocksConfig, undefined)).toEqual({ sbquestion: { slides: '@id' } });
  });
});
