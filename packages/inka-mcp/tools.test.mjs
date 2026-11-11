import { describe, it, expect } from 'vitest';
import { fillNewPage, describeBlock, getPage, editPage, movePage, renamePage, deletePage, previewLayout, search, listChildren, getTransitions, transitionPage, editTarget, contentTypes } from './tools.mjs';

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

/** A change the validator accepts (checkDraft.test.mjs tests the check itself). */
const passes = async () => {};
/** A change the validator refuses. */
const refuses = async () => { throw new Error('the change would leave the page invalid: block s has no id'); };

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
    await expect(editPage(lockedAgent, { ops: [], expectedVersion: 'v1', check: passes }))
      .rejects.toThrow(/\/news is being edited by Jane Doe since 2026-10-27T10:42:00\+00:00/);
  });

  it('move, rename and delete refuse it too', async () => {
    const site = { status: async () => ({ version: 'v1', lockedBy: jane }), draftOf: async () => null };
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
    getPage: async () => ({ path: '/news', formData: page }),
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
      check: passes,
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
    await expect(previewLayout(layoutAgent, { blocks: [{ '@type': 'ghost' }], render: async () => ({}), mintId, check: passes }))
      .rejects.toThrow(/no block type "ghost"/);
  });

  it('renders nothing of a layout the validator refuses', async () => {
    let rendered = false;
    await expect(previewLayout(layoutAgent, {
      blocks: [{ '@type': 'teaser' }], render: async () => { rendered = true; return {}; }, mintId, check: refuses,
    })).rejects.toThrow(/would leave the page invalid/);
    expect(rendered).toBe(false);
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
      getBlock: async (id) => structuredClone(formData.blocks[id]),
      replace: async ({ id }) => { did.push(`update ${id}`); },
      lockTemplates: async () => { did.push('lock'); return ['/templates/news-layout']; },
      save: async () => { did.push('save'); return { version: 'v2' }; },
      getDraft: async () => formData,
    };
  };
  const ops = [{ op: 'update', id: 'head', set: { value: { md: 'New' } } }];

  it('unlocks the templates its operations touch, then locks them ("Change on all pages") before saving the page', async () => {
    const agent = recording();
    const result = await editPage(agent, { ops, expectedVersion: 'v1', changeTemplates: true, check: passes });
    expect(agent.did).toEqual(['unlock head', 'update head', 'lock', 'save']);
    expect(result.templatesChanged).toEqual(['/templates/news-layout']);
  });

  it('leaves templates alone unless asked', async () => {
    const agent = recording();
    await editPage(agent, { ops, expectedVersion: 'v1', check: passes });
    expect(agent.did).toEqual(['update head', 'save']);
  });

  it('a change the validator refuses is neither previewed nor saved, nor any template', async () => {
    const agent = recording();
    let rendered = false;
    await expect(editPage(agent, { ops, expectedVersion: 'v1', changeTemplates: true, check: refuses }))
      .rejects.toThrow(/would leave the page invalid/);
    await expect(editPage(agent, {
      ops, expectedVersion: 'v1', dryRun: true, check: refuses, render: async () => { rendered = true; return {}; },
    })).rejects.toThrow(/would leave the page invalid/);
    expect(agent.did).not.toContain('save');
    expect(agent.did).not.toContain('lock');
    expect(rendered).toBe(false);
  });

  it('a dry run unlocks to show the change, and saves no template', async () => {
    const agent = recording();
    agent.getDraft = async () => formData;
    await editPage(agent, { ops, expectedVersion: 'v1', changeTemplates: true, dryRun: true, check: passes });
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
    const site = { search: async () => ({ total: 0, items: [] }), pagesWithDrafts: async () => [] };
    expect(await search(site, { text: 'Riverside' })).toMatchObject({
      total: 0, searched: 'titles, summaries and the text of Text blocks; other blocks\' fields may not be searched',
    });
    expect(await search(site, { types: ['Event'] })).not.toHaveProperty('searched');
  });

  it('searches by state alone, for what is not live yet', async () => {
    const asked = [];
    const site = { search: async (query) => { asked.push(query); return { total: 0, items: [] }; }, pagesWithDrafts: async () => [] };
    await search(site, { reviewState: ['private'] });
    expect(asked[0].reviewState).toEqual(['private']);
    await expect(search(site, {})).rejects.toThrow(/"text", "types", "reviewState" or "hasDraft"/);
  });

  describe('a page with a draft', () => {
    const news = { path: '/news', title: 'News', reviewState: 'published' };
    const site = (found = {}) => ({
      search: async () => ({
        total: 2,
        items: [{ path: '/copy_of_news', title: 'News', isDraft: true, reviewState: 'private' }, news, { path: '/about', title: 'About', reviewState: 'published' }],
        ...found,
      }),
      pagesWithDrafts: async () => [news],
    });

    it.each([['search', search, { text: 'x' }], ['list_children', listChildren, { path: '/' }]])('%s lists it once, as the page, saying it has one', async (_name, tool, args) => {
      const { items, total } = await tool(site({ total: 3 }), args);
      expect(items).toEqual([{ ...news, hasDraft: true }, { path: '/about', title: 'About', reviewState: 'published' }]);
      expect(total).toBe(2);
    });

    it('is found by that state alone', async () => {
      const asked = [];
      const s = { ...site(), search: async (q) => { asked.push(q); return { total: 0, items: [] }; } };
      expect(await search(s, { hasDraft: true })).toEqual({ total: 1, items: [{ ...news, hasDraft: true }] });
      expect(asked).toEqual([]);
    });

    it('is found alongside other states, each page once', async () => {
      const newPage = { path: '/open-day', title: 'Open day', reviewState: 'private' };
      const s = site({ total: 2, items: [{ path: '/copy_of_news', title: 'News', isDraft: true, reviewState: 'private' }, newPage] });
      const { items, total } = await search(s, { hasDraft: true, reviewState: ['private'] });
      expect(items).toEqual([{ ...news, hasDraft: true }, newPage]);
      expect(total).toBe(2);
    });

    it('is narrowed to a section', async () => {
      expect(await search(site(), { hasDraft: true, path: '/archive' })).toEqual({ total: 0, items: [] });
      expect((await search(site(), { hasDraft: true, path: '/' })).total).toBe(1);
    });

    it('can\'t be combined with text or types', async () => {
      await expect(search(site(), { hasDraft: true, text: 'x' })).rejects.toThrow(/"hasDraft" goes with "reviewState"/);
    });
  });
});

