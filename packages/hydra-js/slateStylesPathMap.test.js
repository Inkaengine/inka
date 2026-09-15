/**
 * The slate style allow-list resolves per REGION and rides on the pathmap
 * entry, so the bridge gets it for free (it already receives the whole
 * blockPathMap) and the transitive fold is the traversal that already exists.
 */
import { buildBlockPathMap } from './buildBlockPathMap.js';
import { isStyleAllowed } from './slateStyles.js';

// Page bans blockquote site-wide. The section's own region restates a narrower
// allow-list; the column widens it again.
const blocksConfig = {
  _page: {
    id: '_page',
    schema: () => ({
      properties: {
        items: { widget: 'blocks_layout', disallowedStyles: ['blockquote'] },
        footer: { widget: 'blocks_layout', allowedStyles: ['p'] },
      },
    }),
  },
  section: {
    id: 'section',
    schema: () => ({
      properties: {
        items: { widget: 'blocks_layout', allowedStyles: ['p', 'h2', 'blockquote'] },
      },
    }),
  },
  column: {
    id: 'column',
    schema: () => ({
      properties: {
        items: { widget: 'blocks_layout', allowedStyles: ['p', 'h2', 'h3'] },
      },
    }),
  },
  slate: { id: 'slate', schema: () => ({ properties: { value: { widget: 'slate' } } }) },
};

const formData = () => ({
  blocks: {
    top: { '@type': 'slate', value: [] },
    sec: {
      '@type': 'section',
      blocks: {
        mid: { '@type': 'slate', value: [] },
        col: {
          '@type': 'column',
          blocks: { deep: { '@type': 'slate', value: [] } },
          blocks_layout: { items: ['deep'] },
        },
      },
      blocks_layout: { items: ['mid', 'col'] },
    },
    foot: { '@type': 'slate', value: [] },
  },
  blocks_layout: { items: ['top', 'sec'], footer: ['foot'] },
});

describe('slate style rules on the block path map', () => {
  const map = buildBlockPathMap(formData(), blocksConfig, {});

  test('a page region declaration reaches its blocks', () => {
    expect(isStyleAllowed('blockquote', map.top.slateRules)).toBe(false);
    expect(isStyleAllowed('h2', map.top.slateRules)).toBe(true);
  });

  test('regions are independent — the footer has its own list', () => {
    expect(isStyleAllowed('h2', map.foot.slateRules)).toBe(false);
    expect(isStyleAllowed('p', map.foot.slateRules)).toBe(true);
  });

  test('a page-level DENY survives a nested region that re-lists it', () => {
    expect(isStyleAllowed('blockquote', map.mid.slateRules)).toBe(false);
    expect(isStyleAllowed('h2', map.mid.slateRules)).toBe(true);
  });

  test('a nested ALLOW replaces the inherited list, transitively', () => {
    // section allowed p/h2; the column inside it widens to h3.
    expect(isStyleAllowed('h3', map.mid.slateRules)).toBe(false);
    expect(isStyleAllowed('h3', map.deep.slateRules)).toBe(true);
    expect(isStyleAllowed('blockquote', map.deep.slateRules)).toBe(false);
  });

  test('blocks in one region share ONE rules object (payload, not a copy each)', () => {
    expect(map.sec.slateRules).toBe(map.top.slateRules);
  });
});

describe('a frontend that declares nothing', () => {
  const bare = {
    _page: { id: '_page', schema: () => ({ properties: { items: { widget: 'blocks_layout' } } }) },
    slate: { id: 'slate', schema: () => ({ properties: { value: { widget: 'slate' } } }) },
  };
  const map = buildBlockPathMap(
    { blocks: { a: { '@type': 'slate' } }, blocks_layout: { items: ['a'] } },
    bare,
    {},
  );

  test('gets no slateRules key at all — zero payload, today’s behaviour', () => {
    expect('slateRules' in map.a).toBe(false);
    expect(isStyleAllowed('blockquote', map.a.slateRules)).toBe(true);
  });
});

describe('_page declared as a plain object schema', () => {
  // The offline gates (block-sanity discovery, the deploy schema check) read
  // blocksConfig out of JSON, where a `schema()` FUNCTION cannot survive. Every
  // other block type already accepts a plain `blockSchema`; `_page` was read
  // only as `schema?.({intl})`, so from JSON it fell back to the bare default
  // and the page's regions — allowedBlocks and the style rules alike — were
  // invisible to anything running outside the browser.
  const fromJson = JSON.parse(
    JSON.stringify({
      _page: {
        id: '_page',
        blockSchema: {
          properties: {
            items: { widget: 'blocks_layout', disallowedStyles: ['blockquote'] },
          },
        },
      },
      slate: { id: 'slate', blockSchema: { properties: { value: { widget: 'slate' } } } },
    }),
  );

  test('its region rules reach the block path map', () => {
    const map = buildBlockPathMap(
      { blocks: { a: { '@type': 'slate' } }, blocks_layout: { items: ['a'] } },
      fromJson,
      {},
    );
    expect(isStyleAllowed('blockquote', map.a.slateRules)).toBe(false);
    expect(isStyleAllowed('h2', map.a.slateRules)).toBe(true);
  });
});
