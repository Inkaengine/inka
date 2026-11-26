/**
 * find_undeclared_fields (inka#673): the save check now refuses a field no
 * schema declares (#671), but what was stored before stays, renders nothing,
 * and no later edit is blamed for it. This finds them on a live site.
 */
import { describe, it, expect } from 'vitest';
import { sharedBlocksConfig } from '../../tests-playwright/fixtures/shared-block-schemas.js';
import { findUndeclaredFields } from './tools.mjs';

const agent = { getBlockSchemas: async () => ({ page: { regions: [] }, types: sharedBlocksConfig }) };

const doc = (blocks) => ({ '@type': 'Document', title: 'T', blocks, blocks_layout: { items: Object.keys(blocks) } });
const teaser = (extra) => ({ '@type': 'teaser', href: [{ '@id': '/x' }], ...extra });

/** A site holding `pages` by path; search lists those inside `path`, a page of them at a time. */
function siteWith(pages) {
  return {
    async search({ path = '/', limit, start = 0 }) {
      const inside = Object.keys(pages).filter((p) => path === '/' || p === path || p.startsWith(`${path}/`)).sort();
      return { total: inside.length, items: inside.slice(start, start + limit).map((p) => ({ path: p })) };
    },
    async get(path) { return pages[path]; },
  };
}

const SITE = {
  '/news/a': doc({ t: teaser({ align: 'center', colour: 'blue' }) }),
  '/news/b': doc({ t: teaser({ align: 'left' }) }),
  '/news/c': doc({ t: teaser({ styles: { align: 'left' } }) }),
  '/about': doc({ t: teaser({ align: 'right' }) }),
};

describe('findUndeclaredFields', () => {
  it('lists each block type and field no schema declares, with the pages that hold it, and where it belongs', async () => {
    const found = await findUndeclaredFields(agent, siteWith(SITE), { path: '/news' });
    expect(found.fields).toEqual([
      { block: 'teaser', field: 'align', belongsIn: ['styles.align'], pages: ['/news/a', '/news/b'] },
      { block: 'teaser', field: 'colour', pages: ['/news/a'] },
    ]);
    expect(found).toMatchObject({ checked: 3, total: 3 });
    expect(found.next).toBeUndefined();
  });

  it('pages through a section, saying where to start next', async () => {
    const first = await findUndeclaredFields(agent, siteWith(SITE), { path: '/', limit: 2 });
    expect(first).toMatchObject({ checked: 2, total: 4, next: 2 });
    const rest = await findUndeclaredFields(agent, siteWith(SITE), { path: '/', limit: 2, start: first.next });
    expect(rest.next).toBeUndefined();
    // /about and /news/a came first; /news/b and /news/c now.
    expect(rest.fields).toEqual([{ block: 'teaser', field: 'align', belongsIn: ['styles.align'], pages: ['/news/b'] }]);
  });

  it('finds nothing on a section whose blocks hold only what they declare', async () => {
    expect((await findUndeclaredFields(agent, siteWith({ '/ok': SITE['/news/c'] }), { path: '/' })).fields).toEqual([]);
  });
});
