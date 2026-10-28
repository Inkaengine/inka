import { describe, it, expect } from 'vitest';
import { createPublicReader, wpFetchItems } from './publicRead.js';

/**
 * A fake WordPress, recording every url asked for.
 *
 * Only the routes these tests touch: the types registry, a page lookup by
 * slug, the term/user lookups a facet resolves through, and the collection
 * itself. Anything else throws, so a request this code did not mean to make
 * shows up as a failure rather than an empty result.
 */
function fakeWordPress({ posts = [], total, terms = {}, users = [] } = {}) {
  const asked = [];
  const json = (body, headers = {}) => ({
    ok: true,
    status: 200,
    headers: new Headers(headers),
    json: async () => body,
  });
  const fetch = async (url) => {
    asked.push(url);
    const { pathname, searchParams } = new URL(url);
    const route = pathname.replace('/wp-json', '');
    if (route === '/hydra/v1/front-page') {
      return json({ shows: 'page', front_page: { id: 7, slug: 'home', link: '/' } });
    }
    if (route === '/wp/v2/types') {
      return json({
        page: { rest_base: 'pages' },
        post: { rest_base: 'posts' },
        guide: { rest_base: 'guidance-notes' },
      });
    }
    if (route === '/wp/v2/users') {
      const wanted = (searchParams.get('slug') ?? '').split(',');
      return json(users.filter((u) => wanted.includes(u.slug)));
    }
    if (terms[route.replace('/wp/v2/', '')]) {
      const wanted = (searchParams.get('slug') ?? '').split(',');
      return json(
        terms[route.replace('/wp/v2/', '')].filter((t) =>
          wanted.includes(t.slug),
        ),
      );
    }
    if (route === '/wp/v2/pages' && searchParams.get('slug')) {
      return json([{ id: 7, slug: searchParams.get('slug') }]);
    }
    if (route.startsWith('/wp/v2/')) {
      return json(posts, { 'X-WP-Total': String(total ?? posts.length) });
    }
    throw new Error(`unexpected request ${url}`);
  };
  return { fetch, asked, collection: () => asked[asked.length - 1] };
}

const post = (over = {}) => ({
  id: 11,
  slug: 'first-post',
  type: 'page',
  link: 'http://wp.example/news/first-post/',
  title: { rendered: 'First post' },
  excerpt: { rendered: '<p>Rain is <b>wet</b>.</p>\n' },
  date: '2026-02-01T10:00:00',
  modified: '2026-03-02T11:00:00',
  ...over,
});

const fetchFor = (fake, extraCriteria, contextPath) =>
  wpFetchItems({
    cmsBaseUrl: 'http://wp.example',
    fetch: fake.fetch,
    extraCriteria,
    contextPath,
  });

describe('the public reader', () => {
  it('resolves the site root through the front page, not by slug', async () => {
    // `/` is not a slug. Asked for by one it sent `?slug=`, which WordPress
    // reads as no filter at all — so the site root served whichever page the
    // site listed first, on a demo whose home page was sitting right there.
    //
    // `page_on_front` is the answer and WordPress does not give it to a
    // visitor (/wp/v2/settings needs manage_options), so the companion plugin
    // does: hydra/v1/front-page.
    const fake = fakeWordPress({
      posts: [post({ slug: 'home', title: { rendered: 'Home' } })],
    });
    const reader = createPublicReader({
      cmsBaseUrl: 'http://wp.example',
      fetch: fake.fetch,
    });

    await reader.document('/');

    expect(fake.asked.some((u) => u.includes('/hydra/v1/front-page'))).toBe(true);
    expect(fake.asked.some((u) => u.includes('slug=home'))).toBe(true);
    // Never the empty filter that caused it.
    expect(fake.asked.some((u) => /slug=(&|$)/.test(u))).toBe(false);
  });

  it('says so when the front page is not a page', async () => {
    // A site showing posts on its front page has nothing for the root to
    // render. Reported, rather than answered with the first page found.
    const fake = fakeWordPress();
    fake.frontPage = null;
    const reader = createPublicReader({
      cmsBaseUrl: 'http://wp.example',
      fetch: async (url) =>
        url.includes('/hydra/v1/front-page')
          ? { ok: true, status: 200, headers: new Headers(), json: async () => ({ shows: 'posts', front_page: null }) }
          : fake.fetch(url),
    });

    await expect(reader.document('/')).rejects.toThrow(/front page/i);
  });
});

