/**
 * A list region's id field is never assumed.
 *
 * Every object_list region names the field its items are keyed by — `@id`
 * for a slider's slides, `key` for a table's rows, `field_id` for a form's
 * fields (docs/testing/blockmd.md: "must declare idField ... with no
 * default"). Where a schema or a caller left it out, Inka used to take `@id`.
 * For a list that is not keyed by `@id` that read every item's id as
 * undefined, and carried on: a reorder found none of the items and returned
 * an empty list, a delete or an edit matched nothing.
 */
import { buildBlockPathMap, buildIdFieldMap } from '@volto-hydra/helpers/buildBlockPathMap.js';
import {
  getContainerRegionDescriptors,
  insertBlockInContainer,
  listContainerChildren,
} from '@volto-hydra/helpers/blockPath.js';

// A form whose fields are keyed by `field_id`, and whose schema forgot to say so.
const undeclared = {
  form: {
    id: 'form',
    blockSchema: {
      properties: {
        subblocks: { widget: 'object_list', typeField: 'field_type', allowedBlocks: ['text'] },
      },
    },
  },
  text: { id: 'text', blockSchema: { properties: { label: { type: 'string' } } } },
};

const page = {
  blocks: {
    f1: {
      '@type': 'form',
      subblocks: [
        { field_id: 'q1', field_type: 'text', label: 'One' },
        { field_id: 'q2', field_type: 'text', label: 'Two' },
      ],
    },
  },
  blocks_layout: { items: ['f1'] },
};

describe('a schema that names no idField for a list region', () => {
  test('the block map refuses it, naming the block and the field', () => {
    expect(() => buildBlockPathMap(page, undeclared, {})).toThrow(/form.*subblocks.*idField|idField.*form.*subblocks/s);
  });

  test('the id-field map refuses it', () => {
    expect(() => buildIdFieldMap(undeclared, {})).toThrow(/form.*subblocks.*idField|idField.*form.*subblocks/s);
  });

  test('the region descriptors refuse it', () => {
    expect(() => getContainerRegionDescriptors('form', undeclared, {}, page.blocks.f1)).toThrow(/idField/);
  });

  test('a plain list (subBlocks: false) is not a region and needs none', () => {
    const plain = {
      ...undeclared,
      form: { id: 'form', blockSchema: { properties: { options: { widget: 'object_list', subBlocks: false } } } },
    };
    expect(() => buildIdFieldMap(plain, {})).not.toThrow();
  });
});

describe('an operation on a list whose config carries no idField', () => {
  const config = { region: 'subblocks', isObjectList: true, typeField: 'field_type' };

  test('listing its children throws rather than reading `key` or `@id`', () => {
    expect(() => listContainerChildren(page.blocks.f1, config)).toThrow(/idField/);
  });

  test('inserting into it throws rather than stamping an `@id`', () => {
    const map = buildBlockPathMap(page, {
      ...undeclared,
      form: { ...undeclared.form, blockSchema: { properties: { subblocks: { ...undeclared.form.blockSchema.properties.subblocks, idField: 'field_id' } } } },
    }, {});
    expect(() =>
      insertBlockInContainer(page, map, 'q1', 'q3', { field_type: 'text' }, { ...config, parentId: 'f1', fieldName: 'subblocks' }, 'after'),
    ).toThrow(/idField/);
  });

  test('with its idField named, the children are read by it', () => {
    expect(listContainerChildren(page.blocks.f1, { ...config, idField: 'field_id' }).map((c) => c.id)).toEqual(['q1', 'q2']);
  });
});
