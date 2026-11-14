import {
  cloneBlockFilteringNested,
  expandTemplatesSync,
  getChildBlockEntries,
  getChildFields,
} from '@volto-hydra/helpers';
import { buildIdFieldMap } from './buildBlockPathMap.js';
import { instanceContent, mergeTemplatesIntoPage } from './mergeTemplates.js';

/**
 * A region can live inside a widget:'object' (#245), and a template can be placed
 * anywhere a block can (docs/architecture.md "Merging templates: every container
 * is expanded, by whoever renders"). So everything that walks containers reaches
 * a region inside an object the same as one at the block's root.
 */

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

const template = {
  '@id': '/t/s',
  blocks: {
    head: {
      '@type': 'slate',
      fixed: true,
      readOnly: true,
      placeholder: 'head',
      templateId: '/t/s',
      templateInstanceId: 'def',
      value: 'CURRENT',
    },
  },
  blocks_layout: { items: ['head'] },
};

const placedBlock = {
  '@type': 'slate',
  fixed: true,
  readOnly: true,
  placeholder: 'head',
  templateId: '/t/s',
  templateInstanceId: 'inst-1',
  value: 'STALE',
};
const placed = () => ({ s1: { ...placedBlock } });

const merge = async (block, idFieldMap) => {
  let n = 0;
  const page = deepFreeze({ blocks: { c: block }, blocks_layout: { items: ['c'] } });
  const { merged } = await mergeTemplatesIntoPage(page, {
    loadTemplate: async () => template,
    uuidGenerator: () => `u${++n}`,
    idFieldMap,
  });
  return merged.blocks.c;
};

/** What the region shows, in order: what the frontend would draw. */
const shown = (container, region = 'items') =>
  container.blocks_layout[region].map((id) => container.blocks[id].value);

describe('getChildFields finds regions inside objects', () => {
  test('a blocks_layout in an object, with the object as its regionPath', () => {
    const block = { '@type': 'panel', data: { blocks: placed(), blocks_layout: { items: ['s1'] } } };
    expect(getChildFields(block)).toEqual([{ region: 'items', regionPath: ['data'] }]);
  });

  test('an object inside an object', () => {
    const block = { a: { b: { blocks: placed(), blocks_layout: { body: ['s1'] } } } };
    expect(getChildFields(block)).toEqual([{ region: 'body', regionPath: ['a', 'b'] }]);
  });

  test('a region at the root has no regionPath, and its blocks are not walked as objects', () => {
    const block = {
      blocks: { x: { '@type': 'grid', blocks: placed(), blocks_layout: { items: ['s1'] } } },
      blocks_layout: { items: ['x'] },
    };
    expect(getChildFields(block)).toEqual([{ region: 'items' }]);
  });

  test('an object_list in an object, named by its /-path in the idFieldMap', () => {
    const block = { '@type': 'tbl', table: { rows: [{ key: 'r1' }] } };
    const fields = getChildFields(block, { tbl: { 'table/rows': 'key' } }, { allObjectLists: true });
    expect(fields).toEqual([
      { isObjectList: true, region: 'rows', regionPath: ['table'], idField: 'key' },
    ]);
    expect(getChildBlockEntries(block, fields[0]).map((entry) => entry.id)).toEqual(['r1']);
  });

  test('an array in an object is no region unless declared', () => {
    const block = { '@type': 'tbl', table: { rows: [{ key: 'r1' }] }, styles: { color: 'red' } };
    expect(getChildFields(block, { tbl: {} }, { allObjectLists: true })).toEqual([]);
  });
});

describe('buildIdFieldMap reads inside objects', () => {
  test('names an object_list in an object by its /-path', () => {
    const blocksConfig = {
      tbl: {
        id: 'tbl',
        blockSchema: {
          properties: {
            top: { widget: 'object_list', idField: 'id' },
            table: {
              widget: 'object',
              schema: {
                properties: {
                  rows: { widget: 'object_list', idField: 'key' },
                  deep: {
                    widget: 'object',
                    schema: { properties: { items: { widget: 'object_list', idField: '@id' } } },
                  },
                },
              },
            },
          },
        },
      },
    };
    expect(buildIdFieldMap(blocksConfig)).toEqual({
      tbl: { top: 'id', 'table/rows': 'key', 'table/deep/items': '@id' },
    });
  });
});