describe('wpFetchItems', () => {
  it('carries the fields a teaser draws, not a title alone', async () => {
    // The generic reader it replaces returned `{path, title}`, so every teaser
    // on a WordPress site rendered with no text and no image — which looks
    // like content nobody filled in.
    const fake = fakeWordPress({
      posts: [
        post({
          _embedded: {
            'wp:featuredmedia': [
              {
                source_url: 'http://wp.example/hero.png',
                media_details: {
                  sizes: {
                    thumbnail: {
                      source_url: 'http://wp.example/hero-150.png',
                      width: 150,
                      height: 150,
                    },
                  },
                },
              },
            ],
            author: [{ name: 'Ada' }],
          },
        }),
      ],
      total: 9,
    });

    const page = await fetchFor(fake)({ querystring: { query: [] } }, { start: 0, size: 10 });

    expect(page.total).toBe(9);
    expect(page.items[0]).toMatchObject({
      '@id': '/news/first-post',
      '@type': 'page',
      title: 'First post',
      // Tags stripped: a teaser renders text, and `<p>` in a summary shows up
      // as markup on the card.
      description: 'Rain is wet.',
      date: '2026-02-01T10:00:00',
      modified: '2026-03-02T11:00:00',
      author: 'Ada',
    });
    expect(page.items[0].image.scales.thumbnail.download).toBe(
      'http://wp.example/hero-150.png',
    );
    // One request for the collection: the image and the author ride along.
    expect(fake.collection()).toContain('_embed=wp%3Afeaturedmedia%2Cauthor');
  });

  it('honours the operation, so "none of" excludes', async () => {
    // It used to read only `{i, v}`: an exclusion filtered exactly like an
    // inclusion, and the listing showed the authors it was told to leave out.
    const fake = fakeWordPress({ users: [{ id: 3, slug: 'ada' }] });

    await fetchFor(fake)(
      { querystring: { query: [{ i: 'author', o: 'selection.none', v: ['ada'] }] } },
      { start: 0, size: 10 },
    );

    expect(fake.collection()).toContain('author_exclude=3');
    expect(fake.collection()).not.toMatch(/[?&]author=3/);
  });

  it('refuses an operation WordPress cannot apply', async () => {
    const fake = fakeWordPress();
    await expect(
      fetchFor(fake)(
        { querystring: { query: [{ i: 'post_type', o: 'selection.none', v: ['post'] }] } },
        { start: 0, size: 10 },
      ),
    ).rejects.toThrow(/cannot apply 'selection.none' to 'post_type'/);
  });

  it('reads the post type at its own REST base', async () => {
    // `?type=` is not a WordPress parameter. Set on /wp/v2/pages it was
    // ignored, so a listing of posts returned pages and looked like it worked.
    // The base is resolved from the registry, not pluralised: a custom type
    // registers its own.
    const fake = fakeWordPress();

    await fetchFor(fake)(
      { querystring: { query: [{ i: 'post_type', o: 'selection.any', v: ['guide'] }] } },
      { start: 0, size: 10 },
    );

    expect(fake.collection()).toContain('/wp/v2/guidance-notes?');
    expect(fake.collection()).not.toContain('type=guide');
  });

  it("turns a visitor's facets into WordPress's own parameters", async () => {
    // The generic reader threw on a facet, so a public search block on
    // WordPress could not filter at all.
    const fake = fakeWordPress({ terms: { categories: [{ id: 5, slug: 'weather' }] } });

    await fetchFor(fake, {
      SearchableText: 'rain',
      'facet.categories': ['weather'],
      'facet.date.after': '2026-01-01',
    })({ querystring: { query: [] } }, { start: 0, size: 10 });

    const url = fake.collection();
    expect(url).toContain('search=rain');
    // By id, because that is what WordPress filters by, from the slug the
    // facet stored.
    expect(url).toContain('categories=5');
    // ISO 8601, which is the only date form `?after=` accepts.
    expect(url).toContain('after=2026-01-01T00%3A00%3A00');
  });

  it('lists what is in this page when a listing names no criteria', async () => {
    const fake = fakeWordPress();

    await fetchFor(fake, {}, '/news')({ querystring: {} }, { start: 0, size: 10 });

    // ?parent=<id>, resolved from the path: WordPress's hierarchy question.
    expect(fake.collection()).toContain('parent=7');
  });

  it('passes a sort key through untranslated', async () => {
    const fake = fakeWordPress();

    await fetchFor(fake)(
      { querystring: { sort_on: 'modified', sort_order: 'descending', query: [] } },
      { start: 0, size: 10 },
    );

    expect(fake.collection()).toContain('orderby=modified');
    expect(fake.collection()).toContain('order=desc');
  });
});

