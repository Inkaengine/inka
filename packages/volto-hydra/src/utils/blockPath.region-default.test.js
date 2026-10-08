import { describe, test, expect } from 'vitest';
import {
  buildBlockPathMap,
  ensureEmptyBlockIfEmpty,
  initializeContainerBlock,
} from './blockPath';

/**
 * A region's `default` is the children it starts with, and goes back to.
 *
 * A field-level `default` listing child blocks seeds a new container's region with
 * them (each given a fresh id), and an emptied region is refilled with the same list.
 * Without a `default`, a region is seeded with one child of its default type, as
 * before. The default's entries are layered over each child type's own defaults.
 */
const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };

const QUERY = [{ i: 'path', o: 'absolutePath', v: '/' }];
const finder = {
  properties: {
    results: {
      widget: 'blocks_layout',
      allowedBlocks: ['list', 'note'],
      defaultBlockType: 'list',
      default: [
        { '@type': 'list', query: QUERY },
        { '@type': 'note', text: 'Nothing else' },
      ],
    },
  },
};
const blocksConfig = {
  finder: { id: 'finder', blockSchema: finder },
  list: {
    id: 'list',
    blockSchema: { properties: { query: { type: 'array' }, size: { default: 10 } } },
  },
  note: { id: 'note', blockSchema: { properties: { text: { type: 'string' } } } },
};

function counter(prefix) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

describe('a blocks_layout region with a default', () => {
  test('a new container starts with the default children, in order, with fresh ids', () => {
    const result = initializeContainerBlock(
      { '@type': 'finder' },
      blocksConfig,
      counter('id'),
      { intl, blockType: 'finder' },
    );
    const ids = result.blocks_layout.results;
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(result.blocks[ids[0]]).toMatchObject({ '@type': 'list', query: QUERY });
    expect(result.blocks[ids[1]]).toMatchObject({ '@type': 'note', text: 'Nothing else' });
    // The child type's own defaults still apply beneath the region's.
    expect(result.blocks[ids[0]].size).toBe(10);
    // The default is the region's seed, not its stored value.
    expect(result.results).toBeUndefined();
  });

  test('the default a block-defaults pass already copied onto the field is replaced, not kept', () => {
    // applyBlockDefaults fills a missing field with its schema default, so the raw list
    // can arrive on the field itself; it is not how a region is stored.
    const result = initializeContainerBlock(
      { '@type': 'finder', results: finder.properties.results.default },
      blocksConfig,
      counter('id'),
      { intl, blockType: 'finder' },
    );
    expect(result.results).toBeUndefined();
    expect(result.blocks_layout.results).toHaveLength(2);
  });

  test('two containers do not share their children', () => {
    const a = initializeContainerBlock({ '@type': 'finder' }, blocksConfig, counter('a'), { intl, blockType: 'finder' });
    const b = initializeContainerBlock({ '@type': 'finder' }, blocksConfig, counter('b'), { intl, blockType: 'finder' });
    const shared = a.blocks_layout.results.filter((id) => b.blocks_layout.results.includes(id));
    expect(shared).toEqual([]);
    // Nor the objects: changing one container's child leaves the other's alone.
    a.blocks[a.blocks_layout.results[0]].query.push({ i: 'x' });
    expect(b.blocks[b.blocks_layout.results[0]].query).toEqual(QUERY);
  });

  test('an entry with no @type is an error, not a guess', () => {
    const schema = {
      properties: { results: { widget: 'blocks_layout', defaultBlockType: 'list', default: [{ query: QUERY }] } },
    };
    expect(() =>
      initializeContainerBlock({ '@type': 'finder' }, blocksConfig, counter('id'), { intl, blockType: 'finder' }, schema),
    ).toThrow(/@type/);
  });

  test('a region with no default still starts with one child of its default type', () => {
    const schema = {
      properties: { results: { widget: 'blocks_layout', allowedBlocks: ['list', 'note'], defaultBlockType: 'list' } },
    };
    const result = initializeContainerBlock({ '@type': 'finder' }, blocksConfig, counter('id'), { intl, blockType: 'finder' }, schema);
    const ids = result.blocks_layout.results;
    expect(ids).toHaveLength(1);
    expect(result.blocks[ids[0]]).toMatchObject({ '@type': 'list', size: 10 });
    expect(result.blocks[ids[0]].query).toBeUndefined();
  });

  test('an emptied region is refilled with its default', () => {
    const form = {
      '@type': 'Document',
      blocks: {
        f1: { '@type': 'finder', blocks: {}, blocks_layout: { results: [] } },
      },
      blocks_layout: { items: ['f1'] },
    };
    const cfg = {
      ...blocksConfig,
      _page: { id: '_page', schema: () => ({ properties: { items: { widget: 'blocks_layout' } } }) },
      finder: { id: 'finder', schema: () => finder },
    };
    const map = buildBlockPathMap(form, cfg, intl);
    const result = ensureEmptyBlockIfEmpty(form, { parentId: 'f1' }, map, counter('r'), cfg, { intl });
    const ids = result.blocks.f1.blocks_layout.results;
    expect(ids).toHaveLength(2);
    expect(result.blocks.f1.blocks[ids[0]]).toMatchObject({ '@type': 'list', query: QUERY, size: 10 });
    expect(result.blocks.f1.blocks[ids[1]]).toMatchObject({ '@type': 'note', text: 'Nothing else' });
    expect(result.blocks_layout.items).toEqual(['f1']);
  });
});