describe('a template inside an object is merged like one at the root', () => {
  test('control: a region at the block root gets the current content', async () => {
    const out = await merge({ '@type': 'grid', blocks: placed(), blocks_layout: { items: ['s1'] } });
    expect(shown(out)).toEqual(['CURRENT']);
  });

  test('a blocks_layout in an object gets the current content, on frozen input', async () => {
    const out = await merge({
      '@type': 'panel',
      title: 'kept',
      data: { other: 'kept', blocks: placed(), blocks_layout: { items: ['s1'] } },
    });
    expect(shown(out.data)).toEqual(['CURRENT']);
    expect(out.data.other).toBe('kept');
    expect(out.title).toBe('kept');
    expect(out.blocks).toBeUndefined();
  });

  test('below an object too: a template in a panel of an accordion', async () => {
    const out = await merge({
      '@type': 'accordion',
      data: {
        blocks: { p1: { '@type': 'panel', blocks: placed(), blocks_layout: { items: ['s1'] } } },
        blocks_layout: { items: ['p1'] },
      },
    });
    expect(shown(out.data.blocks.p1)).toEqual(['CURRENT']);
  });

  test('an object_list in an object is written back into the object, on frozen input', async () => {
    const rows = [{ key: 'row-1', '@type': 'row', blocks: placed(), blocks_layout: { items: ['s1'] } }];
    const table = { caption: 'kept', rows };
    const out = await merge({ '@type': 'tbl', table }, { tbl: { 'table/rows': 'key' } });
    expect(out.table).not.toBe(table);
    expect(out.table.caption).toBe('kept');
    expect(out.table.rows.map((row) => row.key)).toEqual(['row-1']);
    expect(shown(out.table.rows[0])).toEqual(['CURRENT']);
  });
});

describe('instanceContent finds an instance inside an object', () => {
  test('its blocks, and the region it sits in', () => {
    const page = {
      blocks: {
        c: { '@type': 'panel', data: { blocks: placed(), blocks_layout: { items: ['s1'] } } },
      },
      blocks_layout: { items: ['c'] },
    };
    const { blocks } = instanceContent(page, 'inst-1', {});
    expect(Object.keys(blocks)).toEqual(['s1']);
  });
});

describe('a template whose own block holds a region inside an object', () => {
  test('the container\'s call fills it, with no schema, and leaves nothing behind', () => {
    const own = { fixed: true, readOnly: true, templateId: '/t/s' };
    const definition = {
      '@id': '/t/s',
      blocks: {
        acc: {
          ...own,
          slotId: 'acc',
          '@type': 'acc',
          templateInstanceId: 'def',
          data: {
            blocks: { head: { ...own, slotId: 'head', '@type': 'slate', templateInstanceId: 'def', value: 'CURRENT' } },
            blocks_layout: { items: ['head'] },
          },
        },
      },
      blocks_layout: { items: ['acc'] },
    };
    const templateState = {};
    const templates = { '/t/s': definition };
    const [out] = expandTemplatesSync(['acc'], {
      blocks: {
        acc: {
          ...own,
          slotId: 'acc',
          '@type': 'acc',
          templateInstanceId: 'inst-1',
          data: {
            blocks: { old: { ...own, slotId: 'head', '@type': 'slate', templateInstanceId: 'inst-1', value: 'STALE' } },
            blocks_layout: { items: ['old'] },
          },
        },
      },
      templateState,
      templates,
    });
    expect(out.blocks).toBeUndefined();
    expect(out.blocks_layout).toBeUndefined();

    const children = expandTemplatesSync(out.data.blocks_layout.items, {
      blocks: out.data.blocks,
      templateState,
      templates,
    });
    expect(children.map((child) => child.value)).toEqual(['CURRENT']);
    expect(children[0]['@uid']).toBe('old');
  });
});

describe('copying a block with a region inside an object', () => {
  test('rebuilds the object\'s own blocks, and adds none at the root', () => {
    const block = {
      '@type': 'acc',
      data: {
        blocks: {
          kept: { '@type': 'slate', templateId: '/t/s', value: 'kept' },
          dropped: { '@type': 'slate', value: 'dropped' },
        },
        blocks_layout: { items: ['kept', 'dropped'] },
      },
    };
    let n = 0;
    const copy = cloneBlockFilteringNested(deepFreeze(block), () => `u${++n}`);
    expect(shown(copy.data)).toEqual(['kept']);
    expect(copy.blocks).toBeUndefined();
    expect(copy.blocks_layout).toBeUndefined();
  });
});
