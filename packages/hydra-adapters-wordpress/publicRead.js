/**
 * Reading WordPress as a VISITOR — no adapter, no session.
 *
 * This is the one that needs saying out loud, because WordPress asks the most of a
 * frontend developer and none of it is discoverable:
 *
 *   - Blocks ride in post_content inside a `data-hydra-blocks` ELEMENT, not as a
 *     block comment. kses strips HTML comments on save for anyone without
 *     unfiltered_html, and do_blocks drops an unregistered block type on render,
 *     so the comment form reached an anonymous reader EMPTY. `parseBlocks` is
 *     shared with the adapter rather than reimplemented, so both read one format.
 *   - A visitor must ask for `status=publish` and must NOT ask for
 *     `context=edit` — requesting it is what demands a session.
 *   - Menus are not in core's public API at all: /wp/v2/menus and
 *     /wp/v2/menu-items both answer 401 to an anonymous client. They come from
 *     WPGraphQL, and on a Polylang site from WPGraphQL plus wp-graphql-polylang.
 *
 * OPTIONAL: each function is a thin wrapper over ONE documented request, so this
 * file doubles as the documentation for doing it by hand.
 *
 * Nothing here degrades quietly. Where a required plugin is absent the call
 * throws, because a menu that came back empty would hand a developer a site that
 * renders with no navigation and no reason given.
 */
import { parseBlocks } from './index.js';

/**
 * @param {object} options
 * @param {string} options.cmsBaseUrl
 * @param {typeof globalThis.fetch} [options.fetch] An injectable fetch, for a
 *   caller carrying transport state the CMS does not define — a WordPress
 *   Playground, for instance, sets its own cookie and 302s to the same url to
 *   collect it, so a client with no cookie jar follows that redirect forever.
 */
