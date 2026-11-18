/**
 * The save keeps only what each block's schema declares. A conversion keeps a
 * block's other fields while editing, so switching the type back restores them;
 * once saved, the block holds what its final type declares, as the content check
 * requires.
 */
import { describe, test, expect } from 'vitest';
import { convertBlockType } from './blockSync.js';
import { withoutUndeclaredFields } from './withoutUndeclaredFields.js';

const link = [{ '@id': '/a-page' }];
const blocksConfig = {
  card: {
    id: 'card',
    blockSchema: { properties: { title: {}, tag: {}, url: { widget: 'object_browser', mode: 'link' } } },
    fieldMappings: { '@default': { getURL: { field: 'url', type: 'link' }, title: 'title' } },
  },
  contentBlock: {
    id: 'contentBlock',
    blockSchema: { properties: { title: {}, linkUrl: { widget: 'object_browser', mode: 'link' } } },
    fieldMappings: { '@default': { getURL: { field: 'linkUrl', type: 'link' }, title: 'title' } },
  },
  form: {
    id: 'form',
    blockSchema: { properties: { subblocks: { widget: 'object_list', idField: 'field_id', typeField: 'field_type', allowedBlocks: ['text'] } } },
  },
  text: { id: 'text', blockSchema: { properties: { label: {} } } },
};
const intl = { formatMessage: (m) => m.defaultMessage };
const page = (blocks) => ({ title: 'P', blocks, blocks_layout: { items: Object.keys(blocks) } });

describe('the save keeps only what each block declares', () => {
  test("a converted block's leftovers stay while editing, and go on save", () => {
    const card = { '@type': 'card', title: 'T', tag: 'News', url: link };
    const converted = convertBlockType(card, 'contentBlock', blocksConfig);
    expect(converted.tag).toBe('News'); // kept while editing, for the way back
    expect(convertBlockType(converted, 'card', blocksConfig).tag).toBe('News');

    const saved = withoutUndeclaredFields(page({ c: converted }), { blocksConfig, intl });
    expect(saved.blocks.c).toEqual({ '@type': 'contentBlock', title: 'T', linkUrl: link });
  });

  test("a list item's own key and type stay; its stray fields go", () => {
    const form = { '@type': 'form', subblocks: [{ field_id: 'q1', field_type: 'text', label: 'Name', id: 'q1' }] };
    const saved = withoutUndeclaredFields(page({ f: form }), { blocksConfig, intl });
    expect(saved.blocks.f.subblocks).toEqual([{ field_id: 'q1', field_type: 'text', label: 'Name' }]);
  });

  test('bookkeeping and template membership stay', () => {
    const block = { '@type': 'card', title: 'T', templateId: '/t', slotId: 's', fixed: false, searchableText: 'T', '@uid': 'x' };
    const saved = withoutUndeclaredFields(page({ c: block }), { blocksConfig, intl });
    expect(saved.blocks.c).toEqual(block);
  });

  test("the page's own fields and the input are untouched", () => {
    const input = page({ c: { '@type': 'card', title: 'T', stray: 1 } });
    const before = JSON.stringify(input);
    const saved = withoutUndeclaredFields(input, { blocksConfig, intl });
    expect(saved.title).toBe('P');
    expect(JSON.stringify(input)).toBe(before);
  });
});
