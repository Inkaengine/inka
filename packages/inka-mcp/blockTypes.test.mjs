import { describe, it, expect } from 'vitest';
import { describeBlockTypes, describeBlockType } from './blockTypes.mjs';

const field = (facts) => facts;
const schemas = {
  page: { regions: [{ region: 'items', isObjectList: false, allowedBlocks: ['slate', 'columns', 'slider'], defaultBlockType: 'slate', maxLength: null }] },
  types: {
    slate: {
      title: 'Text',
      blockSchema: { required: ['value'], properties: { value: field({ title: 'Body', widget: 'slate' }) } },
      regions: [],
    },
    columns: {
      title: 'Columns',
      blockSchema: { required: [], properties: { title: field({ title: 'Title' }), columns: field({ widget: 'blocks_layout', title: 'Columns' }) } },
      regions: [{ region: 'columns', isObjectList: false, allowedBlocks: ['column'], defaultBlockType: 'column', maxLength: 4 }],
    },
    column: {
      title: 'Column',
      blockSchema: { required: [], properties: { blocks_layout: field({ widget: 'blocks_layout' }) } },
      regions: [{ region: 'items', isObjectList: false, allowedBlocks: ['slate'], defaultBlockType: 'slate', maxLength: null }],
    },
    slider: {
      title: 'Slider',
      blockSchema: { required: [], properties: { slides: field({ widget: 'object_list', title: 'Slides' }) } },
      regions: [{
        region: 'slides', isObjectList: true, allowedBlocks: ['slider:slides'], defaultBlockType: 'slider:slides', maxLength: null,
      }],
    },
    'slider:slides': {
      title: 'Slide',
      blockSchema: { required: ['head'], properties: { head: field({ title: 'Heading' }), size: field({ title: 'Size', choices: [['s', 'Small'], ['l', 'Large']], default: 's' }) } },
      regions: [],
    },
    empty: { title: 'Empty', blockSchema: { required: [], properties: {} }, regions: [] },
    restricted: { title: 'Not here', blockSchema: { required: [], properties: {} }, regions: [] },
  },
};

describe('describeBlockTypes', () => {
  const described = describeBlockTypes(schemas);

  it('lists what the page itself takes, by the agent name of its list', () => {
    expect(described.page).toEqual([{ field: 'blocks', allowed: ['slate', 'columns', 'slider'] }]);
  });

  it('lists only the types an agent can reach from the page', () => {
    expect(Object.keys(described.types).sort()).toEqual(['column', 'columns', 'slate', 'slider', 'slider:slides']);
  });

  it('gives fields with their facts, marking required and rich text', () => {
    expect(described.types.slate.fields).toEqual({ value: { title: 'Body', widget: 'slate', required: true, markdown: true } });
  });

  it('lists regions separately from fields, with their limits', () => {
    expect(described.types.columns.fields).toEqual({ title: { title: 'Title' } });
    expect(described.types.columns.regions).toEqual([{ field: 'columns', allowed: ['column'], maxLength: 4 }]);
    expect(described.types.column.regions).toEqual([{ field: 'blocks', allowed: ['slate'] }]);
  });

  it('lists list items by the type the admin registers for them', () => {
    expect(described.types.slider.regions).toEqual([{ field: 'slides', allowed: ['slider:slides'], list: true }]);
    expect(described.types['slider:slides']).toEqual({
      title: 'Slide',
      fields: {
        head: { title: 'Heading', required: true },
        size: { title: 'Size', choices: [['s', 'Small'], ['l', 'Large']], default: 's' },
      },
      regions: [],
    });
  });

  it('fails on a region allowing a type nothing describes', () => {
    const broken = { ...schemas, page: { regions: [{ region: 'items', allowedBlocks: ['ghost'] }] } };
    expect(() => describeBlockTypes(broken)).toThrow(/"ghost"/);
  });
});

describe('describeBlockType', () => {
  const withVariations = {
    ...schemas,
    types: { ...schemas.types, slate: { ...schemas.types.slate, description: 'Rich text', variations: [{ id: 'default', title: 'Default', isDefault: true }] } },
  };

  it('gives the type in full: description, variations, fields, regions', () => {
    const d = describeBlockType(withVariations, 'slate');
    expect(d).toMatchObject({
      type: 'slate', title: 'Text', description: 'Rich text',
      variations: [{ id: 'default', title: 'Default', isDefault: true }],
      fields: { value: { title: 'Body', widget: 'slate', required: true, markdown: true } },
      regions: [],
    });
  });

  it('says where on the page it can go', () => {
    expect(describeBlockType(withVariations, 'slate').allowedIn).toEqual(["the page's blocks", "column's blocks"]);
    expect(describeBlockType(withVariations, 'column').allowedIn).toEqual(["columns's columns"]);
  });

  it('refuses a type the page has no config for', () => {
    expect(() => describeBlockType(withVariations, 'ghost')).toThrow(/no block type "ghost"/);
  });
});