export function createPublicReader({
  cmsBaseUrl,
  fetch: fetchImpl = globalThis.fetch,
  /**
   * WHICH NESTING is this site's navigation.
   *
   * WordPress has two over the same content: the structural page tree (every
   * page carries a parent) and a curated menu someone arranged by hand. Both
   * are real, and which one a header renders is the SITE's design rather than
   * a property of WordPress — so it is configured here and mapped by the
   * adapter, which leaves a frontend asking `navigation()` and never branching
   * on the CMS.
   *
   *   { from: 'tree' }                        the default; needs no plugin
   *   { from: 'menu', location: 'primary' }   a curated menu
   */
  navigation: navigationFrom = { from: 'tree' },
}) {
  const base = cmsBaseUrl.replace(/\/+$/, '');
  /**
   * The PRETTY route, which is how a headless WordPress frontend addresses the
   * REST API: /wp-json/wp/v2/...
   *
   * This used `?rest_route=` on the theory that a site might not have pretty
   * permalinks. Measured against the suite's own Playground: /wp-json answers
   * 200 anonymously, so the accommodation bought nothing and made every URL in
   * this file — the file that doubles as the documentation for reading
   * WordPress by hand — unlike the ones a developer would actually write.
   */
  const api = (route, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return `${base}/wp-json${route}${qs ? `?${qs}` : ''}`;
  };

  /** The one request every public page read makes. */
  const readPage = async (path) => {
    const slug = path.split('/').filter(Boolean).pop() ?? '';
    if (!slug) {
      // The SITE ROOT, which is not a slug. Asked for by slug it sent
      // `?slug=`, WordPress read that as no filter at all, and the root served
      // whichever page the site listed first — "Videos", on a demo whose home
      // page was sitting right there.
      //
      // Which page `/` is is `page_on_front`, and WordPress does not tell a
      // visitor: /wp/v2/settings needs manage_options. The companion plugin
      // says, because that is what it is for — see hydra/v1/front-page.
      const res = await fetchImpl(api('/hydra/v1/front-page'));
      if (!res.ok) {
        throw new Error(
          `This WordPress does not answer /hydra/v1/front-page (${res.status}), ` +
            `so the site root cannot be resolved. The hydra-companion plugin ` +
            `provides it; without the plugin a visitor cannot be told which ` +
            `page is the front page.`,
        );
      }
      const { front_page: front, shows } = await res.json();
      if (!front) {
        throw new Error(
          `This WordPress shows "${shows}" on its front page, not a page, so ` +
            `there is nothing for the site root to render. Set a static front ` +
            `page (Settings > Reading).`,
        );
      }
      const page = await fetchImpl(
        api('/wp/v2/pages', { slug: front.slug, status: 'publish' }),
      );
      if (!page.ok) return null;
      const [post] = await page.json();
      return post ?? null;
    }
    const res = await fetchImpl(
      api('/wp/v2/pages', { slug, status: 'publish' }),
    );
    if (!res.ok) return null;
    const [post] = await res.json();
    return post ?? null;
  };

  /**
   * A curated menu's raw nodes, over GraphQL. Shared by `menu()` and by
   * `navigation()` when the site's navigation IS a menu.
   *
   * A menu is selected by its theme LOCATION, never by its title: WPGraphQL
   * decides a menu is public by intersecting the locations it is assigned to
   * with the ones the theme registers, so an unlocated menu stays private —
   * which is the site saying it is not part of its design. A title would let a
   * site name a menu WordPress will never serve a visitor.
   */
  const menuNodes = async ({ language, location } = {}) => {
    const clauses = [
      ...(language ? [`language: ${language}`] : []),
      // An enum in the schema (MenuLocationEnum), so unquoted and upper case.
      ...(location ? [`location: ${String(location).toUpperCase()}`] : []),
    ];
    const where = clauses.length ? `(where: { ${clauses.join(', ')} })` : '';
    const res = await fetchImpl(`${base}/index.php?graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{ menuItems${where} { nodes { id label uri parentId } } }`,
      }),
    });
    if (!res.ok) return null;

    // A 200 that is NOT JSON means WPGraphQL is not answering. WordPress
    // serves its ordinary HTML page for a query string it does not
    // recognise, so the request succeeds and only the parse gives it away —
    // as `Unexpected token '<'` from deep inside whatever was rendering,
    // naming neither WordPress nor the plugin. Caught here, with the reason.
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        `wordpress: index.php?graphql answered ${res.status} with ` +
          `${res.headers.get('content-type') ?? 'no content-type'} rather ` +
          `than JSON, which means WPGraphQL is not installed. Core ` +
          `WordPress has no public menu endpoint — a visitor's read of ` +
          `core menus is 401 — so without the plugin there is no curated ` +
          `menu to serve. The page TREE is readable: use navigation().`,
      );
    }
    if (body.errors) {
      throw new Error(
        `wordpress: the public menu query failed, which usually means ` +
          `WPGraphQL is not installed: ${JSON.stringify(body.errors)}`,
      );
    }
    return body.data?.menuItems?.nodes ?? null;
  };

  const pathOfUri = (uri) =>
    new URL(uri, base).pathname.replace(/\/+$/, '') || '/';


  return {
    /**
     * A page's blocks, or null when it is not readable.
     *
     * null means NOT READABLE; {} means readable but carrying no blocks.
     */
    async blocks(path) {
      const post = await readPage(path);
      if (!post) return null;
      return parseBlocks(post.content?.rendered ?? '').blocks ?? {};
    },

    /**
     * Everything a frontend needs to RENDER the page, from one request.
     *
     * `status=publish` and NO `context=edit`: asking for either of the
     * editor's parameters is what demands a session, and this read has none.
     * The blocks come out of `content.rendered` because they ride in a
     * data-hydra-blocks ELEMENT, which survives rendering — a block comment
     * would not.
     */
    async document(path) {
      const post = await readPage(path);
      if (!post) return null;
      const { blocks, blocksLayout } = parseBlocks(post.content?.rendered ?? '');
      return {
        path,
        title: post.title?.rendered ?? '',
        blocks: blocks ?? {},
        blocksLayout: blocksLayout ?? { items: [] },
      };
    },

    /**
     * What the SITE is called, for a visitor.
     *
     * From the REST root, which is public: `/wp-json` carries `name` and
     * `description`. `wp/v2/settings` has more (including the language) but is
     * permission-gated — a visitor reading it gets 401, so a frontend that
     * asked for the site's own name would need a credential to render a header.
     *
     * `language` is therefore NULL here, not guessed: WordPress does not
     * publish it to an anonymous client. A caller that needs the page's
     * language should read the document's.
     */
    async site() {
      const res = await fetchImpl(`${base}/wp-json`);
      if (!res.ok) return null;
      const root = await res.json();
      return {
        title: root.name ?? '',
        description: root.description ?? '',
        language: null,
      };
    },

    /**
     * The trail from the site root to this page, as paths and titles.
     *
     * Walked up the `parent` chain, one request per ancestor, because
     * WordPress has no breadcrumb endpoint and no ancestors field — the
     * hierarchy is only ever a parent id. Plone expands breadcrumbs with the
     * page in a single request; this is the honest cost of the same answer
     * here, and it is why the walk is bounded: a cycle in the data would
     * otherwise hang the page.
     */
    async breadcrumbs(path) {
      const post = await readPage(path);
      if (!post) return null;

      const trail = [];
      let current = post;
      for (let depth = 0; depth < 10 && current; depth += 1) {
        trail.unshift({
          path: `/${current.slug}`,
          title: current.title?.rendered ?? '',
        });
        if (!current.parent) break;
        const res = await fetchImpl(
          api(`/wp/v2/pages/${current.parent}`, { status: 'publish' }),
        );
        if (!res.ok) break;
        current = await res.json();
      }

      // Paths rebuilt from the chain, so a child's breadcrumb carries its
      // ancestors' slugs rather than only its own.
      let prefix = '';
      return trail.map((entry) => {
        prefix = `${prefix}${entry.path}`;
        return { path: prefix, title: entry.title };
      });
    },


    /**
     * The navigation: the top of the PAGE TREE, which is what WordPress builds its
     * navigation from (wp_list_pages, the page-list block, a theme with no menu
     * assigned all read it).
     *
     * Not a nav menu — that is a separate, curated view over the same content, and
     * `menu()` below returns it.
     */
    async navigation() {
      if (navigationFrom.from === 'menu') {
        const { location } = navigationFrom;
        if (!location) {
          throw new Error(
            `wordpress: navigation { from: 'menu' } needs a \`location\` — the ` +
              `theme location the menu is assigned to, e.g. 'primary'. A menu ` +
              `is public only where it is LOCATED, so there is no menu to read ` +
              `without one, and naming one by title would point at a menu ` +
              `WordPress will never serve a visitor.`,
          );
        }
        const nodes = await menuNodes({ location });
        if (!nodes) return null;
        // A menu is a TREE and it travels as one: `parentId` says which item
        // holds which. The labels and the order are the menu's own, which is
        // the point of curating one — they need not match the page titles.
        const itemOf = (node) => {
          const children = nodes.filter((n) => n.parentId === node.id);
          return {
            title: node.label,
            path: pathOfUri(node.uri),
            ...(children.length ? { items: children.map(itemOf) } : {}),
          };
        };
        return nodes.filter((n) => !n.parentId).map(itemOf);
      }

      // The structural nesting: WordPress's own hierarchy. `?parent=0` is the
      // top level, and it needs no plugin, which is why it is the default.
      const res = await fetchImpl(
        api('/wp/v2/pages', { parent: '0', status: 'publish', per_page: '100' }),
      );
      if (!res.ok) return null;
      const posts = await res.json();
      return posts.map((post) => ({
        path: pathOfUri(post.link),
        title: post.title?.rendered ?? '',
      }));
    },

    /**
     * A curated nav menu, over GraphQL.
     *
     * Core cannot answer this: both menu endpoints are 401 to a visitor. On a
     * Polylang site WPGraphQL alone cannot either — Polylang re-keys menu
     * locations per language, WPGraphQL can then no longer resolve a menu's
     * locations, and its public-menu check fails, so an anonymous caller is told
     * the site has no menus while an authenticated one still sees them. The
     * wp-graphql-polylang bridge is what makes them agree.
     *
     * A menu is published by being assigned to a theme LOCATION; one nobody
     * assigned stays private, which is the site saying what is part of its design.
     *
     * @param {object} [options]
     * @param {string} [options.language] A Polylang language code, e.g. 'EN'.
     */
    async menu({ language } = {}) {
      const nodes = await menuNodes({ language });
      if (!nodes) return null;
      // parentId is an opaque global id, so a parent is named by its label.
      const labelById = new Map(nodes.map((n) => [n.id, n.label]));
      return nodes.map((n) => ({
        label: n.label,
        path: pathOfUri(n.uri),
        parentLabel: n.parentId ? (labelById.get(n.parentId) ?? null) : null,
      }));
    },
  };
}

