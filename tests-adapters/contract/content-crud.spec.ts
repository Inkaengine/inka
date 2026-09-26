import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { resolveTarget, type Target } from '../targets';
import seed from '../fixtures/seed.json';

let target: Target;

beforeAll(async () => {
  target = await resolveTarget();
  await target.start();
});

afterAll(async () => {
  await target.stop();
});

beforeEach(async () => {
  await target.seed();
});

describe('content.get', () => {
  it('returns a canonical Document for a seeded path', async () => {
    const doc: any = await target.adapter.dispatch('content.get', {
      path: '/news/first-post',
    });
    const expected = seed.documents.find((d) => d.path === '/news/first-post')!;

    expect(doc.path).toBe('/news/first-post');
    expect(doc.title).toBe(expected.title);
    expect(doc.type).toBe(target.types[expected.type]);
    expect(typeof doc.id).toBe('string');
    expect(doc.id.length).toBeGreaterThan(0);
    expect(doc.blocksLayout.items).toEqual(['b1']);
    expect(doc.blocks.b1['@type']).toBe('slate');
  });

  it('never leaks the CMS origin into path', async () => {
    const doc: any = await target.adapter.dispatch('content.get', {
      path: '/news/first-post',
    });
    expect(doc.path.startsWith('/')).toBe(true);
    expect(doc.path).not.toMatch(/^https?:/);
  });

  it('exposes the workflow state canonically', async () => {
    const published: any = await target.adapter.dispatch('content.get', {
      path: '/news/first-post',
    });
    const draft: any = await target.adapter.dispatch('content.get', {
      path: '/news/draft-post',
    });
    expect(published.state).toBe('published');
    expect(draft.state).toBe('draft');
  });

  it('rejects a missing path with NOT_FOUND', async () => {
    await expect(
      target.adapter.dispatch('content.get', { path: '/does-not-exist' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('content.update', () => {
  it('round-trips blocks through write then read', async () => {
    const blocks = {
      x1: {
        '@type': 'slate',
        value: [{ type: 'p', children: [{ text: 'Edited' }] }],
      },
    };
    const blocksLayout = { items: ['x1'] };

    await target.adapter.dispatch('content.update', {
      path: '/news/first-post',
      data: { blocks, blocksLayout },
    });

    const doc: any = await target.adapter.dispatch('content.get', {
      path: '/news/first-post',
    });
    expect(doc.blocksLayout.items).toEqual(['x1']);
    expect(doc.blocks.x1.value[0].children[0].text).toBe('Edited');
  });

  it('leaves untouched fields alone', async () => {
    await target.adapter.dispatch('content.update', {
      path: '/news/first-post',
      data: { title: 'Renamed' },
    });
    const doc: any = await target.adapter.dispatch('content.get', {
      path: '/news/first-post',
    });
    expect(doc.title).toBe('Renamed');
    expect(doc.blocksLayout.items).toEqual(['b1']);
  });
});

describe('content.create / content.delete', () => {
  it('creates a document under the requested parent and then removes it', async () => {
    const created: any = await target.adapter.dispatch('content.create', {
      parentPath: '/news',
      data: { type: target.types.page, title: 'Temp' },
    });

    // The contract fixes WHERE the document lands and that the returned path
    // is immediately addressable — deliberately NOT how the id is derived from
    // the title. Plone slugifies, WordPress assigns post_name, Drupal uses a
    // path alias; pinning one convention here would make the suite untestable
    // against the other two for no gain.
    expect(created.path.startsWith('/news/')).toBe(true);
    expect(created.path.slice('/news/'.length)).not.toContain('/');
    expect(created.title).toBe('Temp');

    const fetched: any = await target.adapter.dispatch('content.get', {
      path: created.path,
    });
    expect(fetched.title).toBe('Temp');
    expect(fetched.id).toBe(created.id);

    await target.adapter.dispatch('content.delete', { path: created.path });
    await expect(
      target.adapter.dispatch('content.get', { path: created.path }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('creates a document WITH its blocks, in one call', async () => {
    // Creating and then updating is not the same thing. Translating a page
    // copies the original's blocks into the new document, and the admin posts
    // them with the create — so an adapter that accepts a create and silently
    // drops `blocks` produces an empty translation, with nothing in the reply
    // to say the body was lost.
    const blocks = {
      n1: {
        '@type': 'slate',
        value: [{ type: 'p', children: [{ text: 'Born with a body' }] }],
      },
    };

    const created: any = await target.adapter.dispatch('content.create', {
      parentPath: '/news',
      data: {
        type: target.types.page,
        title: 'With blocks',
        blocks,
        blocksLayout: { items: ['n1'] },
      },
    });

    const fetched: any = await target.adapter.dispatch('content.get', {
      path: created.path,
    });
    expect(fetched.blocksLayout.items).toEqual(['n1']);
    expect(fetched.blocks.n1.value[0].children[0].text).toBe('Born with a body');

    await target.adapter.dispatch('content.delete', { path: created.path });
  });
});
