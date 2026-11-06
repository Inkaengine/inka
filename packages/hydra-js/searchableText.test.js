import { withSearchableText } from './searchableText.js';

/**
 * Inka #634: a page's search text holds what a visitor sees, from every block, once.
 * plone.restapi visits a block's `blocks` and `data.blocks`, and reads each block's
 * `searchableText`, else a slate block's `plaintext`. So each visited block carries its own
 * text and whatever the visit can't reach.
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
  inObject: {
    properties: {
      box: { widget: 'object', schema: { properties: { items: { widget: 'blocks_layout' } } } },
    },
  },
  pdf: {
    searchableFields: ['file'],
    properties: { file: { widget: 'object_browser' } },
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

// What plone.restapi's indexer does with a block: its children, then itself.
function indexed(block) {
  const children = [...Object.values(block.data?.blocks ?? {})];
  if (block.blocks && !Array.isArray(block.blocks)) children.push(...Object.values(block.blocks));
  return [...children.flatMap(indexed), block.searchableText || block.plaintext || ''].filter(Boolean);
}
const allText = (block) => indexed(withSearchableText(pageOf({ b: block }), options).blocks.b);

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

  test('a slate block restapi reads from its plaintext needs no copy', () => {
    expect(textOf({ '@type': 'slate', value: slate('Typed'), plaintext: 'Typed' })).toBeUndefined();
  });

  test('a container carries its own text; its children carry theirs', () => {
    const page = withSearchableText(pageOf({
      s: {
        '@type': 'section',
        title: 'Heading',
        blocks: {
          z: { '@type': 'slate', value: slate('Second') },
          a: { '@type': 'slate', value: slate('First') },
        },
        blocks_layout: { items: ['a', 'z'] },
      },
    }), options);
    expect(page.blocks.s.searchableText).toBe('Heading');
    expect(page.blocks.s.blocks.a.searchableText).toBe('First');
    expect(page.blocks.s.blocks.z.searchableText).toBe('Second');
  });

  test('nothing is indexed twice, with containers at every depth', () => {
    expect(allText({
      '@type': 'accordion',
      data: {
        blocks: {
          p1: {
            '@type': 'panel',
            title: 'Panel title',
            blocks: { c: { '@type': 'slate', value: slate('Panel text'), plaintext: 'Panel text' } },
            blocks_layout: { items: ['c'] },
          },
        },
        blocks_layout: { items: ['p1'] },
      },
    }).sort()).toEqual(['Panel text', 'Panel title']);
  });

  test('a region in an object restapi does not walk goes on the block', () => {
    expect(allText({
      '@type': 'inObject',
      box: {
        blocks: { c: { '@type': 'slate', value: slate('Boxed') } },
        blocks_layout: { items: ['c'] },
      },
    })).toEqual(['Boxed']);
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

  test('a block type can name its fields, in the order it wants', () => {
    expect(textOf({ '@type': 'ordered', first: 'One', second: 'Two', third: 'Three' })).toBe('Two One');
  });

  test('a named field holding a picked item reads as its title', () => {
    expect(textOf({
      '@type': 'pdf',
      file: [{ '@id': '/files/report', title: 'Annual report', getObjSize: '2 MB' }],
    })).toBe('Annual report');
  });

  test('a field it names that this block is not showing is still left out', () => {
    expect(textOf({ '@type': 'ordered', first: 'One', second: 'Two', showing: 'first' })).toBe('One');
  });

  test('a block type with no schema fails loudly', () => {
    expect(() => textOf({ '@type': 'unknown' })).toThrow(/unknown/);
  });
});

describe('a page', () => {
  test('blocks in every region get their text', () => {
    const page = { blocks: { f: { '@type': 'card', title: 'In the footer' } }, blocks_layout: { footer: ['f'] } };
    expect(withSearchableText(page, options).blocks.f.searchableText).toBe('In the footer');
  });

  test('text from before is replaced, at any depth', () => {
    const out = withSearchableText(pageOf({
      s: {
        '@type': 'section',
        title: 'New',
        searchableText: 'stale',
        blocks: { c: { '@type': 'empty', searchableText: 'stale' } },
        blocks_layout: { items: ['c'] },
      },
    }), options);
    expect(out.blocks.s.searchableText).toBe('New');
    expect(out.blocks.s.blocks.c.searchableText).toBeUndefined();
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
    expect(allText({
      '@type': 'section',
      title: 'Shared heading',
      ...locked,
      blocks: {
        chrome: { '@type': 'slate', value: slate('Shared text'), ...locked },
        mine: { '@type': 'slate', value: slate('Page text'), templateId: '/t', templateInstanceId: 'i', slotId: 's' },
      },
      blocks_layout: { items: ['chrome', 'mine'] },
    })).toEqual(['Page text']);
  });
});