describe('a refilled region leaves no copy of its default behind', () => {
  test('the raw default a block-defaults pass put on the field goes when the region is seeded', () => {
    // A block added before its regions are seeded (or loaded from data written so)
    // can carry the field's default list as a value; it is not how a region is
    // stored, and would be saved as a stray field.
    const form = {
      '@type': 'Document',
      blocks: {
        f1: {
          '@type': 'finder',
          results: finder.properties.results.default,
          blocks: {},
          blocks_layout: { results: [] },
        },
      },
      blocks_layout: { items: ['f1'] },
    };
    const cfg = {
      ...blocksConfig,
      _page: { id: '_page', schema: () => ({ properties: { items: { widget: 'blocks_layout' } } }) },
      finder: { id: 'finder', schema: () => finder },
    };
    const map = buildBlockPathMap(form, cfg, intl);
    const result = ensureEmptyBlockIfEmpty(form, { parentId: 'f1' }, map, counter('r'), cfg, { intl });
    expect(result.blocks.f1.blocks_layout.results).toHaveLength(2);
    expect(result.blocks.f1.results).toBeUndefined();
  });
});

describe('an object_list region with a default', () => {
  const tabsField = {
    widget: 'object_list',
    idField: '@id',
    schema: { properties: { label: { type: 'string' }, language: { type: 'string' } } },
    default: [{ '@id': 'tab-1', label: 'JavaScript', language: 'javascript' }],
  };

  test('a new block starts with the default items, each with a fresh id and its type\'s defaults', () => {
    const typed = {
      properties: {
        fields: {
          widget: 'object_list',
          idField: 'id',
          typeField: 'field_type',
          allowedBlocks: ['text', 'choice'],
          default: [
            { field_type: 'text', label: 'Name' },
            { field_type: 'choice', label: 'Colour' },
          ],
        },
      },
    };
    const cfg = {
      text: { id: 'text', blockSchema: { properties: { label: { type: 'string' }, required: { default: false } } } },
      choice: { id: 'choice', blockSchema: { properties: { label: { type: 'string' }, options: { default: ['a', 'b'] } } } },
    };
    // As applyBlockDefaults leaves it: the raw default copied onto the field.
    const make = (ids) =>
      initializeContainerBlock(
        { '@type': 'askForm', fields: typed.properties.fields.default },
        cfg,
        counter(ids),
        { intl, blockType: 'askForm' },
        typed,
      );
    const a = make('a');
    expect(a.fields.map((f) => [f.field_type, f.label])).toEqual([
      ['text', 'Name'],
      ['choice', 'Colour'],
    ]);
    expect(a.fields[0].required).toBe(false);
    expect(a.fields[1].options).toEqual(['a', 'b']);
    const b = make('b');
    const shared = a.fields.map((f) => f.id).filter((id) => b.fields.some((g) => g.id === id));
    expect(shared).toEqual([]);
    expect(a.fields.every((f) => f.id)).toBe(true);
  });

  test('an author\'s own items are kept, not replaced by the default', () => {
    const schema = { properties: { tabs: tabsField } };
    const own = [{ '@id': 'mine', label: 'Python', language: 'python' }];
    const result = initializeContainerBlock(
      { '@type': 'codeSample', tabs: own },
      {},
      counter('id'),
      { intl, blockType: 'codeSample' },
      schema,
    );
    expect(result.tabs).toEqual(own);
  });

  test('an emptied list is refilled with its default, each item with a fresh id', () => {
    const form = {
      '@type': 'Document',
      blocks: { c1: { '@type': 'codeSample', tabs: [] } },
      blocks_layout: { items: ['c1'] },
    };
    const cfg = {
      _page: { id: '_page', schema: () => ({ properties: { items: { widget: 'blocks_layout' } } }) },
      codeSample: { id: 'codeSample', schema: () => ({ properties: { tabs: tabsField } }) },
    };
    const map = buildBlockPathMap(form, cfg, intl);
    const result = ensureEmptyBlockIfEmpty(form, { parentId: 'c1' }, map, counter('t'), cfg, { intl });
    const tabs = result.blocks.c1.tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ label: 'JavaScript', language: 'javascript' });
    expect(tabs[0]['@id']).not.toBe('tab-1');
  });
});
