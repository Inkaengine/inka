import { withSearchableText } from './searchableText.js';

/**
 * Inka #634: a page's search text holds what a visitor sees, in page order, from every
 * block. Each top-level block carries the text of its whole subtree as `searchableText`;
 * nested blocks carry none, so nothing is indexed twice.
 */
const slate = (text) => [{ type: 'p', children: [{ text }] }];

const schemas = {
  slate: { properties: { value: { widget: 'slate' } } },
  card: {
    properties: {
      title: { type: 'string' },
      description: { widget: 'textarea' },
      href: { widget: 'url' },
      variant: { type: 'string', choices: [['a', 'A']] },
    },
  },
  section: {
    properties: { title: { type: 'string' }, items: { widget: 'blocks_layout' } },
  },
  accordion: {
    properties: {
      data: {
        widget: 'object',
        schema: { properties: { items: { widget: 'blocks_layout' } } },
      },
    },
  },
  panel: { properties: { title: { type: 'string' }, items: { widget: 'blocks_layout' } } },
  table: {
    properties: {
      caption: { type: 'string' },
      table: {
        widget: 'object',
        schema: {
          properties: {
            rows: {
              widget: 'object_list',
              idField: 'key',
              schema: {
                properties: {
                  cells: { widget: 'object_list', idField: 'key', typeField: '@type' },
                },
              },
            },
          },
        },
      },
    },
  },
  tableCell: { properties: { blocks: { widget: 'object_list', typeField: '@type' } } },
  tableHeaderCell: { properties: { value: { widget: 'slate' } } },
  form: {
    properties: {
      title: { type: 'string' },
      subblocks: {
        widget: 'object_list',
        idField: 'field_id',
        schema: { properties: { label: { type: 'string' }, field_id: { type: 'string', widget: 'hidden' } } },
      },
    },
  },
  ordered: {
    searchableFields: ['second', 'first'],
    properties: { first: { type: 'string' }, second: { type: 'string' }, third: { type: 'string' } },
  },
  empty: { properties: {} },
};
const options = {
  schemaFor: (block) => {
    const schema = schemas[block['@type']];
    if (!schema || block.showing === undefined) return schema ?? null;
    // As a fieldRule does: a field that isn't showing isn't in this block's schema.
    return { properties: { [block.showing]: schema.properties[block.showing] } };
  },
  fieldsFor: (type) => schemas[type]?.searchableFields,
};

const pageOf = (blocks, items = Object.keys(blocks)) => ({ blocks, blocks_layout: { items } });
const textOf = (block) => withSearchableText(pageOf({ b: block }), options).blocks.b.searchableText;