/**
 * A listing block's items, read from WordPress as a VISITOR.
 *
 * The peer of `ploneFetchItems`: same `fetchItems(block, {start, size})`
 * contract, so `expandListingBlocks` calls either one — and nothing between
 * them. A frontend is tied to a CMS; it imports the fetcher for the CMS it
 * reads, and this file is where WordPress's own query lives.
 *
 * This replaces a generic `publicFetchItems({reader})` that could only pass
 * through what every CMS had in common, and whose limits were all the same
 * mistake: it threw on facets, dropped every field but title, ignored the
 * OPERATION in a criterion, and carried a leftover Plone sort name. Each of
 * those is answerable here, because here there is only WordPress.
 *
 * @param {object} options
 * @param {string} options.cmsBaseUrl
 * @param {string} [options.contextPath] The page the listing is on, which is
 *   what an unconfigured listing means by "what is in this page".
 * @param {Record<string, unknown>} [options.extraCriteria] What the VISITOR
 *   asked for: `SearchableText`, `facet.<index>`, `facet.<index>.after|before`,
 *   `sort_on`, `sort_order`.
 * @param {typeof globalThis.fetch} [options.fetch]
 */
export function wpFetchItems({
  cmsBaseUrl,
  contextPath = '/',
  extraCriteria = {},
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  if (!cmsBaseUrl) throw new Error('wpFetchItems requires cmsBaseUrl');
  const base = cmsBaseUrl.replace(/\/+$/, '');
  const api = (route, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return `${base}/wp-json${route}${qs ? `?${qs}` : ''}`;
  };
  const getJson = async (url) => {
    const res = await fetchImpl(url);
    if (!res.ok) {
      throw new Error(`wpFetchItems: ${res.status} from ${url}`);
    }
    return { body: await res.json(), headers: res.headers };
  };

  /**
   * A post type's REST base — `page` is read at /wp/v2/pages.
   *
   * Resolved rather than guessed by pluralising: a custom type registers its
   * own `rest_base`, and `?type=` on /wp/v2/pages is not a parameter
   * WordPress has. Setting it returned pages for a listing of posts and read
   * as a listing that worked.
   */
  const restBaseFor = async (type) => {
    const { body: types } = await getJson(api('/wp/v2/types'));
    const found = types?.[type];
    if (!found) {
      throw new Error(
        `wpFetchItems: this site has no '${type}' post type (has: ${Object.keys(
          types ?? {},
        ).join(', ')})`,
      );
    }
    return found.rest_base ?? type;
  };

  /** A page's id, for `?parent=`. */
  const idOfPath = async (path) => {
    const slug = path.split('/').filter(Boolean).pop() ?? '';
    if (!slug) return null;
    const { body } = await getJson(
      api('/wp/v2/pages', { slug, status: 'publish' }),
    );
    return body?.[0]?.id ?? null;
  };

  /**
   * Taxonomy terms and users are filtered by ID, while a facet's stored value
   * is a SLUG — the name a human recognises and the one that survives a
   * re-import. Resolved here, and an unknown slug throws: dropped, it would
   * widen the query, so a facet on a deleted term would return everything.
   */
  const idsFor = async (restBase, values) => {
    const ids = [];
    const slugs = [];
    for (const v of values) {
      if (/^\d+$/.test(String(v))) ids.push(String(v));
      else slugs.push(String(v));
    }
    if (slugs.length) {
      const { body: terms } = await getJson(
        api(`/wp/v2/${restBase}`, { slug: slugs.join(','), per_page: '100' }),
      );
      const bySlug = new Map((terms ?? []).map((t) => [t.slug, t.id]));
      for (const slug of slugs) {
        const id = bySlug.get(slug);
        if (id === undefined) {
          throw new Error(`wpFetchItems: no '${slug}' in ${restBase}`);
        }
        ids.push(String(id));
      }
    }
    return ids.join(',');
  };

  /** `?after=` wants ISO 8601; a date input produces `2026-01-01`. */
  const isoDateTime = (value) => {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      throw new Error(`wpFetchItems: ${JSON.stringify(value)} is not a date`);
    }
    return date.toISOString().replace(/\.\d{3}Z$/, '');
  };

  return async function fetchItems(block, { start = 0, size = 25 } = {}) {
    const stored = block?.querystring ?? {};
    const params = {
      // A visitor sees published content, and asking for anything else is what
      // demands a session.
      status: 'publish',
      // The featured image and the author come back on the SAME request. Two
      // reads per item would be a listing page of 24 extra requests.
      _embed: 'wp:featuredmedia,author',
      per_page: String(size),
      offset: String(start),
    };
    let restBase = 'pages';
    let parentPath = null;

    // The stored criteria are in WORDPRESS's own index names and operation
    // ids, because that is what this CMS's adapter advertised and therefore
    // what the editor wrote. Both halves are honoured: an operation this
    // listing cannot apply is said out loud rather than applied as its
    // opposite.
    for (const { i, o, v } of stored.query ?? []) {
      const values = Array.isArray(v) ? v : [v];
      const refuse = () => {
        throw new Error(
          `wpFetchItems: WordPress cannot apply '${o}' to '${i}'`,
        );
      };
      switch (i) {
        case 'post_type':
          if (o !== 'selection.any') refuse();
          restBase = await restBaseFor(String(values[0]));
          break;
        case 'parent':
          if (o !== 'parent.is') refuse();
          parentPath = String(values[0]);
          break;
        case 'title':
          if (o !== 'string.contains') refuse();
          params.search = String(values[0]);
          break;
        case 'author':
          if (o === 'selection.any') {
            params.author = await idsFor('users', values);
          } else if (o === 'selection.none') {
            params.author_exclude = await idsFor('users', values);
          } else refuse();
          break;
        case 'status':
          // A visitor reads published content whatever the listing says, so
          // this is not applied. Refusing it would break a listing that is
          // perfectly renderable in public; applying it could publish a draft.
          break;
        case 'modified':
          if (o === 'date.after') params.modified_after = isoDateTime(values[0]);
          else if (o === 'date.before') {
            params.modified_before = isoDateTime(values[0]);
          } else refuse();
          break;
        case 'date':
          if (o === 'date.after') params.after = isoDateTime(values[0]);
          else if (o === 'date.before') params.before = isoDateTime(values[0]);
          else refuse();
          break;
        default:
          // A taxonomy index, keyed by its REST base: `?categories=` by id,
          // `?categories_exclude=` the other way round.
          if (o === 'selection.any') params[i] = await idsFor(i, values);
          else if (o === 'selection.none') {
            params[`${i}_exclude`] = await idsFor(i, values);
          } else refuse();
      }
    }

    // What the VISITOR asked for, which has no stored form: the search box and
    // the facets they ticked. WordPress's own parameters again — this is the
    // same CMS, so there is nothing to translate.
    if (extraCriteria.SearchableText) {
      params.search = String(extraCriteria.SearchableText);
    }
    for (const [key, value] of Object.entries(extraCriteria)) {
      if (!key.startsWith('facet.')) continue;
      const field = key.replace('facet.', '');
      const values = Array.isArray(value) ? value : [value];
      if (!values.length || values.every((entry) => !entry)) continue;
      const window = field.match(/^(.+)\.(after|before)$/);
      if (window) {
        const [, index, direction] = window;
        const when = isoDateTime(values[0]);
        if (index === 'modified') params[`modified_${direction}`] = when;
        else if (index === 'date') params[direction] = when;
        else {
          throw new Error(
            `wpFetchItems: '${index}' is not a date WordPress can window`,
          );
        }
      } else if (field === 'author') {
        params.author = await idsFor('users', values);
      } else if (field === 'post_type') {
        restBase = await restBaseFor(String(values[0]));
      } else {
        params[field] = await idsFor(field, values);
      }
    }

    const sortOn = extraCriteria.sort_on || stored.sort_on;
    if (sortOn) {
      // WordPress's own orderby keys, which are what its adapter advertises as
      // `sortable_indexes` and therefore what the editor could choose. There
      // is no translation table here: one existed, mapping Plone's
      // `sortable_title`, and it was the last place in this package that
      // assumed a listing had been authored against Plone.
      params.orderby = String(sortOn);
      params.order = String(
        extraCriteria.sort_order || stored.sort_order || 'asc',
      ).startsWith('desc')
        ? 'desc'
        : 'asc';
    }

    // An unconfigured listing means "what is in this page", and WordPress's
    // hierarchy question is `?parent=`: the pages directly under one page.
    if (parentPath === null && !(stored.query ?? []).length) {
      parentPath = contextPath;
    }
    if (parentPath && parentPath !== '/') {
      const id = await idOfPath(parentPath);
      if (id === null) return { items: [], total: 0 };
      params.parent = String(id);
    }

    const { body: posts, headers } = await getJson(
      api(`/wp/v2/${restBase}`, params),
    );
    const items = (posts ?? []).map((post) => itemFromPost(post, base));
    return {
      // X-WP-Total is the unpaged count, which is what a listing's "N results"
      // means; the array's length is only this page.
      items,
      total: Number(headers.get('X-WP-Total') ?? items.length),
    };
  };
}

