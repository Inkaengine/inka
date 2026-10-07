import { describe, it, expect } from 'vitest';
import { describeBlock } from './tools.mjs';

const schemas = {
  page: { regions: [{ region: 'items', isObjectList: false, allowedBlocks: ['teaser', 'columns'], defaultBlockType: null, maxLength: null }] },
  types: {
    teaser: { title: 'Teaser', variations: [], blockSchema: { required: ['href'], properties: { href: { title: 'Target', widget: 'object_browser' } } }, regions: [] },
    columns: { title: 'Columns', variations: [], blockSchema: { required: [], properties: {} }, regions: [] },
  },
};
const agent = { getBlockSchemas: async () => schemas };

describe('describeBlock', () => {
  it('takes its example from a page using the type, nested blocks included', async () => {
    const page = {
      blocks: { cols: { '@type': 'columns', blocks: { t1: { '@type': 'teaser', href: [{ '@id': '/events' }] } } } },
      blocks_layout: { items: ['cols'] },
    };
    const site = {
      search: async (q) => (q.blockTypes[0] === 'teaser' ? { total: 1, items: [{ path: '/news' }] } : { total: 0, items: [] }),
      get: async (path) => (path === '/news' ? page : null),
    };
    const d = await describeBlock(agent, site, { type: 'teaser' });
    expect(d.fields.href).toMatchObject({ widget: 'object_browser', required: true });
    expect(d.example).toEqual({ from: '/news', block: { '@uid': 't1', '@type': 'teaser', href: [{ '@id': '/events' }] } });
  });

  it('says so when no page uses the type yet', async () => {
    const site = { search: async () => ({ total: 0, items: [] }), get: async () => { throw new Error('not called'); } };
    const d = await describeBlock(agent, site, { type: 'teaser' });
    expect(d.example).toBeNull();
    expect(d.exampleNote).toMatch(/no page on the site uses a teaser block yet/);
  });
});