describe('the text of a block', () => {
  test('its text fields, in schema order, without links and tokens', () => {
    expect(textOf({
      '@type': 'card',
      description: 'Second',
      title: 'First',
      href: 'https://example.com/not-text',
      variant: 'a',
    })).toBe('First Second');
  });

  test('a slate field reads as what was typed', () => {
    expect(textOf({ '@type': 'slate', value: slate('Typed words') })).toBe('Typed words');
  });

  test('a container holds its children in layout order, and only those it lists', () => {
    expect(textOf({
      '@type': 'section',
      title: 'Heading',
      blocks: {
        z: { '@type': 'slate', value: slate('Second') },
        a: { '@type': 'slate', value: slate('First') },
        hidden: { '@type': 'slate', value: slate('Not listed') },
      },
      blocks_layout: { items: ['a', 'z'] },
    })).toBe('Heading First Second');
  });

  test('a region inside an object, with containers below it', () => {
    expect(textOf({
      '@type': 'accordion',
      data: {
        blocks: {
          p1: {
            '@type': 'panel',
            title: 'Panel title',
            blocks: { c: { '@type': 'slate', value: slate('Panel text') } },
            blocks_layout: { items: ['c'] },
          },
        },
        blocks_layout: { items: ['p1'] },
      },
    })).toBe('Panel title Panel text');
  });

  test('a table: object lists, untyped rows and typed cells', () => {
    expect(textOf({
      '@type': 'table',
      caption: 'A caption',
      table: {
        rows: [
          { key: 'r1', cells: [{ key: 'c1', '@type': 'tableHeaderCell', value: slate('Header') }] },
          {
            key: 'r2',
            cells: [{ key: 'c2', '@type': 'tableCell', blocks: [{ '@id': 's', '@type': 'slate', value: slate('Cell') }] }],
          },
        ],
      },
    })).toBe('A caption Header Cell');
  });

  test('a form: its questions, not their ids', () => {
    expect(textOf({
      '@type': 'form',
      title: 'Tell us',
      subblocks: [{ field_id: 'q1', label: 'Your name' }],
    })).toBe('Tell us Your name');
  });

  test('a region the schema does not declare is still walked', () => {
    expect(textOf({
      '@type': 'card',
      title: 'Card',
      blocks: { c: { '@type': 'slate', value: slate('Inside') } },
      blocks_layout: { items: ['c'] },
    })).toBe('Card Inside');
  });

  test('a field this block is not showing is left out', () => {
    expect(textOf({ '@type': 'card', title: 'Shown', description: 'Old text', showing: 'title' })).toBe('Shown');
  });

  test('a block type can name its fields, in the order it wants', () => {
    expect(textOf({ '@type': 'ordered', first: 'One', second: 'Two', third: 'Three' })).toBe('Two One');
  });

  test('a field it names that this block is not showing is still left out', () => {
    expect(textOf({ '@type': 'ordered', first: 'One', second: 'Two', showing: 'first' })).toBe('One');
  });

  test('a block type with no schema fails loudly', () => {
    expect(() => textOf({ '@type': 'unknown' })).toThrow(/unknown/);
  });
});

describe('a page', () => {
  test('only top-level blocks carry text, in every region; nested ones carry none', () => {
    const page = {
      blocks: {
        s: {
          '@type': 'section',
          title: 'Heading',
          searchableText: 'stale',
          blocks: { c: { '@type': 'slate', value: slate('Inside'), searchableText: 'stale' } },
          blocks_layout: { items: ['c'] },
        },
        f: { '@type': 'slate', value: slate('In the footer region') },
      },
      blocks_layout: { items: ['s'], footer: ['f'] },
    };
    const out = withSearchableText(page, options);
    expect(out.blocks.s.searchableText).toBe('Heading Inside');
    expect(out.blocks.s.blocks.c.searchableText).toBeUndefined();
    expect(out.blocks.f.searchableText).toBe('In the footer region');
  });

  test('a block with no text carries none, even if it had some', () => {
    const out = withSearchableText(pageOf({ e: { '@type': 'empty', searchableText: 'stale' } }), options);
    expect('searchableText' in out.blocks.e).toBe(false);
  });

  test('the input is not changed', () => {
    const page = pageOf({ b: { '@type': 'card', title: 'T' } });
    const before = JSON.stringify(page);
    withSearchableText(page, options);
    expect(JSON.stringify(page)).toBe(before);
  });
});

describe('template blocks', () => {
  const locked = { templateId: '/t', templateInstanceId: 'i', fixed: true, readOnly: true };

  test('a block the template owns is left out: shared chrome is on every page', () => {
    expect(textOf({ '@type': 'card', title: 'Shared', ...locked })).toBeUndefined();
  });

  test('an editable fixed block is the page\'s', () => {
    expect(textOf({ '@type': 'card', title: 'Mine', ...locked, readOnly: false })).toBe('Mine');
  });

  test('page content in a slot inside a locked block is the page\'s', () => {
    expect(textOf({
      '@type': 'section',
      title: 'Shared heading',
      ...locked,
      blocks: {
        chrome: { '@type': 'slate', value: slate('Shared text'), ...locked },
        mine: { '@type': 'slate', value: slate('Page text'), templateId: '/t', templateInstanceId: 'i', slotId: 's' },
      },
      blocks_layout: { items: ['chrome', 'mine'] },
    })).toBe('Page text');
  });
});
