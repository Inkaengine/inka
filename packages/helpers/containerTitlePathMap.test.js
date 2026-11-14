/**
 * Every pathmap entry names the container its block lives in, as a person
 * reads it: the parent block type's title, or "Page" for a block on the page
 * itself. The drop indicator labels itself with it, so a drop that would land
 * in the outer container rather than the small one under the pointer says so
 * before the mouse is released.
 */
import { buildBlockPathMap } from './buildBlockPathMap.js';

const blocksConfig = {
  _page: {
    id: '_page',
    schema: () => ({ properties: { items: { widget: 'blocks_layout' } } }),
  },
  pills: {
    id: 'pills',
    title: 'Pills',
    schema: () => ({ properties: { items: { widget: 'blocks_layout', allowedBlocks: ['pill'] } } }),
  },
  untitled: {
    id: 'untitled',
    schema: () => ({ properties: { items: { widget: 'blocks_layout' } } }),
  },
  pill: { id: 'pill', title: 'Pill', schema: () => ({ properties: { text: { type: 'string' } } }) },
};

const formData = {
  blocks: {
    p1: {
      '@type': 'pills',
      blocks: { a: { '@type': 'pill' } },
      blocks_layout: { items: ['a'] },
    },
    u1: {
      '@type': 'untitled',
      blocks: { b: { '@type': 'pill' } },
      blocks_layout: { items: ['b'] },
    },
  },
  blocks_layout: { items: ['p1', 'u1'] },
};

describe('containerTitle', () => {
  const map = buildBlockPathMap(formData, blocksConfig);

  test("a block in a container names that container's type", () => {
    expect(map.a.containerTitle).toBe('Pills');
  });

  test('a block on the page names the page', () => {
    expect(map.p1.containerTitle).toBe('Page');
  });

  test('a container type with no title is named by its id', () => {
    expect(map.b.containerTitle).toBe('untitled');
  });
});
