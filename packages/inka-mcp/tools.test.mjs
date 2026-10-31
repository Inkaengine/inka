import { describe, it, expect } from 'vitest';
import { describeBlock, getPage, editPage, movePage, renamePage, deletePage, previewLayout, search } from './tools.mjs';

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
    // Each told how many there are, to share the room for pictures between them.
    const render = async (draft, uid, of) => { drafts.push({ draft, uid, of }); return { image: `png-${drafts.length}`, text: `text-${drafts.length}` }; };
    const d = await describeBlock(agent, noSite, { type: 'columns', render });
    expect(drafts).toEqual([
      { uid: 'example', of: 2, draft: { blocks: { example: { '@type': 'columns', blocks: {}, blocks_layout: { items: [] } } }, blocks_layout: { items: ['example'] } } },
      { uid: 'example', of: 2, draft: { blocks: { example: { '@type': 'columns' } }, blocks_layout: { items: ['example'] } } },
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
  const formData = { '@type': 'Document', title: 'News', modified: 'v1', blocks: { p: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Hi' }] }] } }, blocks_layout: { items: ['p'] } };
  const items = [{ region: 'items', allowedBlocks: ['slate'], isObjectList: false }];
  const docSchemas = async () => ({
    page: { regions: items, contentType: 'Document' },
    types: { Document: { title: 'Page', variations: [], regions: items, blockSchema: { required: [], properties: { title: { title: 'Title' } } } } },
  });
  const lockedAgent = {
    getPage: async () => ({ path: '/news', version: 'v1', formData, lockedBy: jane }),
    getBlockSchemas: docSchemas,
  };

  it('get_page says who holds it', async () => {
    expect((await getPage(lockedAgent)).lockedBy).toEqual(jane);
  });

  it('get_page says nothing of a lock when no one else holds one', async () => {
    const agent = { getPage: async () => ({ path: '/news', version: 'v1', formData, lockedBy: null }), getBlockSchemas: docSchemas };
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

describe('editPage changing a template', () => {
  const formData = {
    '@type': 'Document', title: 'News', modified: 'v1',
    blocks: {
      head: { '@type': 'slate', templateInstanceId: 'i1', readOnly: true, fixed: true, value: [{ type: 'p', children: [{ text: 'Old' }] }] },
      own: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Mine' }] }] },
    },
    blocks_layout: { items: ['head', 'own'] },
  };
  /** An agent recording the order it is asked to do things in. */
  const recording = () => {
    const did = [];
    return {
      did,
      getPage: async () => ({ path: '/news', version: 'v1', formData, blockPathMap: { head: { blockType: 'slate' }, own: { blockType: 'slate' } }, lockedBy: null }),
      getBlockSchemas: async () => ({
        page: { regions: [{ region: 'items', allowedBlocks: ['slate'] }], contentType: 'Document' },
        types: {
          Document: { title: 'Page', regions: [{ region: 'items', allowedBlocks: ['slate'] }], blockSchema: { properties: { title: { title: 'Title' } } } },
          slate: { title: 'Text', blockSchema: { properties: { value: { widget: 'slate' } } }, regions: [] },
        },
      }),
      unlockTemplateOf: async (id) => { did.push(`unlock ${id}`); return formData.blocks[id].templateInstanceId ?? null; },
      update: async ({ id }) => { did.push(`update ${id}`); },
      lockTemplates: async () => { did.push('lock'); return ['/templates/news-layout']; },
      save: async () => { did.push('save'); return { version: 'v2' }; },
    };
  };
  const ops = [{ op: 'update', id: 'head', set: { value: { md: 'New' } } }];

  it('unlocks the templates its operations touch, then locks them ("Change on all pages") before saving the page', async () => {
    const agent = recording();
    const result = await editPage(agent, { ops, expectedVersion: 'v1', changeTemplates: true });
    expect(agent.did).toEqual(['unlock head', 'update head', 'lock', 'save']);
    expect(result.templatesChanged).toEqual(['/templates/news-layout']);
  });

  it('leaves templates alone unless asked', async () => {
    const agent = recording();
    await editPage(agent, { ops, expectedVersion: 'v1' });
    expect(agent.did).toEqual(['update head', 'save']);
  });

  it('a dry run unlocks to show the change, and saves no template', async () => {
    const agent = recording();
    agent.getDraft = async () => formData;
    await editPage(agent, { ops, expectedVersion: 'v1', changeTemplates: true, dryRun: true });
    expect(agent.did).toEqual(['unlock head', 'update head']);
  });
});

describe('get_page: the page is a block of its content type', () => {
  const formData = {
    '@type': 'Document', title: 'News', description: 'What is new', review_state: 'published', modified: 'v1',
    UID: 'abc', '@id': 'http://site/news',
    blocks: {
      p: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Hi' }] }] },
      f: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Footer text' }] }] },
    },
    blocks_layout: { items: ['p'], footer: ['f'] },
  };
  const regions = [
    { region: 'items', allowedBlocks: ['slate'], isObjectList: false },
    { region: 'footer', allowedBlocks: ['slate'], isObjectList: false },
  ];
  const pageAgent = {
    getPage: async () => ({ path: '/news', version: 'v1', formData, lockedBy: null }),
    getBlockSchemas: async () => ({
      page: { regions, contentType: 'Document' },
      types: {
        Document: {
          title: 'Page', contentType: true, variations: [], regions,
          blockSchema: { required: ['title'], properties: { title: { title: 'Title' }, description: { title: 'Summary', widget: 'textarea' }, items: { title: 'Blocks' }, footer: { title: 'Footer' } } },
        },
        slate: { title: 'Text', variations: [], regions: [], blockSchema: { required: [], properties: { value: { widget: 'slate' } } } },
      },
    }),
  };

  it("has the page's own id and type, its fields, and every region's blocks", async () => {
    expect(await getPage(pageAgent)).toEqual({
      path: '/news', version: 'v1',
      '@uid': '_page', '@type': 'Document',
      title: 'News', description: 'What is new',
      blocks: [{ '@uid': 'p', '@type': 'slate', value: { md: 'Hi' } }],
      footer: [{ '@uid': 'f', '@type': 'slate', value: { md: 'Footer text' } }],
    });
  });
});

describe('what the results say of the site', () => {
  it('a text search says what it looked in, as Plone searches it', async () => {
    const site = { search: async () => ({ total: 0, items: [] }) };
    expect(await search(site, { text: 'Riverside' })).toMatchObject({
      total: 0, searched: 'titles, summaries and the text of Text blocks; other blocks\' fields may not be searched',
    });
    expect(await search(site, { types: ['Event'] })).not.toHaveProperty('searched');
  });

  it('a save says the page\'s state, so whether visitors see it now', async () => {
    const formData = { '@type': 'Document', title: 'News', modified: 'v1', review_state: 'published', blocks: {}, blocks_layout: { items: [] } };
    const agent = {
      getPage: async () => ({ path: '/news', version: 'v1', formData, blockPathMap: {}, lockedBy: null }),
      getBlockSchemas: async () => ({ page: { regions: [], contentType: 'Document' }, types: {} }),
      save: async () => ({ version: 'v2' }),
    };
    expect(await editPage(agent, { ops: [], expectedVersion: 'v1' })).toMatchObject({ version: 'v2', reviewState: 'published' });
  });
});
