import { describe, it, expect } from 'vitest';
import { describeBlock } from './tools.mjs';

const schemas = {
  page: { regions: [{ region: 'items', isObjectList: false, allowedBlocks: ['teaser', 'columns'], defaultBlockType: null, maxLength: null }] },
  types: {
    teaser: { title: 'Teaser', variations: [], blockSchema: { required: ['href'], properties: { href: { title: 'Target', widget: 'object_browser' } } }, regions: [] },
    columns: {
      title: 'Columns', variations: [], blockSchema: { required: [], properties: {} }, regions: [],
      examples: [
        { title: 'Two columns', block: { '@type': 'columns', blocks: {}, blocks_layout: { items: [] } } },
        { title: 'Empty', block: { '@type': 'columns' } },
      ],
    },
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
    expect(d.siteExample).toEqual({ from: '/news', block: { '@uid': 't1', '@type': 'teaser', href: [{ '@id': '/events' }] } });
  });

  it('says so when no page uses the type yet', async () => {
    const site = { search: async () => ({ total: 0, items: [] }), get: async () => { throw new Error('not called'); } };
    const d = await describeBlock(agent, site, { type: 'teaser' });
    expect(d.siteExample).toBeNull();
    expect(d.siteExampleNote).toMatch(/no page on the site uses a teaser block yet/);
  });

  const noSite = { search: async () => ({ total: 0, items: [] }), get: async () => { throw new Error('not called'); } };

  it("renders each of the front end's examples on its own, when asked", async () => {
    const drafts = [];
    const render = async (draft, uid) => { drafts.push({ draft, uid }); return { image: `png-${drafts.length}`, text: `text-${drafts.length}` }; };
    const d = await describeBlock(agent, noSite, { type: 'columns', render });
    expect(drafts).toEqual([
      { uid: 'example', draft: { blocks: { example: { '@type': 'columns', blocks: {}, blocks_layout: { items: [] } } }, blocks_layout: { items: ['example'] } } },
      { uid: 'example', draft: { blocks: { example: { '@type': 'columns' } }, blocks_layout: { items: ['example'] } } },
    ]);
    expect(d.examples.map((e) => e.rendered)).toEqual([{ image: 'png-1', text: 'text-1' }, { image: 'png-2', text: 'text-2' }]);
  });

  it('refuses to render a type whose front end declares no examples', async () => {
    await expect(describeBlock(agent, noSite, { type: 'teaser', render: async () => ({}) }))
      .rejects.toThrow(/the front end declares no examples of teaser to render/);
  });
});