describe('files an agent staged (stage_media) in a page change', () => {
  const PNG = { name: 'a.png', type: 'image/png', data: 'iVBORw0KGgo' };
  const PDF = { name: 'r.pdf', type: 'application/pdf', data: 'JVBERg==' };
  const files = { 'media:a': PNG, 'media:b': PDF };
  const heldFile = async (id) => files[id];

  /** An agent whose editor holds what it is handed, as `inka-pending:<n>`, and keeps the page's blocks. */
  const editing = () => {
    const did = [];
    const formData = {
      '@type': 'Document', title: 'News', modified: 'v1', review_state: 'private',
      blocks: { img: { '@type': 'image', url: '' } }, blocks_layout: { items: ['img'] },
    };
    let n = 0;
    const held = {};
    return {
      did,
      formData,
      getPage: async () => ({ path: '/news', version: 'v1', formData, blockPathMap: { _page: { blockType: 'Document' }, img: { blockType: 'image' } }, lockedBy: null }),
      getDraft: async () => formData,
      getBlockSchemas: async () => ({
        page: { regions: [{ region: 'items', allowedBlocks: ['image'] }], contentType: 'Document' },
        types: {
          Document: {
            title: 'Page', regions: [{ region: 'items', allowedBlocks: ['image'] }],
            // Its lead image, as Plone describes a file field (volto.preview_image).
            blockSchema: { properties: { title: { title: 'Title' }, preview_image: { type: 'object', factory: 'Image', widget: 'file' } } },
          },
          image: { title: 'Image', blockSchema: { properties: { url: { widget: 'image' }, href: { widget: 'object_browser' } } }, regions: [] },
        },
      }),
      // Save uploads each held file beside the page, by its own name.
      holdFile: async (file) => { did.push(`hold ${file.name}`); const ref = `inka-pending:${++n}`; held[ref] = `http://site/news/${file.name}`; return ref; },
      getBlock: async (id) => structuredClone(id === '_page' ? formData : formData.blocks[id]),
      replace: async ({ id, block }) => {
        did.push(`update ${id}`);
        if (id === '_page') Object.assign(formData, block); else formData.blocks[id] = block;
      },
      insert: async ({ block }) => { did.push('insert'); formData.blocks.added = block; formData.blocks_layout.items.push('added'); return 'added'; },
      save: async () => { did.push('save'); return { version: 'v2', uploaded: held }; },
    };
  };
  const ops = [
    { op: 'update', id: 'img', set: { url: 'media:a' } },
    { op: 'add', after: 'img', blocks: [{ '@type': 'image', url: 'media:a', href: [{ '@id': 'media:b' }] }] },
  ];

  it("holds each file the operations name once, and runs them with the editor's references", async () => {
    const agent = editing();
    let checked;
    await editPage(agent, { ops, expectedVersion: 'v1', dryRun: true, check: async ({ held }) => { checked = held; }, heldFile });
    expect(agent.did).toEqual(['hold a.png', 'hold r.pdf', 'update img', 'insert']);
    // The check is told which references the save makes real, and only those.
    expect([...checked]).toEqual(['inka-pending:1', 'inka-pending:2']);
    expect(agent.formData.blocks.img.url).toBe('inka-pending:1');
    expect(agent.formData.blocks.added).toMatchObject({ url: 'inka-pending:1', href: [{ '@id': 'inka-pending:2' }] });
  });

  it('a dry run shows the agent its own media ids, not the editor\'s references', async () => {
    const dry = await editPage(editing(), { ops, expectedVersion: 'v1', dryRun: true, check: passes, heldFile });
    const page = JSON.stringify(dry.page);
    expect(page).toContain('"media:a"');
    expect(page).toContain('"media:b"');
    expect(page).not.toContain('inka-pending:');
  });

  it('a save says which item each file became, for the agent to use from then on', async () => {
    const agent = editing();
    const saved = await editPage(agent, { ops, expectedVersion: 'v1', check: passes, heldFile });
    expect(agent.did.at(-1)).toBe('save');
    expect(saved.media).toEqual({ 'media:a': 'http://site/news/a.png', 'media:b': 'http://site/news/r.pdf' });
  });

  it('a preview shows new files: the front end is handed each as a data: URL, in place of its reference', async () => {
    const agent = editing();
    let drafted;
    const dry = await editPage(agent, {
      ops, expectedVersion: 'v1', dryRun: true, check: passes, heldFile,
      render: async (draft) => { drafted = draft; return { image: 'png', text: '' }; },
    });
    expect(dry.rendered).toEqual({ image: 'png', text: '' });
    expect(drafted.blocks.img.url).toBe(`data:image/png;base64,${PNG.data}`);
    expect(drafted.blocks.added.href).toEqual([{ '@id': `data:application/pdf;base64,${PDF.data}` }]);
    expect(JSON.stringify(drafted)).not.toContain('inka-pending:');
    // The editor still names them by reference; only the picture's draft is swapped.
    expect(agent.formData.blocks.img.url).toBe('inka-pending:1');
  });

  it('a file a save already uploaded is that item from then on: nothing is held or uploaded again', async () => {
    const agent = editing();
    const uploaded = async (id) => (id === 'media:a'
      ? { name: 'a.png', type: 'image/png', uploaded: 'http://site/news/a.png' }
      : heldFile(id));
    const saved = await editPage(agent, { ops, expectedVersion: 'v1', check: passes, heldFile: uploaded });
    expect(agent.did).toEqual(['hold r.pdf', 'update img', 'insert', 'save']);
    expect(agent.formData.blocks.img.url).toBe('http://site/news/a.png');
    expect(saved.media).toEqual({ 'media:a': 'http://site/news/a.png', 'media:b': 'http://site/news/r.pdf' });
  });

  it('a server that keeps no files says so', async () => {
    await expect(editPage(editing(), { ops, expectedVersion: 'v1', check: passes, heldFile: null }))
      .rejects.toThrow(/keeps no files/);
  });

  it('preview_layout shows new files too, each as a data: URL', async () => {
    let drafted;
    await previewLayout(editing(), {
      blocks: [{ '@type': 'image', url: 'media:a' }], mintId: () => 'x', check: passes, heldFile,
      render: async (draft) => { drafted = draft; return {}; },
    });
    expect(drafted.blocks.x.url).toBe(`data:image/png;base64,${PNG.data}`);
  });

  // A page's own file field (its lead image) keeps the file in the page, as
  // Plone does: the field takes the file itself, nothing is held or uploaded.
  describe("a page's own file field", () => {
    const lead = [{ op: 'update', id: '_page', set: { preview_image: 'media:a' } }];

    it('takes the file itself, as the edit form sets it', async () => {
      const agent = editing();
      const saved = await editPage(agent, { ops: lead, expectedVersion: 'v1', check: passes, heldFile });
      expect(agent.did).toEqual(['update _page', 'save']);
      expect(agent.formData.preview_image).toEqual({ data: PNG.data, encoding: 'base64', 'content-type': 'image/png', filename: 'a.png' });
      // It became no item of its own.
      expect(saved.media).toEqual({});
    });

    it('a dry run shows the agent its media id, not the file', async () => {
      const dry = await editPage(editing(), { ops: lead, expectedVersion: 'v1', dryRun: true, check: passes, heldFile });
      expect(dry.page.preview_image).toBe('media:a');
      expect(JSON.stringify(dry.page)).not.toContain(PNG.data);
    });

    it('a preview hands the front end the file as a stored one reads, its download a data: URL', async () => {
      let drafted;
      await editPage(editing(), {
        ops: lead, expectedVersion: 'v1', dryRun: true, check: passes, heldFile,
        render: async (draft) => { drafted = draft; return { image: 'png', text: '' }; },
      });
      expect(drafted.preview_image).toEqual({ filename: 'a.png', 'content-type': 'image/png', download: `data:image/png;base64,${PNG.data}` });
    });

    it('a file a save made an item of is refused: the field needs the file again', async () => {
      const uploaded = async () => ({ name: 'a.png', type: 'image/png', uploaded: 'http://site/news/a.png' });
      await expect(editPage(editing(), { ops: lead, expectedVersion: 'v1', check: passes, heldFile: uploaded }))
        .rejects.toThrow(/media:a is already on the site, as http:\/\/site\/news\/a\.png.*stage it again/);
    });
  });

  it('preview_layout shows a file an earlier save uploaded as that item', async () => {
    let drafted;
    await previewLayout(editing(), {
      blocks: [{ '@type': 'image', url: 'media:a' }], mintId: () => 'x', check: passes,
      heldFile: async () => ({ name: 'a.png', type: 'image/png', uploaded: 'http://site/news/a.png' }),
      render: async (draft) => { drafted = draft; return {}; },
    });
    expect(drafted.blocks.x.url).toBe('http://site/news/a.png');
  });

  it('preview_layout on a server that keeps no files says so', async () => {
    await expect(previewLayout(editing(), {
      blocks: [{ '@type': 'image', url: 'media:a' }], mintId: () => 'x', check: passes, heldFile: null, render: async () => ({}),
    })).rejects.toThrow(/keeps no files/);
  });
});

