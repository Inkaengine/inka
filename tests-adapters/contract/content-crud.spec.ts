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

  it('creates a document at the id it is asked for, not one derived from its title', async () => {
    // An importer recreating a tree, or a copy keeping its id, says where the
    // document goes. WordPress and Drupal used to ignore it and slugify the
    // title: /templates/component-doc, titled "Component doc layout", landed at
    // .../component-doc-layout, and the importer's next call to the path it had
    // asked for was a 404.
    const created: any = await target.adapter.dispatch('content.create', {
      parentPath: '/news',
      data: { type: target.types.page, title: 'Not the id at all', id: 'asked-for-id' },
    });
    try {
      expect(created.path).toBe('/news/asked-for-id');
      const fetched: any = await target.adapter.dispatch('content.get', {
        path: '/news/asked-for-id',
      });
      expect(fetched.title).toBe('Not the id at all');
    } finally {
      await target.adapter.dispatch('content.delete', { path: created.path });
    }
  });

  it('derives a path a browser can actually navigate to', async () => {
    // What the ADMIN does: it sends the title an editor typed and nothing
    // else, then navigates to the path that comes back.
    //
    // Every CMS here but one assigns the segment itself — WordPress sanitises
    // its slug, Plone normalises an id, Drupal builds an alias. Strapi's slug
    // is a plain string field, so its adapter used the raw title and answered
    // "/news/Probe 1791449544951": a path that round-trips through the adapter
    // perfectly and is not a URL. Six admin specs failed waiting for a URL
    // that never arrived, and nothing here noticed, because the assertions
    // only asked that the path start with the parent.
    const created: any = await target.adapter.dispatch('content.create', {
      parentPath: '/news',
      data: { type: target.types.page, title: 'A Messy Title: Draft #2' },
    });
    try {
      const segment = created.path.split('/').pop();
      expect(segment, 'the created document has no path segment').toBeTruthy();
      // Needs no escaping to appear in a URL. Deliberately not a comparison
      // against one CMS's slug algorithm — how an id is derived is the CMS's
      // business, and only that the result is addressable is ours.
      expect(
        segment,
        `'${segment}' has to be escaped to go in a URL, so the admin cannot ` +
          `navigate to the document it just created`,
      ).toBe(encodeURIComponent(segment));

      // And the document is really there, at that path.
      const fetched: any = await target.adapter.dispatch('content.get', {
        path: created.path,
      });
      expect(fetched.id).toBe(created.id);
    } finally {
      await target.adapter.dispatch('content.delete', { path: created.path });
    }
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
