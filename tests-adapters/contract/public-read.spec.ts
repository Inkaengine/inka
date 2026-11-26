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
 * What a VISITOR can read, with no adapter and no session.
 *
 * The public site is not rendered through the bridge. A frontend builds or
 * serves it by reading the CMS directly, so the blocks have to be reachable by
 * an anonymous HTTP client. Every other test in this suite holds the adapter's
 * credentials, which is exactly why nothing here has ever checked this: an
 * authenticated read can succeed while the public one returns nothing, and the
 * editor would look perfect while the published site renders blank.
 *
 * This is a property of the CMS and of how we chose to store blocks, not of the
 * adapter — which is why the fetch lives on the target rather than going
 * through `dispatch`.
 */
describe('public read', () => {
  it('serves a published document’s blocks to a client with no credentials', async () => {
    const blocks = await target.publicBlocks('/news/first-post');

    expect(
      blocks,
      'a published page gave an anonymous reader no blocks — the public site ' +
        'cannot render what it cannot fetch',
    ).not.toBeNull();
    expect(Object.keys(blocks ?? {}).length).toBeGreaterThan(0);
    // The seeded slate says "Hello". Asserting the CONTENT rather than a block
    // id, because ids are the CMS's to assign.
    expect(JSON.stringify(blocks)).toContain('Hello');
  });

  it('serves the navigation to a client with no credentials', async () => {
    // A frontend draws the menu on every page and holds no session.
    //
    // NOT necessarily the source the adapter reads: the adapter is the
    // authenticated editing client and may use a private API, while the
    // visitor uses whatever that CMS offers publicly — Plone's @navigation,
    // WordPress's page tree, Drupal's jsonapi_menu_items. What matters is that
    // a public route EXISTS and answers. The risk this leaves is the two
    // disagreeing, which is a different test.
    const items = await target.publicNavigation();
    expect(
      items,
      'an anonymous client could not read the navigation source the adapter uses',
    ).not.toBeNull();
    expect(items!.length).toBeGreaterThan(0);
  });

  it('shows a visitor the same navigation the editor sees', async () => {
    // The gap the two tests above leave. Each proves its own side works; this
    // is the only one that fails when they DISAGREE — which is the shape of the
    // bug that started all this, where the authenticated read of a page
    // succeeded and the public one came back empty.
    //
    // They may legitimately come from different APIs (the adapter is
    // authenticated and may use a private one), so what is compared is the
    // ANSWER, not the route.
    const publicItems = (await target.publicNavigation()) ?? [];
    const editor: any = await target.adapter.dispatch('navigation.get', {
      path: '/',
    });
    const editorPaths = (editor.items ?? []).map((i: any) => i.path).sort();
    const publicPaths = publicItems.map((i) => i.path).sort();

    expect(
      publicPaths,
      'the published menu and the one the editor manages do not match',
    ).toEqual(editorPaths);
  });

  it('serves a curated menu to a client with no credentials', async (ctx) => {
    // The page tree is not the menu. WordPress and Drupal keep a menu as a
    // SEPARATE hierarchy over the same content, so a frontend that only read
    // the tree would draw the wrong navigation — and core WordPress's own menu
    // endpoints answer 401 to an anonymous caller, which is the reason
    // WPGraphQL is in the blueprint at all.
    if (!target.publicMenu) {
      ctx.skip(
        `${target.name} has ONE hierarchy, which the navigation test above ` +
          `already covers — in Plone the content tree the navigation is built ` +
          `from, in Drupal the menu links that ARE its hierarchy, since its ` +
          `nodes are flat. Neither has a second, curated menu over the same ` +
          `content the way WordPress does.`,
      );
      return;
    }

    const items = await target.publicMenu();
    expect(items, 'an anonymous client could not read the menu').not.toBeNull();

    // The fixture menu is deliberately NOT the page tree: it lifts
    // /news/first-post to the top level and nests /archive under /about. A read
    // that returned the tree instead would fail here.
    expect(items!.map((i) => i.path)).toEqual([
      '/news',
      '/about',
      '/news/first-post',
      '/archive',
    ]);
    expect(items!.find((i) => i.path === '/archive')?.parentLabel).toBe('about');
  });

  it('does not serve an unpublished document to a client with no credentials', async (ctx) => {
    // The other half, and the one that matters more if we get it wrong: making
    // blocks public must not make DRAFTS public.
    const blocks = await target.publicBlocks('/news/draft-post');
    expect(blocks, 'a draft was readable by an anonymous client').toBeNull();
  });
});
