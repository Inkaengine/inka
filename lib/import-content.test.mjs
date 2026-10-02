import { describe, it, expect } from 'vitest';
import { planImport, readExisting, applyImport } from './import-content.mjs';

/** An adapter that records what it was asked, and can be told to 404. */
function fakeAdapter({ missing = [] } = {}) {
  const calls = [];
  return {
    calls,
    capabilities: ['content'],
    async dispatch(intent, args) {
      calls.push({ intent, args });
      if (intent === 'content.get' && missing.includes(args.path)) {
        const error = new Error(`Not found: ${args.path}`);
        error.code = 'NOT_FOUND';
        throw error;
      }
      if (intent === 'content.get')
        return { path: args.path, id: `id${args.path}` };
      if (intent === 'state.getForms') return { publish: {} };
      return null;
    },
  };
}

const tree = () => ({
  items: new Map([
    [
      '/news/first-post',
      {
        '@type': 'Document',
        title: 'First',
        blocks: { a: {} },
        blocks_layout: { items: ['a'] },
      },
    ],
    ['/news', { '@type': 'Folder', title: 'News', review_state: 'published' }],
    ['/about', { '@type': 'Document', title: 'About', UID: 'authored-uid' }],
  ]),
  order: new Map([['/news', ['first-post', 'second-post']]]),
  blobFiles: new Map(),
});

describe('planImport', () => {
  it('creates parents before children', () => {
    const plan = planImport(tree(), new Set());
    const created = plan.creates.map(
      (c) => `${c.args.parentPath}/${c.args.data.id}`,
    );
    expect(created.indexOf('/news')).toBeLessThan(
      created.indexOf('/news/first-post'),
    );
  });

  it('creates nothing for a path the CMS already has', () => {
    const plan = planImport(
      tree(),
      new Set(['/news', '/about', '/news/first-post']),
    );
    expect(plan.creates).toEqual([]);
    // But the bodies still go — that is what a re-import is for.
    expect(plan.bodies).toHaveLength(3);
  });

  it('passes an authored UID through, and invents none', () => {
    const plan = planImport(tree(), new Set());
    const about = plan.creates.find((c) => c.args.data.id === 'about');
    const news = plan.creates.find((c) => c.args.data.id === 'news');
    expect(about.args.data.UID).toBe('authored-uid');
    expect('UID' in news.args.data).toBe(false);
  });

  it('asks for no state the source did not', () => {
    // Defaulting to published would publish every draft in the tree on the first
    // import, which is not a thing you can take back quietly.
    const plan = planImport(tree(), new Set());
    expect(plan.states).toEqual([{ path: '/news', state: 'published' }]);
  });

  it('skips ordering a folder with nothing to order', () => {
    const one = planImport(
      {
        items: new Map([['/x', { title: 'X' }]]),
        order: new Map([['/x', ['only']]]),
      },
      new Set(),
    );
    expect(one.orders).toEqual([]);
  });
});

describe('readExisting', () => {
  it('treats NOT_FOUND as absence and anything else as a reason to stop', async () => {
    const existing = await readExisting(fakeAdapter({ missing: ['/gone'] }), [
      '/here',
      '/gone',
    ]);
    expect([...existing]).toEqual(['/here']);

    const angry = {
      async dispatch() {
        const error = new Error('CMS down');
        error.code = 'UNAUTHORIZED';
        throw error;
      },
    };
    // Reading a rejected credential as "the page is missing" would turn an outage
    // into a tree full of duplicates.
    await expect(readExisting(angry, ['/here'])).rejects.toThrow('CMS down');
  });
});

describe('applyImport', () => {
  it('sends the bodies as ONE batch, not one request each', async () => {
    const adapter = fakeAdapter();
    const plan = planImport(
      tree(),
      new Set(['/news', '/about', '/news/first-post']),
    );
    await applyImport(adapter, plan);

    const batches = adapter.calls.filter((c) => c.intent === 'batch');
    expect(batches).toHaveLength(1);
    expect(batches[0].args.operations).toHaveLength(3);
    expect(
      adapter.calls.filter((c) => c.intent === 'content.update'),
      'bodies go inside the batch, not beside it',
    ).toEqual([]);
  });

  it('orders children by position, in the order the source gives', async () => {
    const adapter = fakeAdapter();
    await applyImport(
      adapter,
      planImport(tree(), new Set(['/news', '/about', '/news/first-post'])),
    );
    const orders = adapter.calls.filter((c) => c.intent === 'content.order');
    expect(orders.map((o) => [o.args.path, o.args.targetIndex])).toEqual([
      ['/news/first-post', 0],
      ['/news/second-post', 1],
    ]);
  });

  it('matches the target state against what the CMS offers', async () => {
    const adapter = fakeAdapter();
    await applyImport(adapter, planImport(tree(), new Set()));
    const transitions = adapter.calls.filter(
      (c) => c.intent === 'state.transition',
    );
    expect(transitions).toHaveLength(1);
    expect(transitions[0].args).toEqual({
      path: '/news',
      transition: 'publish',
    });
  });

  it('asks for no transition when the document is already in that state', async () => {
    const adapter = {
      calls: [],
      async dispatch(intent, args) {
        this.calls.push({ intent, args });
        if (intent === 'content.get')
          return { path: args.path, state: 'published' };
        if (intent === 'state.getForms') return { publish: {} };
        return null;
      },
    };
    const lines = [];
    await applyImport(
      adapter,
      planImport(tree(), new Set(['/news', '/about', '/news/first-post'])),
      {
        log: (line) => lines.push(line),
      },
    );
    expect(adapter.calls.some((c) => c.intent === 'state.transition')).toBe(
      false,
    );
    expect(lines.join('\n')).toMatch(/already published/);
  });

  it('reports a CMS with no workflow, and stops for any other failure', async () => {
    const noWorkflow = {
      async dispatch(intent, args) {
        if (intent === 'content.get')
          return { path: args.path, state: 'private' };
        if (intent === 'state.getForms') {
          const error = new Error('no workflow here');
          error.code = 'NOT_IMPLEMENTED';
          throw error;
        }
        return null;
      },
    };
    const lines = [];
    await applyImport(
      noWorkflow,
      planImport(tree(), new Set(['/news', '/about', '/news/first-post'])),
      {
        log: (line) => lines.push(line),
      },
    );
    expect(lines.join('\n')).toMatch(/has no workflow/);

    // Anything else must stop the import. Carrying on would leave a tree of
    // silently unpublished pages and call it a success.
    const broken = {
      async dispatch(intent, args) {
        if (intent === 'content.get')
          return { path: args.path, state: 'private' };
        if (intent === 'state.getForms') {
          const error = new Error('CMS down');
          error.code = 'UNAUTHORIZED';
          throw error;
        }
        return null;
      },
    };
    await expect(
      applyImport(
        broken,
        planImport(tree(), new Set(['/news', '/about', '/news/first-post'])),
      ),
    ).rejects.toThrow('CMS down');
  });

  it('says so rather than throwing when no transition offers that state', async () => {
    const adapter = {
      calls: [],
      async dispatch(intent, args) {
        this.calls.push({ intent, args });
        if (intent === 'content.get') return { path: args.path };
        if (intent === 'state.getForms') return { archive: {} };
        return null;
      },
    };
    const lines = [];
    await applyImport(
      adapter,
      planImport(tree(), new Set(['/news', '/about', '/news/first-post'])),
      {
        log: (line) => lines.push(line),
      },
    );
    expect(adapter.calls.some((c) => c.intent === 'state.transition')).toBe(
      false,
    );
    expect(lines.join('\n')).toMatch(/skipped state published/);
  });
});