describe('a new page given its first blocks', () => {
  const passes = async () => {};
  /** A page in its editor, starting with `start` (uid: block), with text blocks and a title block. */
  const created = (start) => {
    const did = [];
    const formData = { '@type': 'Document', title: 'New', modified: 'v1', blocks: { ...start }, blocks_layout: { items: Object.keys(start) } };
    const blockType = { blockSchema: { properties: { value: { widget: 'slate' } } }, regions: [] };
    return {
      did,
      formData,
      getPage: async () => ({
        path: '/new', version: 'v1', formData, lockedBy: null,
        blockPathMap: { _page: { blockType: 'Document' }, ...Object.fromEntries(Object.entries(formData.blocks).map(([uid, b]) => [uid, { blockType: b['@type'] }])) },
      }),
      getDraft: async () => formData,
      getBlockSchemas: async () => ({
        page: { regions: [{ region: 'items', allowedBlocks: ['slate', 'title'] }], contentType: 'Document' },
        types: {
          Document: { title: 'Page', regions: [{ region: 'items', allowedBlocks: ['slate', 'title'] }], blockSchema: { properties: { title: { title: 'Title' } } } },
          slate: { title: 'Text', ...blockType },
          title: { title: 'Title', blockSchema: { properties: {} }, regions: [] },
        },
      }),
      insert: async ({ block }) => {
        did.push('insert');
        const uid = `added-${did.length}`;
        formData.blocks[uid] = block;
        formData.blocks_layout.items.push(uid);
        return uid;
      },
      remove: async (uid) => {
        did.push(`remove ${uid}`);
        delete formData.blocks[uid];
        formData.blocks_layout.items = formData.blocks_layout.items.filter((id) => id !== uid);
      },
      save: async () => { did.push('save'); return { version: 'v2', uploaded: {} }; },
    };
  };
  const fill = (agent) => fillNewPage(agent, { blocks: [{ '@uid': 'intro', '@type': 'slate', value: 'Hello' }], mintId: () => 'minted', check: passes });

  it('replaces the empty block the add form leaves to type in', async () => {
    const agent = created({ title: { '@type': 'title' }, empty: { '@type': 'slate', value: [{ type: 'p', children: [{ text: '' }] }] } });
    await fill(agent);
    expect(agent.did).toEqual(['insert', 'remove empty', 'save']);
  });

  it('replaces one with no value yet, as a type with no starting blocks gets', async () => {
    const agent = created({ empty: { '@type': 'slate' } });
    await fill(agent);
    expect(agent.did).toEqual(['insert', 'remove empty', 'save']);
  });

  it('keeps a title block, which holds nothing but draws the title', async () => {
    const agent = created({ title: { '@type': 'title' } });
    await fill(agent);
    expect(agent.did).toEqual(['insert', 'save']);
  });

  it('keeps a block with something in it', async () => {
    const agent = created({ text: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Kept' }] }] } });
    await fill(agent);
    expect(agent.did).toEqual(['insert', 'save']);
  });

  it("keeps a template's empty block", async () => {
    const agent = created({ slot: { '@type': 'slate', fixed: true, slotId: 'a', templateId: '/t', value: [{ type: 'p', children: [{ text: '' }] }] } });
    await fill(agent);
    expect(agent.did).toEqual(['insert', 'save']);
  });
});

describe("get_page shows the site's links as paths", () => {
  const API = 'https://site-api.example';
  const read = async (block) => {
    const formData = {
      '@type': 'Document', title: 'News', modified: 'v1',
      blocks: { b: block }, blocks_layout: { items: ['b'] },
    };
    const page = await getPage({
      getPage: async () => ({ path: '/news', version: 'v1', formData, lockedBy: null, apiPath: API }),
      getBlockSchemas: async () => ({
        page: { contentType: 'Document' },
        types: {
          Document: { title: 'Page', regions: [], blockSchema: { properties: { title: { title: 'Title' } } } },
          slate: { title: 'Text', regions: [], blockSchema: { properties: { value: { widget: 'slate' } } } },
          button: { title: 'Button', regions: [], blockSchema: { properties: { href: { widget: 'object_browser' }, title: {} } } },
        },
      }),
    });
    return page.blocks[0];
  };
  const link = (url) => ({ '@type': 'slate', value: [{ type: 'p', children: [{ type: 'link', data: { url }, children: [{ text: 'here' }] }] }] });

  it('in rich text', async () => {
    expect((await read(link(`${API}/blog/post`))).value.md).toBe('[here](/blog/post)');
  });

  it('in a link field', async () => {
    expect((await read({ '@type': 'button', title: 'Go', href: [{ '@id': `${API}/contact` }] })).href).toEqual([{ '@id': '/contact' }]);
  });

  it('to the site root', async () => {
    expect((await read({ '@type': 'button', title: 'Home', href: [{ '@id': API }] })).href).toEqual([{ '@id': '/' }]);
  });

  it('leaves another site alone, even one whose name starts the same', async () => {
    expect((await read(link(`${API}.other.example/x`))).value.md).toBe(`[here](${API}.other.example/x)`);
    expect((await read(link('https://inka.sh/pricing'))).value.md).toBe('[here](https://inka.sh/pricing)');
  });
});

describe('transitions', () => {
  const FORM = { schema: { properties: { effective: { title: 'Publishing date' } } }, data: {} };
  const site = (over = {}) => {
    const did = [];
    return {
      did,
      state: async () => ({
        state: { name: 'private', label: 'Private' },
        transitions: [{ id: 'publish', label: 'Publish' }, { id: 'checkout', label: 'Work on a draft copy', relocates: true }],
        effective: { canPublish: true },
      }),
      stateForms: async () => ({
        publish: FORM,
        checkout: { schema: { properties: {} }, data: {} },
        update: { schema: { properties: { Reader: { title: 'Can view' } } }, data: { Reader: ['staff'] } },
      }),
      status: async () => ({ version: 'v1', lockedBy: null }),
      transition: async (op) => { did.push(op); return null; },
      get: async () => ({ review_state: 'published', modified: 'v2' }),
      draftOf: async () => null,
      adminUrl: async (path) => `https://admin.example${path}`,
      ...over,
    };
  };

  it('lists each with what it can set, and sharing as staying in the same state', async () => {
    const got = await getTransitions(site(), { path: '/news' });
    expect(got).toMatchObject({ path: '/news', version: 'v1', state: { name: 'private' } });
    // What is on offer is the whole answer: "may publish" read false on a published page, and an agent
    // told a person they couldn't publish, then did.
    expect(got).not.toHaveProperty('may');
    expect(got.transitions).toEqual([
      { id: 'publish', label: 'Publish', takes: FORM.schema.properties, current: {} },
      { id: 'checkout', label: 'Work on a draft copy', takes: {}, current: {} },
      { id: 'update', label: 'Update — stays Private', takes: { Reader: { title: 'Can view' } }, current: { Reader: ['staff'] } },
    ]);
  });

  it('takes one, with its settings, and says where the page now stands', async () => {
    const s = site();
    const data = { effective: '2027-01-01T09:00:00' };
    expect(await transitionPage(s, { path: '/news', id: 'publish', data, expectedVersion: 'v1' }))
      .toEqual({ path: '/news', reviewState: 'published', version: 'v2' });
    expect(s.did).toEqual([{ path: '/news', id: 'publish', data }]);
  });

  it('reports the path a transition moved the page to', async () => {
    const reads = [];
    const s = site({
      transition: async () => ({ redirect: '/latest' }),
      get: async (path) => { reads.push(path); return { review_state: 'published', modified: 'v9' }; },
    });
    expect(await transitionPage(s, { path: '/news', id: 'publish', data: { id: 'latest' }, expectedVersion: 'v1' }))
      .toEqual({ path: '/latest', reviewState: 'published', version: 'v9' });
    expect(reads).toEqual(['/latest']);
  });

  it('refuses a page that has changed since it was read, and takes nothing', async () => {
    const s = site();
    await expect(transitionPage(s, { path: '/news', id: 'publish', expectedVersion: 'v0' })).rejects.toThrow(/has changed since/);
    expect(s.did).toEqual([]);
  });

  it('refuses a page someone else is editing, and takes nothing', async () => {
    const s = site({ status: async () => ({ version: 'v1', lockedBy: { user: 'Ann', since: 'now' } }) });
    await expect(transitionPage(s, { path: '/news', id: 'publish', expectedVersion: 'v1' })).rejects.toThrow(/Ann/);
    expect(s.did).toEqual([]);
  });

  describe('on a page with a draft', () => {
    const versions = { '/news': 'live-v', '/copy_of_news': 'draft-v' };
    const withDraft = (over = {}) => site({
      state: async () => ({
        state: { name: 'published', label: 'Published' },
        draft: { path: '/copy_of_news' },
        transitions: [{ id: 'checkin', label: 'Publish the draft', relocates: true }],
      }),
      stateForms: async () => ({ checkin: { schema: { properties: {} }, data: {} } }),
      status: async (path) => ({ version: versions[path], lockedBy: null }),
      draftOf: async (path) => (path === '/news' ? '/copy_of_news' : null),
      ...over,
    });

    it('lists it as the page\'s state, with the draft\'s version, which is what gets edited', async () => {
      const got = await getTransitions(withDraft(), { path: '/news' });
      expect(got).toMatchObject({ path: '/news', version: 'draft-v', draft: { url: 'https://admin.example/copy_of_news' } });
      expect(got.transitions[0]).not.toHaveProperty('relocates');
    });

    it('checks the draft\'s version when taking a transition', async () => {
      await expect(transitionPage(withDraft(), { path: '/news', id: 'checkin', expectedVersion: 'live-v' })).rejects.toThrow(/has changed since/);
      const s = withDraft({ transition: async () => ({ redirect: '/news' }) });
      await transitionPage(s, { path: '/news', id: 'checkin', expectedVersion: 'draft-v' });
    });

    it('stays on the page after making a draft, reporting the draft and its version to edit', async () => {
      let drafted = false;
      const made = site({
        transition: async () => { drafted = true; return { redirect: '/copy_of_news' }; },
        draftOf: async () => (drafted ? '/copy_of_news' : null),
        status: async (path) => ({ version: path === '/copy_of_news' ? 'draft-v' : 'v1', lockedBy: null }),
      });
      expect(await transitionPage(made, { path: '/news', id: 'checkout', expectedVersion: 'v1' }))
        .toEqual({ path: '/news', reviewState: 'published', version: 'draft-v', draft: { url: 'https://admin.example/copy_of_news' } });
    });

    it.each([
      ['move', movePage, { path: '/news', target: '/archive', expectedVersion: 'draft-v' }],
      ['rename', renamePage, { path: '/news', id: 'latest', expectedVersion: 'draft-v' }],
      ['delete', deletePage, { path: '/news', expectedVersion: 'draft-v' }],
    ])('refuses to %s it until the draft is published or discarded', async (_what, tool, args) => {
      await expect(tool(withDraft(), args)).rejects.toThrow(/has a draft/);
    });
  });
});

describe('what an edit reaches', () => {
  const draft = { path: '/copy_of_news', url: 'https://admin.example/copy_of_news' };

  it('is the draft if there is one, unless the live page is asked for', () => {
    expect(editTarget('/news', draft)).toBe('/copy_of_news');
    expect(editTarget('/news', draft, true)).toBe('/news');
  });

  it('is the page if it has no draft', () => {
    expect(editTarget('/news', null)).toBe('/news');
    expect(editTarget('/news', null, true)).toBe('/news');
  });
});

// Which content types there are, and which go where, is each site's: an agent
// reads them from the site rather than being told a type by name (#663).
describe('contentTypes', () => {
  it("lists the types the site lets this user add in the section, by id and title", async () => {
    const site = {
      addableTypes: async (path) => {
        expect(path).toBe('/news');
        return [{ id: 'NewsArticle', title: 'News article' }, { id: 'Event', title: 'Event' }];
      },
    };
    expect(await contentTypes(site, { path: '/news' })).toEqual({
      path: '/news',
      types: [{ id: 'NewsArticle', title: 'News article' }, { id: 'Event', title: 'Event' }],
    });
  });
});

describe('move_page: where a page goes in its section', () => {
  /** A site whose sections hold pages in order; `order` is the admin's reorder (Volto's orderContent). */
  function orderedSite(sections) {
    const calls = [];
    const parentOf = (p) => p.replace(/\/[^/]+$/, '') || '/';
    const site = {
      calls,
      status: async () => ({ version: 'v1', lockedBy: null }),
      draftOf: async () => null,
      async search({ path, depth, limit, start = 0 }) {
        expect(depth).toBe(1);
        const items = (sections[path] ?? []).map((p) => ({ path: p }));
        return { total: items.length, items: items.slice(start, start + limit) };
      },
      async move({ path, target }) {
        calls.push(['move', path, target]);
        const moved = `${target === '/' ? '' : target}/${path.split('/').pop()}`;
        sections[parentOf(path)] = sections[parentOf(path)].filter((p) => p !== path);
        sections[target] = [...(sections[target] ?? []), moved];
        return moved;
      },
      async order(op) { calls.push(['order', op]); },
    };
    return site;
  }
  const about = () => ({ '/about': ['/about/team', '/about/history', '/about/contact', '/about/jobs'] });

  it('puts a page first or last among its section\'s pages, as the contents view reorders', async () => {
    let site = orderedSite(about());
    expect(await movePage(site, { path: '/about/contact', position: 'first', expectedVersion: 'v1' })).toEqual({ path: '/about/contact' });
    expect(site.calls).toEqual([['order', { section: '/about', id: 'contact', delta: -2, subset: ['team', 'history', 'contact', 'jobs'] }]]);

    site = orderedSite(about());
    await movePage(site, { path: '/about/team', position: 'last', expectedVersion: 'v1' });
    expect(site.calls).toEqual([['order', { section: '/about', id: 'team', delta: 3, subset: ['team', 'history', 'contact', 'jobs'] }]]);
  });

  it('puts a page before or after another page in its section', async () => {
    let site = orderedSite(about());
    await movePage(site, { path: '/about/jobs', position: { before: '/about/history' }, expectedVersion: 'v1' });
    expect(site.calls[0][1]).toMatchObject({ id: 'jobs', delta: -2 });

    site = orderedSite(about());
    await movePage(site, { path: '/about/team', position: { after: '/about/contact' }, expectedVersion: 'v1' });
    expect(site.calls[0][1]).toMatchObject({ id: 'team', delta: 2 });
  });

  it('asks nothing of the site when the page is already there', async () => {
    const site = orderedSite(about());
    await movePage(site, { path: '/about/history', position: { after: '/about/team' }, expectedVersion: 'v1' });
    expect(site.calls).toEqual([]);
  });

  it('moves into another section and places it there', async () => {
    const site = orderedSite({ ...about(), '/archive': ['/archive/2024', '/archive/2025'] });
    expect(await movePage(site, { path: '/about/jobs', target: '/archive', position: 'first', expectedVersion: 'v1' })).toEqual({ path: '/archive/jobs' });
    expect(site.calls).toEqual([
      ['move', '/about/jobs', '/archive'],
      ['order', { section: '/archive', id: 'jobs', delta: -2, subset: ['2024', '2025', 'jobs'] }],
    ]);
  });

  it('does not move a page into the section it is already in', async () => {
    const site = orderedSite(about());
    await movePage(site, { path: '/about/jobs', target: '/about', position: 'first', expectedVersion: 'v1' });
    expect(site.calls.map(([kind]) => kind)).toEqual(['order']);
  });

  it('refuses a neighbour that is not in the same section, before changing anything', async () => {
    const site = orderedSite({ ...about(), '/archive': ['/archive/2024'] });
    await expect(movePage(site, { path: '/about/jobs', target: '/archive', position: { before: '/about/team' }, expectedVersion: 'v1' }))
      .rejects.toThrow(/\/about\/team is not in \/archive/);
    expect(site.calls).toEqual([]);
  });

  it('needs a section to move to or a place to go', async () => {
    await expect(movePage(orderedSite(about()), { path: '/about/jobs', expectedVersion: 'v1' }))
      .rejects.toThrow(/needs a "target".*"position"/);
  });
});

describe('delete_page: links it would break', () => {
  function siteLinked(linkedFrom, holds = 0) {
    const removed = [];
    return {
      removed,
      status: async () => ({ version: 'v1', lockedBy: null }),
      draftOf: async () => null,
      linksInto: async () => ({ linkedFrom, holds }),
      remove: async (path) => { removed.push(path); },
    };
  }

  it('refuses, naming the pages that link to it, and deletes nothing', async () => {
    const site = siteLinked([{ path: '/home', title: 'Home' }, { path: '/news/launch', title: 'Launch' }]);
    await expect(deletePage(site, { path: '/events', expectedVersion: 'v1' }))
      .rejects.toThrow(/would break links on 2 pages: Home \(\/home\), Launch \(\/news\/launch\).*breakLinks/s);
    expect(site.removed).toEqual([]);
  });

  it('deletes when told to break them, and says where they were', async () => {
    const site = siteLinked([{ path: '/home', title: 'Home' }], 3);
    expect(await deletePage(site, { path: '/events', expectedVersion: 'v1', breakLinks: true })).toEqual({
      deleted: '/events', alsoDeleted: 3, brokenLinksOn: [{ path: '/home', title: 'Home' }],
    });
    expect(site.removed).toEqual(['/events']);
  });

  it('deletes a page nothing links to, saying what went with it', async () => {
    const site = siteLinked([], 2);
    expect(await deletePage(site, { path: '/old', expectedVersion: 'v1' })).toEqual({ deleted: '/old', alsoDeleted: 2 });
  });
});
