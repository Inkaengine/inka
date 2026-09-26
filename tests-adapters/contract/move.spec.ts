import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { resolveTarget, type Target } from '../targets';

let target: Target;

beforeAll(async () => {
  target = await resolveTarget();
  await target.start();
}, 240_000);

afterAll(async () => {
  await target.stop();
});

beforeEach(async () => {
  await target.seed();
});

describe('content.move', () => {
  /**
   * The contract fixes that the document ends up UNDER the new parent and is
   * addressable there — deliberately not that its URL changed.
   *
   * Plone's path IS its tree position and WordPress derives the path from the
   * parent chain, so both do change the URL. Drupal does not: menus carry
   * structure and path aliases carry URLs, so re-parenting must not rewrite a
   * published URL. Asserting a specific new path would force a Drupal adapter
   * to fake one, which is how a contract quietly becomes a description of one
   * CMS.
   */
  it('relocates a document under a new parent', async () => {
    const moved: any = await target.adapter.dispatch('content.move', {
      path: '/about',
      targetParentPath: '/news',
    });

    expect(moved.path).toBeTruthy();

    // Addressable wherever it now lives.
    const fetched: any = await target.adapter.dispatch('content.get', {
      path: moved.path,
    });
    expect(fetched.title).toBe('About');

    // And genuinely under the new parent, which is what "moved" means.
    const children: any = await target.adapter.dispatch('tree.list', {
      parent: '/news',
    });
    expect(children.items.map((i: any) => i.id)).toContain(moved.id);
  });

  it('no longer appears under its old parent', async () => {
    const before: any = await target.adapter.dispatch('content.get', {
      path: '/about',
    });

    await target.adapter.dispatch('content.move', {
      path: '/about',
      targetParentPath: '/news',
    });

    // Membership, not addressability: a CMS may legitimately keep the old URL
    // working. What must not survive is the old PARENT still claiming it.
    const oldParent: any = await target.adapter.dispatch('tree.list', {
      parent: '/',
    });
    expect(oldParent.items.map((i: any) => i.id)).not.toContain(before.id);
  });

  /**
   * The assertion that ties moving to the reference model.
   *
   * A move changes a document's path by definition. If `id` changed with it,
   * every stored link to that document would break the moment an editor
   * cut-and-pasted it in the contents view — the single most ordinary thing a
   * site editor does. `id` is the stable handle; a move must not touch it.
   */
  it('preserves the document id across the move', async () => {
    const before: any = await target.adapter.dispatch('content.get', {
      path: '/about',
    });

    const moved: any = await target.adapter.dispatch('content.move', {
      path: '/about',
      targetParentPath: '/news',
    });

    expect(moved.id).toBe(before.id);
  });

  it('keeps links to the document working after it moves', async () => {
    const before: any = await target.adapter.dispatch('content.get', {
      path: '/about',
    });

    await target.adapter.dispatch('content.move', {
      path: '/about',
      targetParentPath: '/news',
    });

    const ref: any = await target.adapter.dispatch('reference.resolve', {
      id: before.id,
    });
    expect(ref.id).toBe(before.id);
    expect(ref.path).toBeTruthy();
    expect(ref.title).toBe('About');
  });

  it('moves descendants along with their parent', async () => {
    // /news holds first-post and draft-post; moving it must not orphan them.
    const moved: any = await target.adapter.dispatch('content.move', {
      path: '/news',
      targetParentPath: '/about',
    });

    // The children came along: they are still children of the moved folder,
    // wherever that folder now is.
    const children: any = await target.adapter.dispatch('tree.list', {
      parent: moved.path,
    });
    expect(children.items.map((i: any) => i.title)).toContain('First Post');
  });

  it('rejects moving a document into itself', async () => {
    await expect(
      target.adapter.dispatch('content.move', {
        path: '/news',
        targetParentPath: '/news',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_MOVE' });
  });
});

describe('content.order', () => {
  const order = async () => {
    const listed: any = await target.adapter.dispatch('tree.list', {
      parent: '/news',
    });
    return listed.items.map((i: any) => i.path);
  };

  it('reorders siblings within their parent', async () => {
    const paths = await order();
    expect(paths.length).toBe(2);

    await target.adapter.dispatch('content.order', {
      path: paths[1],
      targetIndex: 0,
    });

    const after = await order();
    expect(after[0]).toBe(paths[1]);
    expect(after.length).toBe(2);
  });

  it('counts a negative index from the end', async () => {
    // "Move to bottom" is a position the caller can name without knowing how
    // many siblings there are, which it does not: the admin PATCHes a delta of
    // 'bottom' and has no listing in hand to turn into a number.
    const paths = await order();
    await target.adapter.dispatch('content.order', {
      path: paths[0],
      targetIndex: -1,
    });

    const after = await order();
    expect(after[after.length - 1]).toBe(paths[0]);
    expect(after.length).toBe(paths.length);
  });

  it('takes a signed step, which is what a drag gives', async () => {
    // A drag knows only that the row moved one place. Resolving that into an
    // absolute slot needs the sibling order, which every adapter here reads to
    // renumber anyway — and the admin does not have.
    const paths = await order();
    await target.adapter.dispatch('content.order', {
      path: paths[1],
      delta: -1,
    });

    const after = await order();
    expect(after[0]).toBe(paths[1]);

    // And back again, so this is a step rather than a synonym for "to the top".
    await target.adapter.dispatch('content.order', {
      path: paths[1],
      delta: 1,
    });
    expect(await order()).toEqual(paths);
  });
});

describe('content.order and the menu', () => {
  it('reorders the MENU, not just the listing', async () => {
    // This is most of what ordering is for. The contents view is where an editor
    // does it, but what they are arranging is the navigation: in Drupal
    // content.order writes menu link weights, in WordPress menu_order, in Plone
    // the folder position the navigation is built from. An adapter that reordered
    // its own listing and left the menu alone would pass every test above and be
    // wrong in the only place a reader looks.
    const before: any = await target.adapter.dispatch('navigation.get', {
      path: '/',
    });
    const paths = before.items.map((i: any) => i.path);
    expect(paths.length, 'nothing in the menu to reorder').toBeGreaterThan(1);

    const last = paths[paths.length - 1];
    await target.adapter.dispatch('content.order', {
      path: last,
      targetIndex: 0,
    });

    const after: any = await target.adapter.dispatch('navigation.get', {
      path: '/',
    });
    expect(after.items.map((i: any) => i.path)[0]).toBe(last);
    // And nothing fell out of the menu on the way.
    expect(after.items.map((i: any) => i.path).sort()).toEqual(
      [...paths].sort(),
    );
  });
});

describe('content.sort', () => {
  it('writes a new order for the children, by a field', async () => {
    // Persistent, not a sorted listing: after this, tree.list with no sort
    // returns them in the order that was written. A CMS with no manual ordering
    // to write must reject instead — reporting success for an order it cannot
    // keep is the one answer that misleads.
    const before: any = await target.adapter.dispatch('tree.list', {
      parent: '/news',
    });
    const titles = before.items.map((i: any) => i.title);
    const descending = [...titles].sort().reverse();

    await target.adapter.dispatch('content.sort', {
      path: '/news',
      sortOn: 'sortable_title',
      sortOrder: 'descending',
    });

    const after: any = await target.adapter.dispatch('tree.list', {
      parent: '/news',
    });
    expect(after.items.map((i: any) => i.title)).toEqual(descending);
  });
});

describe('content.copy', () => {
  it('copies into the target and leaves the original alone', async () => {
    const copied: any = await target.adapter.dispatch('content.copy', {
      path: '/news/first-post',
      targetParentPath: '/archive',
    });

    // Addressable where it was asked for.
    expect(copied.path.startsWith('/archive/')).toBe(true);
    const fetched: any = await target.adapter.dispatch('content.get', {
      path: copied.path,
    });

    // A NEW document, not the same one under two paths: the original is still
    // there, which is the whole difference from a move.
    const original: any = await target.adapter.dispatch('content.get', {
      path: '/news/first-post',
    });
    expect(fetched.title).toBe(original.title);
    expect(fetched.id).not.toBe(original.id);

    // The body came with it. A copy that arrived empty would look like a
    // successful paste until someone opened it.
    expect(fetched.blocksLayout.items).toEqual(original.blocksLayout.items);
  });

  it('refuses to copy a document into itself', async () => {
    await expect(
      target.adapter.dispatch('content.copy', {
        path: '/news',
        targetParentPath: '/news/first-post',
      }),
    ).rejects.toThrow();
  });
});
