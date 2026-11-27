/**
 * Discovery scans every item that has blocks, whatever its type. It used to
 * scan a fixed list of types (Document, Folder, Plone Site, News Item, Event),
 * so a site's own type with blocks was never looked at: Inka's Template, which
 * holds a site's layouts, gave no examples, and blocks only a layout carries
 * read as having none. It asks the catalog: the volto.blocks behavior marks its
 * items with IBlocks, indexed as object_provides.
 */
import { afterEach, describe, test, expect, vi } from 'vitest';
import { discoverBlocks } from './discover-blocks.js';

const API = 'http://api.test';

const items = {
  '/': { '@id': `${API}/`, '@type': 'Plone Site', UID: 'root', blocks: {}, blocks_layout: { items: [] } },
  '/templates/layout': {
    '@id': `${API}/templates/layout`, '@type': 'Template', UID: 'layout-1', title: 'A layout',
    blocks: { h1: { '@type': 'heroSearch', title: 'Find a service' } },
    blocks_layout: { items: ['h1'] },
  },
  '/page': {
    '@id': `${API}/page`, '@type': 'Document', UID: 'page-1', title: 'A page',
    blocks: { t1: { '@type': 'title' } },
    blocks_layout: { items: ['t1'] },
  },
  '/photo.png': { '@id': `${API}/photo.png`, '@type': 'Image', UID: 'photo-1', title: 'A photo' },
};

const respond = (body, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

afterEach(() => vi.unstubAllGlobals());

describe('the pages discovery scans', () => {
  test('every item with blocks, whatever its type; none without', async () => {
    const asked = [];
    vi.stubGlobal('fetch', (url) => {
      const { pathname } = new URL(url);
      asked.push(pathname);
      if (pathname === '/@search') {
        const listed = Object.values(items).filter((i) => i['@type'] !== 'Plone Site');
        const provides = new URL(url).searchParams.get('object_provides');
        if (provides === null) return respond({ items: listed });
        expect(provides).toBe('plone.restapi.behaviors.IBlocks');
        return respond({ items: listed.filter((i) => i.blocks_layout) });
      }
      return items[pathname] ? respond(items[pathname]) : respond({ message: 'Not found' }, 404);
    });

    const found = await discoverBlocks(API);
    const where = Object.fromEntries(found.filter((b) => b.blockType).map((b) => [b.blockType, b.pagePath]));

    expect(where).toMatchObject({ heroSearch: '/templates/layout', title: '/page' });
    // The Image has no blocks: the search leaves it out, so it isn't fetched.
    expect(asked).not.toContain('/photo.png');
  });
});
