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

/**
 * Changing what is IN a menu, and the public site changing with it.
 *
 * A menu is a VIEW over the same content, not a flag on a document. "Hide from
 * navigation" is a field on Plone's content type schema, and promoting it to a
 * capability every CMS ought to have ended in inventing post meta for WordPress —
 * a capability true only on sites running our own plugin. Membership of a view is
 * the model all three satisfy through their own mechanisms:
 *
 *   Plone      exclude_from_nav on the document
 *   WordPress  a nav_menu_item's publish status
 *   Drupal     a menu_link_content's enabled flag
 *
 * Removal is a MOVE into the view's Excluded node, never a delete. `content.delete`
 * then means "destroy this" in every view and `content.move` means "relocate it"
 * in every view — no verb whose blast radius depends on the path it was handed.
 * The risk that buys off is not an editor misreading a button: it is any other
 * caller — a retry, a bulk action, a bug that loses view context — deleting a page
 * where it meant to tidy a menu.
 *
 * The public half is the point. Every other test here holds the adapter's
 * credentials, which is how the original bug survived: an authenticated read
 * succeeded while the public one came back empty, so the editor looked perfect and
 * the published site rendered nothing. An edit that does not reach a visitor has
 * not happened.
 */
describe('view membership', () => {
  /** The first menu view this CMS advertises. */
  const menuView = async () => {
    const site: any = await target.adapter.dispatch('site.get', {});
    const view = (site.views ?? []).find((v: any) =>
      String(v.id).startsWith('menu:'),
    );
    if (!view) {
      throw new Error(
        `${target.name} advertises no menu view. Every adapter is expected to ` +
          `map its CMS's menu onto a view — Plone's to exclude_from_nav, ` +
          `WordPress's to nav_menu_item status, Drupal's to menu_link_content. ` +
          `See superpowers/specs/2026-10-02-content-trees-and-menus-design.md`,
      );
    }
    return view;
  };

  const publicEntries = async () => (await target.publicMenuEntries()) ?? [];
  const publicPaths = async () =>
    (await publicEntries()).map((entry) => entry.path);

  /** The node in the menu view that points at a given document. */
  const placementFor = async (view: any, reference: string, where = '') => {
    const nodes: any = await target.adapter.dispatch('tree.list', {
      parent: `/${view.prefix}${where}`,
    });
    return nodes.items.find((n: any) => n.fields?.reference === reference);
  };

  it('takes a document out of the PUBLIC menu, leaving the document alone', async () => {
    const view = await menuView();
    expect(
      await publicPaths(),
      'the fixture menu should list /about',
    ).toContain('/about');

    // The PLACEMENT, not the page. Identity is the placement: a page can appear
    // in a menu twice, so there is no single node to look up by content path.
    const placement = await placementFor(view, '/about');
    expect(placement, 'no node in the menu view references /about').toBeDefined();

    await target.adapter.dispatch('content.move', {
      path: placement.path,
      targetParentPath: `/${view.prefix}/@@excluded`,
    });

    expect(
      await publicPaths(),
      'taken out of the menu, but a visitor still sees it',
    ).not.toContain('/about');

    // MOVED, not deleted — the difference between tidying a menu and losing a
    // page.
    const doc: any = await target.adapter.dispatch('content.get', {
      path: '/about',
    });
    expect(doc.path, 'taking it out of the menu deleted the page').toBe('/about');
  });

  it('shows what was taken out, so it can be put back', async () => {
    const view = await menuView();
    const placement = await placementFor(view, '/about');
    await target.adapter.dispatch('content.move', {
      path: placement.path,
      targetParentPath: `/${view.prefix}/@@excluded`,
    });

    // Discoverable IN the view. A removal that vanished would leave an editor
    // hunting through the picker to undo it.
    const excluded = await placementFor(view, '/about', '/@@excluded');
    expect(
      excluded,
      'what was taken out of the menu is not listed in its Excluded node',
    ).toBeDefined();

    await target.adapter.dispatch('content.move', {
      path: excluded.path,
      targetParentPath: `/${view.prefix}`,
    });

    expect(
      await publicPaths(),
      'put back in the menu, but a visitor cannot see it',
    ).toContain('/about');
  });

  it('gives a placement its own label where the view allows one', async (ctx) => {
    const view = await menuView();
    if (!view.allowsLabels) {
      // A property of the VIEW, which is what navigation-title should have been:
      // a WordPress menu item and a Drupal menu link each carry their own title,
      // and Plone's menu view has nowhere to put one.
      ctx.skip(`${view.id} on ${target.name} cannot relabel a placement`);
      return;
    }

    const created: any = await target.adapter.dispatch('content.create', {
      parentPath: `/${view.prefix}`,
      data: { reference: '/with-image', title: 'Pictures' },
    });

    // Found by the placement's OWN path, not by what it references. A page may
    // legitimately appear in a menu more than once — placements are the identity —
    // so searching by reference could match a different one.
    const nodes: any = await target.adapter.dispatch('tree.list', {
      parent: `/${view.prefix}`,
    });
    const placement = nodes.items.find((n: any) => n.path === created.path);
    expect(placement, 'the placement just created is not in the view').toBeDefined();
    expect(placement.title).toBe('Pictures');
    expect(placement.fields?.reference).toBe('/with-image');

    // The page keeps its own title — which is the point of a per-placement label.
    const doc: any = await target.adapter.dispatch('content.get', {
      path: '/with-image',
    });
    expect(doc.title).not.toBe('Pictures');
  });
  it('puts an EXTERNAL link in the menu where the view allows one', async (ctx) => {
    const view = await menuView();
    if (!view.allowsLinks) {
      ctx.skip(`${view.id} on ${target.name} holds only content, not bare links`);
      return;
    }

    // Through `content.create`, like adding a page — "link" is not a type, it is
    // the ABSENCE of a reference. A node with a url and no reference is an
    // external link; one with neither is a heading.
    const created: any = await target.adapter.dispatch('content.create', {
      parentPath: `/${view.prefix}`,
      data: { url: 'https://example.org/standards', title: 'Standards' },
    });

    const nodes: any = await target.adapter.dispatch('tree.list', {
      parent: `/${view.prefix}`,
    });
    const node: any = nodes.items.find((n: any) => n.path === created.path);
    expect(node, 'the link just created is not in the view').toBeDefined();

    // Where the destination LIVES differs, and the difference is the point.
    //
    // WordPress and Drupal keep a menu entry as its own object, so the url is on
    // the node. In Plone the node IS a `Link` DOCUMENT — everything in a tree is
    // content there — so the url is a field on the document the node references,
    // and `@navigation` carries no url at all, exactly as real Plone does not.
    const destination = node.fields?.url
      ? node.fields.url
      : (
          await target.adapter.dispatch('content.get', {
            path: node.fields.reference,
          })
        )?.fields?.remoteUrl;
    expect(destination).toBe('https://example.org/standards');

    // And a visitor is served it. Identified by LABEL, because an external link
    // has no content path — which is the whole reason it is a different shape.
    const labels = (await publicEntries()).map((entry) => entry.label);
    expect(
      labels,
      'the link was added to the menu but a visitor cannot see it',
    ).toContain('Standards');
  });
});