/**
 * One WordPress post as a listing item.
 *
 * Carries the fields a teaser draws — a title, a description, an image, a date
 * — not a title alone. A listing whose items had only titles rendered every
 * teaser on the site empty, and looked like content with no images rather than
 * a fetcher that dropped them.
 *
 * The WordPress field names are kept ALONGSIDE: `modified`, `date`, `author`
 * are what this CMS's adapter advertises as indexes, so they are what a
 * listing's fieldMapping was authored against in the editor.
 */
function itemFromPost(post, base) {
  const media = post._embedded?.['wp:featuredmedia']?.[0];
  const author = post._embedded?.author?.[0];
  const path =
    new URL(post.link, base).pathname.replace(/\/+$/, '') || '/';
  const description = String(post.excerpt?.rendered ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    '@id': path,
    '@type': post.type,
    id: post.slug,
    UID: String(post.id),
    title: post.title?.rendered ?? '',
    description,
    ...(media?.source_url
      ? {
          image: {
            '@id': media.source_url,
            // The sizes WordPress generated, under the names IT uses. A
            // renderer asks for a named scale; which names exist is the CMS's
            // business, not something to invent here.
            scales: Object.fromEntries(
              Object.entries(media.media_details?.sizes ?? {}).map(
                ([name, s]) => [
                  name,
                  { download: s.source_url, width: s.width, height: s.height },
                ],
              ),
            ),
          },
          image_field: 'image',
        }
      : {}),
    date: post.date,
    modified: post.modified,
    ...(author?.name ? { author: author.name } : {}),
    link: post.link,
  };
}