/**
 * Which NESTING is `navigation()`.
 *
 * A CMS offers several nestings over the same content, and a header renders one
 * of them. WordPress has two: the structural page tree (every page carries a
 * parent) and a curated menu someone arranged by hand. Both are legitimate; the
 * SITE says which one is its navigation and the adapter maps it, so a frontend
 * keeps asking `navigation()` and never branches on the CMS.
 */
describe('navigation: which nesting', () => {
  const graphqlFetch = (nodes, { asked = [] } = {}) => async (url, init) => {
    asked.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    if (String(url).includes('graphql')) {
      const body = { data: { menuItems: { nodes } } };
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        // The reader reads the BODY as text and parses it itself, so that a 200
        // of HTML (WPGraphQL absent) can be reported as such.
        text: async () => JSON.stringify(body),
        json: async () => body,
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [],
    };
  };

  it('is the page tree when nothing says otherwise', async () => {
    const asked = [];
    const reader = createPublicReader({
      cmsBaseUrl: 'http://wp.example',
      fetch: graphqlFetch([], { asked }),
    });

    await reader.navigation();

    // WordPress's hierarchy question, and no menu read at all.
    expect(asked.some((a) => a.url.includes('parent=0'))).toBe(true);
    expect(asked.some((a) => a.url.includes('graphql'))).toBe(false);
  });

  it('is a curated menu when the site names its location', async () => {
    const asked = [];
    const reader = createPublicReader({
      cmsBaseUrl: 'http://wp.example',
      navigation: { from: 'menu', location: 'primary' },
      fetch: graphqlFetch(
        [
          { id: 'a', label: 'Start here', uri: '/home', parentId: null },
          { id: 'b', label: 'Latest', uri: '/news', parentId: null },
          { id: 'c', label: 'First', uri: '/news/first-post', parentId: 'b' },
        ],
        { asked },
      ),
    });

    const nav = await reader.navigation();

    // The menu's own labels and order — not the page titles, which is the whole
    // point of a curated menu.
    expect(nav.map((n) => n.title)).toEqual(['Start here', 'Latest']);
    expect(nav.map((n) => n.path)).toEqual(['/home', '/news']);
    // Its nesting travels with it: a menu is a tree.
    expect(nav[1].items).toEqual([{ title: 'First', path: '/news/first-post' }]);
    // Asked by LOCATION, because that is what makes a menu public, and the page
    // tree is never read.
    const query = asked.find((a) => a.url.includes('graphql'))?.body?.query;
    expect(query).toMatch(/primary/i);
    expect(asked.some((a) => a.url.includes('parent=0'))).toBe(false);
  });

  it('refuses a menu with no location, which WordPress would keep private', async () => {
    const reader = createPublicReader({
      cmsBaseUrl: 'http://wp.example',
      navigation: { from: 'menu' },
      fetch: graphqlFetch([]),
    });

    await expect(reader.navigation()).rejects.toThrow(/location/i);
  });

  it('fails loudly when the configured menu cannot be read', async () => {
    // WPGraphQL absent: WordPress serves its ordinary HTML for a query string
    // it does not know. Falling back to the page tree here would make a
    // misconfigured deployment look like a working one.
    const reader = createPublicReader({
      cmsBaseUrl: 'http://wp.example',
      navigation: { from: 'menu', location: 'primary' },
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<!doctype html><html><body>Home</body></html>',
      }),
    });

    await expect(reader.navigation()).rejects.toThrow(/WPGraphQL/);
  });
});