/**
 * What a PICKER may store after browsing a view.
 *
 * The design spec calls this the likeliest bug in the whole views model: a view's
 * node paths are an addressing convenience for browsing, and the picker's return
 * value must come structurally from the node's REFERENCE, never from the browse
 * location. Reusing "where am I" as "what did you pick" would look right in the
 * editor — the adapter resolves the synthetic address happily — and break only on
 * the public site, where nothing knows what `/@@menu/...` means.
 *
 * These cover the CONTRACT half: that the reference exists, is distinct from the
 * browse path, resolves to real content, and that a synthetic path which did leak
 * into stored data fails LOUDLY rather than resolving to something plausible. The
 * other half is the picker component itself, which is a browser test.
 */
describe('picking from a view', () => {
  const menuView = async () => {
    const site: any = await target.adapter.dispatch('site.get', {});
    return (site.views ?? []).find((v: any) => String(v.id).startsWith('menu:'));
  };

  const nodesIn = async (view: any) => {
    const listed: any = await target.adapter.dispatch('tree.list', {
      parent: `/${view.prefix}`,
    });
    return listed.items;
  };

  it('offers a reference to real content, distinct from the browse path', async () => {
    const view = await menuView();
    const placements = (await nodesIn(view)).filter(
      (n: any) => n.type !== 'bucket',
    );
    expect(
      placements.length,
      'nothing in the menu view to pick',
    ).toBeGreaterThan(0);

    for (const node of placements) {
      // What a picker may store, per the design spec: a reference resolves to
      // content; a url with no reference IS the value; neither — a heading or
      // separator — is not selectable at all.
      const { reference, url } = node.fields ?? {};
      expect(
        reference || url,
        `${node.path} offers nothing a picker could store`,
      ).toBeTruthy();

      if (!reference) continue;

      // The two are different KINDS of thing: ephemeral browse state versus
      // durable data. If they were ever equal, storing the wrong one would be
      // indistinguishable from storing the right one.
      expect(reference).not.toBe(node.path);
      const doc: any = await target.adapter.dispatch('content.get', {
        path: reference,
      });
      expect(doc.path).toBe(reference);
    }
  });

  it('fails loudly when a view path is read as content', async () => {
    const view = await menuView();
    const node = (await nodesIn(view)).find((n: any) => n.type !== 'bucket');

    // The guard on the bug above. A synthetic path that escaped into stored data
    // must not resolve to something plausible — silently reading as content is
    // exactly how this would reach the published site unnoticed.
    await expect(
      target.adapter.dispatch('content.get', { path: node.path }),
    ).rejects.toThrow();
  });

  it('does not offer the Excluded node as something to pick', async () => {
    const view = await menuView();
    const bucket = (await nodesIn(view)).find((n: any) => n.type === 'bucket');
    expect(bucket, 'the view does not surface its Excluded node').toBeDefined();
    // A bucket is not content: it references nothing, so there is nothing to
    // store and a picker must not offer it.
    expect(bucket.fields?.reference).toBeNull();
  });

});
