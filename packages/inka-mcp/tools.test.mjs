import { describe, it, expect } from 'vitest';
import { describeBlock, getPage, editPage, movePage, renamePage, deletePage, previewLayout } from './tools.mjs';

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

describe('a page someone else is editing', () => {
  const jane = { user: 'Jane Doe', since: '2026-10-27T10:42:00+00:00' };
  const formData = { title: 'News', modified: 'v1', blocks: { p: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Hi' }] }] } }, blocks_layout: { items: ['p'] } };
  const lockedAgent = {
    getPage: async () => ({ path: '/news', version: 'v1', formData, lockedBy: jane }),
    getBlockSchemas: async () => { throw new Error('not reached'); },
  };

  it('get_page says who holds it', async () => {
    expect((await getPage(lockedAgent)).lockedBy).toEqual(jane);
  });

  it('get_page says nothing of a lock when no one else holds one', async () => {
    const agent = { getPage: async () => ({ path: '/news', version: 'v1', formData, lockedBy: null }) };
    expect(await getPage(agent)).not.toHaveProperty('lockedBy');
  });

  it('edit_blocks refuses to save, naming who and since when', async () => {
    await expect(editPage(lockedAgent, { ops: [], expectedVersion: 'v1' }))
      .rejects.toThrow(/\/news is being edited by Jane Doe since 2026-10-27T10:42:00\+00:00/);
  });

  it('move, rename and delete refuse it too', async () => {
    const site = { status: async () => ({ version: 'v1', lockedBy: jane }) };
    for (const act of [
      () => movePage(site, { path: '/news', target: '/archive', expectedVersion: 'v1' }),
      () => renamePage(site, { path: '/news', title: 'Old news', expectedVersion: 'v1' }),
      () => deletePage(site, { path: '/news', expectedVersion: 'v1' }),
    ]) {
      await expect(act()).rejects.toThrow(/being edited by Jane Doe/);
    }
  });
});

describe('previewLayout', () => {
  const page = { title: 'News', modified: 'v1', blocks: { t: { '@type': 'title' } }, blocks_layout: { items: ['t'] } };
  const layoutAgent = {
    getDraft: async () => page,
    getBlockSchemas: async () => ({
      page: schemas.page,
      types: { ...schemas.types, slate: { title: 'Text', variations: [], blockSchema: { required: [], properties: { value: { widget: 'slate' } } }, regions: [] } },
    }),
  };
  let n = 0;
  const mintId = () => `new-${++n}`;

  it('renders the page with the proposed blocks in place of its own, saving nothing', async () => {
    let drafted;
    const rendered = await previewLayout(layoutAgent, {
      blocks: [{ '@type': 'teaser', href: [{ '@id': '/events' }] }, { '@type': 'slate', value: 'A *new* intro' }],
      render: async (draft) => { drafted = draft; return { image: 'png', text: 'A new intro' }; },
      mintId,
    });
    expect(rendered).toEqual({ image: 'png', text: 'A new intro' });
    expect(drafted.title).toBe('News');
    expect(drafted.blocks_layout.items).toHaveLength(2);
    const [first, second] = drafted.blocks_layout.items.map((id) => drafted.blocks[id]);
    expect(first).toMatchObject({ '@type': 'teaser', href: [{ '@id': '/events' }] });
    expect(second['@type']).toBe('slate');
    const textOf = (node) => node.text ?? (node.children ?? []).map(textOf).join('');
    expect(textOf(second.value[0])).toBe('A new intro');
  });

  it('refuses a block type the page has no config for', async () => {
    await expect(previewLayout(layoutAgent, { blocks: [{ '@type': 'ghost' }], render: async () => ({}), mintId }))
      .rejects.toThrow(/no block type "ghost"/);
  });
});
