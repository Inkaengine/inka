/**
 * A field mapping names its field two ways: a bare name (`title: 'title'`) or
 * `{ field, type }` (`getURL: { field: 'url', type: 'link' }`). Converting a
 * block reads both: a card turned into a content block keeps its link.
 */
import { describe, test, expect } from 'vitest';
import { convertBlockType } from './blockSync.js';

const link = [{ '@id': '/a-page' }];
const blocks = {
  card: {
    id: 'card',
    blockSchema: { properties: { title: {}, url: { widget: 'object_browser', mode: 'link' } } },
    fieldMappings: { '@default': { getURL: { field: 'url', type: 'link' }, title: 'title' } },
  },
  contentBlock: {
    id: 'contentBlock',
    blockSchema: { properties: { title: {}, linkUrl: { widget: 'object_browser', mode: 'link' } } },
    fieldMappings: { '@default': { getURL: { field: 'linkUrl', type: 'link' }, title: 'title' } },
  },
};

describe('converting reads a `{ field, type }` mapping', () => {
  test('a card becomes a content block with the same link', () => {
    const out = convertBlockType({ '@type': 'card', title: 'T', url: link }, 'contentBlock', blocks);
    expect(out['@type']).toBe('contentBlock');
    expect(out.linkUrl).toEqual(link);
    expect(out.title).toBe('T');
    expect(out).not.toHaveProperty(['[object Object]']);
  });

  test('and back', () => {
    const out = convertBlockType({ '@type': 'contentBlock', title: 'T', linkUrl: link }, 'card', blocks);
    expect(out['@type']).toBe('card');
    expect(out.url).toEqual(link);
    expect(out.title).toBe('T');
    expect(out).not.toHaveProperty(['[object Object]']);
  });
});
