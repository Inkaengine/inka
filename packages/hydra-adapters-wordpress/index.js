import {
  BaseAdapter,
  AdapterError,
  resolveOrderPosition,
  VIEW_PREFIX,
  EXCLUDED_NODE,
  parseViewPath,
} from '@volto-hydra/hydra-adapters-core';

/**
 * Hydra adapter for vanilla WordPress — no plugin, no theme changes.
 *
 * Blocks live inside post_content as a Gutenberg-style HTML comment. WordPress
 * preserves it byte-for-byte on save (verified against WP latest) and renders
 * nothing for it on the public page, because the block type is not registered.
 * That is intentional: the reader-facing surface is the decoupled frontend.
 */

const BLOCK_MARKER = 'wp:hydra-blocks/document';

/** WP post status -> canonical lifecycle state. */
const STATE_MAP = {
  publish: 'published',
  draft: 'draft',
  pending: 'pending',
  private: 'private',
  future: 'scheduled',
};

const TRANSITIONS = {
  draft: [
    { id: 'publish', label: 'Publish', targetState: 'published' },
    { id: 'pending', label: 'Submit for review', targetState: 'pending' },
  ],
  pending: [
    { id: 'publish', label: 'Publish', targetState: 'published' },
    { id: 'draft', label: 'Back to draft', targetState: 'draft' },
  ],
  publish: [
    { id: 'draft', label: 'Unpublish', targetState: 'draft' },
    { id: 'private', label: 'Make private', targetState: 'private' },
  ],
  private: [{ id: 'publish', label: 'Publish', targetState: 'published' }],
};

/**
 * WordPress does not assign a post_name to a draft until it is first published,
 * so a freshly created draft has NO slug and therefore no addressable path.
 * Hydra addresses content by path, so the adapter must supply one up front
 * rather than discover it later.
 */
export function slugify(title) {
  const slug = String(title)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) {
    throw new AdapterError(`Cannot derive a slug from title ${JSON.stringify(title)}`, {
      code: 'INVALID_TITLE',
    });
  }
  return slug;
}

/**
 * An ELEMENT, not a comment, because the public site has to be able to read it.
 *
 * The comment form is stripped twice over: kses removes HTML comments on save
 * for anyone without `unfiltered_html` (which is why the test seeder has to
 * call kses_remove_filters), and `do_blocks` drops an unregistered block type
 * on render. Measured against a real WordPress, a published page reached an
 * anonymous reader with `content.rendered` EMPTY — the editor looked right and
 * the site served nothing. The frontend reads the CMS directly, with no adapter
 * and no session, so that is fatal rather than cosmetic.
 *
 * A `data-` attribute on a div survives both, byte-identical. The escaping is
 * the whole risk: the payload is full of double quotes, so quoting the
 * attribute with single quotes and dropping the JSON in works right up until
 * someone types an apostrophe, and then the attribute ends early and the JSON
 * truncates. Hence real entity escaping, `&` first so the others are not
 * double-encoded.
 */
const BLOCKS_ATTR = 'data-hydra-blocks';

const escapeAttr = (text) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const unescapeAttr = (text) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');

export function serializeBlocks(blocks, blocksLayout) {
  const payload = JSON.stringify({ v: 1, blocks, blocksLayout });
  return `<div ${BLOCKS_ATTR}="${escapeAttr(payload)}"></div>`;
}

/**
 * Pull the blocks payload back out of post_content.
 *
 * Anything else in post_content is legacy content authored elsewhere; it is
 * preserved verbatim on write so Hydra never destroys work done in Gutenberg.
 */
export function parseBlocks(content) {
  // The element form first, then the comment a previous version wrote —
  // refusing to open a site edited before this changed would turn a storage
  // change into data loss.
  const element = new RegExp(`<div ${BLOCKS_ATTR}="([^"]*)"></div>`).exec(content);
  let json;
  let start;
  let end;
  if (element) {
    json = unescapeAttr(element[1]);
    start = element.index;
    end = element.index + element[0].length - 4;
  } else {
    start = content.indexOf(`<!-- ${BLOCK_MARKER} `);
    if (start === -1) {
      return { blocks: {}, blocksLayout: { items: [] }, legacy: content };
    }
    end = content.indexOf('/-->', start);
    if (end === -1) {
      throw new AdapterError('Unterminated hydra-blocks comment in post_content', {
        code: 'MALFORMED_CONTENT',
      });
    }
    json = content.slice(start + `<!-- ${BLOCK_MARKER} `.length, end).trim();
  }
  const parsed = JSON.parse(json);
  // PHP's json_encode cannot tell an empty map from an empty list, so a
  // document whose blocks were emptied comes back as [] rather than {}.
  // Everything downstream indexes blocks by id, so coerce it back.
  const asMap = (v) => (Array.isArray(v) && v.length === 0 ? {} : v);
  const legacy = (content.slice(0, start) + content.slice(end + 4)).trim();
  return {
    blocks: asMap(parsed.blocks) ?? {},
    blocksLayout: parsed.blocksLayout ?? { items: [] },
    legacy,
  };
}

export class WordPressAdapter extends BaseAdapter {
  /**
   * `translations` is only meaningful once a plugin provides them: core
   * WordPress holds one language. Polylang and WPML both keep a separate POST
   * per language and relate them, which is the grouped kind — so that is the
   * default here, and it takes effect only when something reports more than one
   * language.
   */
  constructor({
    cmsBaseUrl,
    nonce,
    credentials,
    postType = 'pages',
    translations = 'grouped',
    // Whether the Hydra Companion plugin is installed (see
    // companion-plugin/). WordPress keeps real edit locks in `_edit_lock`, but
    // protected meta is unreachable over REST until something registers it, so
    // the operations exist only where that plugin does.
    //
    // OPT-IN, and never probed-and-assumed: advertising a lock field without
    // the operations behind it is worse than having neither, because Volto locks
    // on `content.lock !== undefined` alone and a failed lock blanks the loaded
    // content instead of just failing.
    locking = false,
    // Whether Polylang AND the companion plugin are installed.
    //
    // Separate from `translations`, which says what KIND of multilingual this
    // site is: Polylang keeps one post per language and relates them, so the
    // kind stays 'grouped'. This option says the operations exist at all.
    //
    // Polylang ships REST routes for the language LIST but none for a post's
    // language or its translation group, which is what the companion adds.
    multilingual = false,
  } = {}) {
    super({
      name: 'wordpress',
      capabilities: [
        'content',
        // NOT navigation-exclusion or navigation-title.
        //
        // "Hide from navigation" is a PLONE mechanism — a field on its content
        // type schema — and generalising it to every CMS was a mistake. WordPress
        // has no per-page equivalent to map, and inventing post meta for it meant
        // advertising a capability that was true only on sites running our own
        // plugin.
        //
        // WordPress expresses menu membership by which MENU a page is in, and a
        // menu is a separate curated view over the same content. That belongs to
        // the views model — a view selector in the contents view and the picker —
        // not to a flag on the document. See
        // superpowers/specs/2026-10-02-content-trees-and-menus-design.md
        // Only with the companion plugin — see the `locking` option.
        ...(locking ? ['locking'] : []),
        // Only with Polylang + the companion plugin — see `multilingual`.
        ...(multilingual ? ['multilingual'] : []),
        // WordPress core takes 25 requests per /batch/v1 call, and its
        // require-all-or-none mode is a real all-or-nothing promise — so unlike
        // the emulated floor, this adapter can honour `atomic`. See applyBatch.
        'batch-native',
        // WordPress keeps no back-reference index, but its REST `search` is a
        // LIKE over post_content — and our blocks live in the page content as a
        // comment, so the links inside them are searchable server-side. Same
        // shape as Drupal's CONTAINS filter, same boundary re-check after it.
        'link-integrity',
        'search-fulltext',
        // WordPress filters by parent, type and status server-side; tree.list
        // relies on it, so claiming otherwise would be false advertising.
        'search-filter',
        'vocabulary',
        'schema',
        'asset',
        'state',
        // Deliberately absent: per-content-permissions. Vanilla WordPress has
        // no per-post principal grants, so the sharing half of the panel must
        // hide rather than show something it cannot honour.
      ],
    });
    this.cmsBaseUrl = cmsBaseUrl;
    this.translationsMode = translations;
    // { username, appPassword } from WordPress's application-password flow.
    // Sent as Basic auth, which is how WordPress accepts a credential from a
    // client acting on behalf of a user — and unlike a cookie it works
    // cross-origin, which a proxy on another origin needs.
    this.credentials = credentials ?? null;
    this.nonce = nonce ?? null;
    this.postType = postType;
    this.locking = locking;
    this.multilingual = multilingual;
    // Session-stable SITE metadata: the content types, their field schemas and
    // the taxonomy list. See cachedMeta.
    this.metaCache = new Map();
    this.pathCache = new Map();
    // id -> {slug, parent}. Rebuilding a path walks the parent chain one
    // request per ancestor, and a listing repeats that walk for every sibling:
    // 20 posts under /news fetched /news 20 times. Cleared by any mutation,
    // since a move changes exactly this.
    this.ancestorCache = new Map();
    // type id -> REST base. 'page' is served at /wp/v2/pages, so a filter
    // carrying the type id built /wp/v2/page and 404'd.
    this.restBases = null;
  }

  async init(ctx) {
    await super.init(ctx);
    this.cmsBaseUrl = ctx.cmsBaseUrl ?? this.cmsBaseUrl;
    if (!this.nonce) this.nonce = await this.fetchNonce();
  }

  /**
   * WordPress cookie auth is not sufficient for the REST API on its own; every
   * authenticated call needs a nonce. In a real frontend this comes from
   * wp_localize_script as window.wpApiSettings.nonce; admin-ajax is the
   * fallback when the page did not enqueue it.
   */
  async fetchNonce() {
    if (typeof window !== 'undefined' && window.wpApiSettings?.nonce) {
      return window.wpApiSettings.nonce;
    }
    const res = await fetch(
      `${this.cmsBaseUrl}/wp-admin/admin-ajax.php?action=rest-nonce`,
      { credentials: 'include' },
    );
    if (!res.ok) return null;
    return (await res.text()).trim();
  }

  /**
   * Pretty permalinks are not guaranteed to be on, and /wp-json 302s when they
   * are not. The rest_route query form always works.
   */
  url(route, params = {}) {
    const qs = new URLSearchParams({ rest_route: route, ...params });
    return `${this.cmsBaseUrl}/?${qs.toString()}`;
  }

  /**
   * See the Plone adapter. One extra concern here: requestJson records the
   * collection size in this.lastTotal from the X-WP-Total header, and callers
   * read it immediately afterwards. A cache hit does not re-run that
   * assignment, and an unrelated fetch in between would leave the wrong number
   * standing, so the total is cached WITH the body and restored on every hit.
   */
  async fetchJson(route, options = {}) {
    const method = options.method ?? 'GET';
    if (method !== 'GET') {
      this.invalidateReads();
      return this.requestJson(route, options);
    }
    const entry = await this.cachedRead(
      `GET ${this.scopeKey(route, options.params)}`,
      async () => {
        const body = await this.requestJson(route, options);
        return { body, lastTotal: this.lastTotal };
      },
    );
    this.lastTotal = entry.lastTotal;
    return entry.body;
  }

  /**
   * Read session-stable METADATA through a cache of its own.
   *
   * Content types, their field schemas and the taxonomy list describe the
   * SITE, not the content: editing a page cannot change them. So they are kept
   * apart from the read cache, which every write clears — otherwise saving a
   * block would throw away a schema that had not changed and buy back a round
   * trip for nothing.
   *
   * They are re-asked for constantly. The Toolbar fetches the types on mount
   * AND on every path change to build its "Add" menu, and the edit form asks
   * for a schema each time it mounts; on PHP-WASM that is about a second each.
   *
   * The PROMISE is cached, not the value, so concurrent callers share one
   * request. A failure is evicted rather than remembered — a schema that could
   * not be fetched once must not be permanently unavailable.
   *
   * Cleared when the credential changes: what a user may create, and which
   * fields they may see, depend on who they are.
   */
  async cachedMeta(key, run) {
    if (this.metaCache.has(key)) return this.metaCache.get(key);
    const pending = Promise.resolve().then(run);
    this.metaCache.set(key, pending);
    try {
      return await pending;
    } catch (err) {
      this.metaCache.delete(key);
      throw err;
    }
  }

  async requestJson(route, { method = 'GET', body, params = {} } = {}) {
    const headers = { Accept: 'application/json', ...this.authHeaders() };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(this.url(route, params), {
      method,
      // With an explicit nonce we must NOT also send cookies: a wildcard
      // Access-Control-Allow-Origin makes the browser reject a credentialled
      // cross-origin request outright, surfacing only as "Failed to fetch".
      // Same bug the Plone and Drupal adapters had.
      credentials: this.nonce || this.credentials ? 'omit' : 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      throw new AdapterError('Unauthorized', {
        code: 'UNAUTHORIZED',
        status: 401,
      });
    }
    if (res.status === 404) {
      throw new AdapterError(`Not found: ${route}`, {
        code: 'NOT_FOUND',
        status: 404,
      });
    }
    if (!res.ok) {
      throw new AdapterError(`WordPress returned ${res.status} for ${route}`, {
        code: 'SERVER_ERROR',
        status: res.status,
      });
    }
    // X-WP-Total carries the unpaginated count; without it a caller cannot
    // tell "25 results" from "25 of 10000".
    this.lastTotal = Number(res.headers.get('X-WP-Total') ?? '0');
    const text = await res.text();
    return text.length === 0 ? null : JSON.parse(text);
  }

  /**
   * WordPress addresses content by id, Hydra by path. Pages carry a slug and a
   * parent, so a path is resolved a segment at a time down the tree — which
   * also means "/news/first-post" cannot collide with a different "first-post"
   * elsewhere.
   */
  async resolvePath(path) {
    if (path === '/' || path === '') {
      throw new AdapterError('WordPress has no root document', {
        code: 'NOT_FOUND',
        status: 404,
      });
    }
    if (this.pathCache.has(path)) return this.pathCache.get(path);

    const segments = path.split('/').filter(Boolean);

    // ONE request for every slug in the path, resolved in memory.
    //
    // This walked the tree a segment at a time, which is a full round trip per
    // segment — and against WordPress-on-WASM a round trip is ~1.1s regardless
    // of payload, so a two-segment path cost two seconds before any real work
    // began. WordPress accepts a slug list, so the whole chain arrives at once
    // and the parent pointers are matched here.
    //
    // The disambiguation is unchanged: each segment must sit under the previous
    // one, so "/news/first-post" still cannot match a different "first-post"
    // elsewhere in the tree.
    const PER_PAGE = 100;
    const candidates = await this.fetchJson(`/wp/v2/${this.postType}`, {
      params: {
        slug: segments.join(','),
        per_page: String(PER_PAGE),
        status: 'any',
        // id, slug and parent are all a path resolution needs. Without this the
        // response carries every field of every candidate — content included —
        // to answer a question about three of them.
        _fields: 'id,slug,parent',
      },
    });

    // A full page means there may be more candidates we cannot see, and picking
    // from a truncated set could resolve to the WRONG page — a site with fifty
    // "about" pages in different branches would not necessarily have ours in
    // the first hundred. Fall back to the walk, which is slower but cannot be
    // fooled: it asks for one slug under one specific parent at a time.
    if ((candidates?.length ?? 0) >= PER_PAGE) {
      return this.resolvePathByWalking(path, segments);
    }

    let parent = 0;
    let id = null;
    let walked = '';
    for (const slug of segments) {
      const hit = (candidates ?? []).find(
        (c) => c.slug === slug && (c.parent ?? 0) === parent,
      );
      if (!hit) {
        throw new AdapterError(`Not found: ${path}`, {
          code: 'NOT_FOUND',
          status: 404,
        });
      }
      id = hit.id;
      parent = id;

      // Every ancestor was resolved on the way past, so cache them too rather
      // than making the next lookup pay for the same walk.
      walked = `${walked}/${slug}`;
      this.pathCache.set(walked, hit.id);
      this.ancestorCache.set(hit.id, { slug: hit.slug, parent: hit.parent });
    }
    this.pathCache.set(path, id);
    return id;
  }

  /**
   * One request per segment, each scoped to the parent found by the last.
   *
   * Slower, but it cannot be defeated by slug collisions at any scale, because
   * it never has to choose between candidates: the CMS is asked for this slug
   * under this parent. Kept as the fallback for when the single-query form
   * cannot prove it saw every candidate.
   */
  async resolvePathByWalking(path, segments) {
    let parent = 0;
    let id = null;
    let walked = '';
    for (const slug of segments) {
      const matches = await this.fetchJson(`/wp/v2/${this.postType}`, {
        params: {
          slug,
          parent: String(parent),
          status: 'any',
          _fields: 'id,slug,parent',
        },
      });
      if (!matches || matches.length === 0) {
        throw new AdapterError(`Not found: ${path}`, {
          code: 'NOT_FOUND',
          status: 404,
        });
      }
      id = matches[0].id;
      parent = id;
      walked = `${walked}/${slug}`;
      this.pathCache.set(walked, id);
      this.ancestorCache.set(id, { slug: matches[0].slug, parent: matches[0].parent });
    }
    this.pathCache.set(path, id);
    return id;
  }

  /** Walk parent ids up to the root, collecting slugs, so a path can be rebuilt. */
  async ancestryOf(post) {
    const chain = await this.ancestorChain(post);
    return chain.map((entry) => entry.path.split('/').pop());
  }

  /**
   * The ancestors of a post, root-first, as { path, post } pairs.
   *
   * Same single walk as ancestryOf, but it keeps the posts it fetched instead
   * of throwing them away and letting the caller fetch them again. The walk
   * itself is irreducibly sequential — a post names only its immediate parent
   * — but it is the only part that has to be.
   */
  async ancestorChain(post) {
    const chain = [];
    let parentId = post.parent;
    while (parentId) {
      let entry = this.ancestorCache.get(parentId);
      if (!entry) {
        const parent = await this.fetchJson(
          `/wp/v2/${this.postType}/${parentId}`,
          { params: { context: 'edit' } },
        );
        entry = { slug: parent.slug, parent: parent.parent, post: parent };
        this.ancestorCache.set(parentId, entry);
      }
      chain.unshift({ id: parentId, entry });
      parentId = entry.parent;
    }

    // resolvePath populates this cache from a _fields=id,slug,parent query to
    // keep path resolution cheap, so an entry can legitimately arrive without
    // its post. Those fetches are independent once the chain is known, so they
    // go out together instead of one per level.
    await Promise.all(
      chain
        .filter(({ entry }) => !entry.post)
        .map(async ({ id, entry }) => {
          entry.post = await this.fetchJson(`/wp/v2/${this.postType}/${id}`, {
            params: { context: 'edit' },
          });
          this.ancestorCache.set(id, entry);
        }),
    );

    return chain.map(({ entry }, i) => ({
      path: `/${chain.slice(0, i + 1).map((e) => e.entry.slug).join('/')}`,
      post: entry.post,
    }));
  }

  /**
   * REST base for a post type id, e.g. page -> pages.
   *
   * Returns null for a type this site does not have. Filtering by a
   * non-existent type has no results by definition, and guessing an endpoint
   * from the id turns that into a 404 the caller cannot distinguish from a
   * broken request.
   */
  async restBaseFor(typeId) {
    if (!this.restBases) {
      const types = await this.cachedMeta('types', () => this.fetchJson('/wp/v2/types'));
      this.restBases = new Map(
        Object.entries(types ?? {}).map(([id, t]) => [id, t.rest_base ?? id]),
      );
    }
    return this.restBases.get(typeId) ?? null;
  }

  pathFor(post, ancestry) {
    return `/${[...ancestry, post.slug].join('/')}`;
  }

  /**
   * The document's path, without walking the tree when WordPress already knows.
   *
   * The canonical model addresses content by path, and WordPress is the only
   * one of the three CMSes that does not store one: Plone's path IS its
   * address, Drupal carries path.alias as a field, and WordPress derives a
   * permalink from the parent chain. So every id -> path cost an ancestor walk,
   * once PER ITEM in a listing — a genuine N+1 that the cache only hid until
   * the next mutation cleared it.
   *
   * `link` is that permalink, already in the response: no request at all.
   *
   * Except for drafts. Unpublished content has no public URL, so WordPress
   * returns ?page_id=N instead of a path, and those still have to be walked.
   * That is a real asymmetry of the CMS, not something to paper over — the
   * model wants a path for every document, published or not.
   */
  async pathOfPost(post) {
    const link = typeof post?.link === 'string' ? post.link : '';
    if (link && !link.includes('?')) {
      const { pathname } = new URL(link, this.cmsBaseUrl);
      const path = pathname.replace(/\/+$/, '');
      if (path) {
        this.pathCache.set(path, post.id);
        return path;
      }
    }
    // Draft, or a site without pretty permalinks: fall back to the walk.
    return this.pathFor(post, await this.ancestryOf(post));
  }

  toDocument(post, path) {
    const raw = post.content?.raw ?? '';
    const { blocks, blocksLayout, legacy } = parseBlocks(raw);
    return {
      id: String(post.id),
      path,
      type: post.type,
      title: post.title?.raw ?? post.title?.rendered ?? '',
      blocks,
      blocksLayout,
      fields: {
        legacyContent: legacy,
        slug: post.slug,
        link: post.link,
        // From the companion plugin's rest field, on the same read as the
        // content — so there is no window where the document is loaded but
        // whether someone else holds it is not yet known.
        //
        // Omitted entirely when locking is off, which the contract requires:
        // a lock field sends the admin after operations this adapter would not
        // have.
        ...(this.locking && post.hydra_lock != null
          ? { lock: post.hydra_lock }
          : {}),
      },
      state: STATE_MAP[post.status] ?? post.status,
      _adapter: { raw: post },
    };
  }

  /** The menu term for a view's slug. */
  async menuForView(menu) {
    const menus = await this.fetchJson('/wp/v2/menus', {
      params: { per_page: '100' },
    });
    const found = (menus ?? []).find((m) => m.slug === menu);
    if (!found) {
      throw new AdapterError(`wordpress: no menu named ${menu}`, {
        code: 'NOT_FOUND',
        status: 404,
      });
    }
    return found;
  }

  /**
   * A menu's nodes, as CONTENT.
   *
   * A node is a PLACEMENT that may reference content — its identity is the
   * placement, not the page, which is what makes "the same page twice" a
   * non-question. Per-placement properties live here, which is where WordPress
   * already keeps them: two placements of one page can carry two different
   * labels, as `title` does below.
   *
   * `reference` is the content path, resolved so a caller never has to turn an
   * object_id into a path itself. The picker must take the stored value from
   * HERE and never from the browse location — a synthetic path that escaped into
   * stored data would look right in the editor and break on the public site.
   */
  async listPlacements({ menu, excluded, placementId }) {
    const term = await this.menuForView(menu);
    const items = await this.fetchJson('/wp/v2/menu-items', {
      params: {
        menus: String(term.id),
        per_page: '100',
        // An UNPUBLISHED menu item is WordPress's own "in the menu's definition
        // but not in the menu" — wp_get_nav_menu_items asks for published only,
        // and so does WPGraphQL. That is what the Excluded node holds.
        status: excluded ? 'draft' : 'publish',
        context: 'edit',
      },
    });

    const wantedParent = placementId ?? 0;
    const children = (items ?? [])
      .filter((item) => Number(item.parent ?? 0) === Number(wantedParent))
      .sort((a, b) => (a.menu_order ?? 0) - (b.menu_order ?? 0));

    // ONE request for every referenced page, rather than one per placement.
    const pageIds = [
      ...new Set(
        children
          .filter((item) => item.type === 'post_type')
          .map((item) => Number(item.object_id))
          .filter(Boolean),
      ),
    ];
    const pathById = new Map();
    if (pageIds.length) {
      const posts = await this.fetchJson(`/wp/v2/${this.postType}`, {
        params: {
          include: pageIds.join(','),
          per_page: String(pageIds.length),
          status: 'any',
          context: 'edit',
        },
      });
      for (const post of posts ?? []) {
        pathById.set(Number(post.id), await this.pathOfPost(post));
      }
    }

    const base = excluded
      ? `/${VIEW_PREFIX}/${menu}/${EXCLUDED_NODE}`
      : `/${VIEW_PREFIX}/${menu}`;

    const nodes = children.map((item) => ({
      id: String(item.id),
      path: `${base}/${item.id}`,
      // "link" is not a type, it is the ABSENCE of a reference.
      type: item.type === 'post_type' ? 'placement' : 'link',
      title: item.title?.rendered ?? '',
      blocks: {},
      blocksLayout: { items: [] },
      fields: {
        reference: pathById.get(Number(item.object_id)) ?? null,
        url: item.url ?? null,
      },
      state: STATE_MAP[item.status] ?? item.status,
      _adapter: { raw: item },
    }));

    // The bucket is offered at the view's ROOT, so what was taken out of the
    // menu is discoverable in the menu rather than only through the picker.
    // Not selectable: it is a bucket, not content.
    if (!excluded && !placementId) {
      nodes.push({
        id: EXCLUDED_NODE,
        path: `/${VIEW_PREFIX}/${menu}/${EXCLUDED_NODE}`,
        type: 'bucket',
        title: 'Not in this menu',
        blocks: {},
        blocksLayout: { items: [] },
        fields: { reference: null, url: null },
        state: 'private',
        _adapter: { raw: null },
      });
    }

    return { items: nodes };
  }

  /**
   * Move a placement into or out of the Excluded node.
   *
   * Membership is a MOVE, which is why content.delete can mean "destroy this" in
   * every view. Here it is the menu item's own publish status — the page is never
   * touched either way.
   */
  async movePlacement(fromView, toView, args) {
    if (!fromView || !fromView.rest) {
      throw new AdapterError(
        `wordpress: ${args.path} is not something in a menu view`,
        { code: 'INVALID_MOVE', status: 400 },
      );
    }
    if (!toView || toView.menu !== fromView.menu) {
      throw new AdapterError(
        'wordpress: a menu placement can only move within its own menu; to ' +
          'put a page in a different menu, add it there and remove it here',
        { code: 'INVALID_MOVE', status: 400 },
      );
    }
    if (toView.rest) {
      throw new AdapterError(
        'wordpress: reparenting inside a menu is not implemented yet; this ' +
          'moves a placement between the menu and its Excluded node',
        { code: 'NOT_IMPLEMENTED', status: 501 },
      );
    }

    const placementId = Number(fromView.rest);
    const updated = await this.fetchJson(`/wp/v2/menu-items/${placementId}`, {
      method: 'POST',
      body: { status: toView.excluded ? 'draft' : 'publish' },
    });
    const base = toView.excluded
      ? `/${VIEW_PREFIX}/${toView.menu}/${EXCLUDED_NODE}`
      : `/${VIEW_PREFIX}/${toView.menu}`;
    return { path: `${base}/${placementId}`, id: String(updated.id) };
  }

  /**
   * Add a placement to a menu.
   *
   * `data.reference` is a CONTENT path; the page itself is untouched. Appended
   * last, because a position the caller did not ask for is not ours to invent.
   */
  async addPlacement({ menu, placementId }, data) {
    const term = await this.menuForView(menu);
    const reference = data.reference ?? data.path;
    // A node with a URL and no reference is an EXTERNAL LINK — "link" is not a
    // type, it is the absence of a reference. WordPress calls it a `custom` menu
    // item, which is its own object holding a url and a label and pointing at no
    // post at all.
    const url = data.url ?? null;
    if (!reference && !url) {
      throw new AdapterError(
        'wordpress: a menu node needs either a reference to content or a url',
        { code: 'BAD_REQUEST', status: 400 },
      );
    }
    const pageId = reference ? await this.resolvePath(reference) : null;

    const existing = await this.fetchJson('/wp/v2/menu-items', {
      params: {
        menus: String(term.id),
        per_page: '100',
        status: 'publish,draft',
        context: 'edit',
      },
    });
    const lastOrder = (existing ?? []).reduce(
      (highest, item) => Math.max(highest, Number(item.menu_order ?? 0)),
      0,
    );

    const created = await this.fetchJson('/wp/v2/menu-items', {
      method: 'POST',
      body: {
        menus: term.id,
        title: data.title ?? undefined,
        ...(reference
          ? {
              type: 'post_type',
              object: this.postType === 'pages' ? 'page' : this.postType,
              object_id: pageId,
            }
          : { type: 'custom', url }),
        parent: placementId ?? 0,
        menu_order: lastOrder + 1,
        status: 'publish',
      },
    });

    return {
      id: String(created.id),
      path: `/${VIEW_PREFIX}/${menu}/${created.id}`,
      type: reference ? 'placement' : 'link',
      title: created.title?.rendered ?? '',
      blocks: {},
      blocksLayout: { items: [] },
      fields: { reference: reference ?? null, url: created.url ?? url },
      state: STATE_MAP[created.status] ?? created.status,
      _adapter: { raw: created },
    };
  }

  /**
   * A post's Polylang translation group, via the companion plugin.
   */
  async translationGroup(id) {
    try {
      const body = await this.fetchJson(`/hydra/v1/translations/${id}`);
      return body.items ?? [];
    } catch (err) {
      if (err?.status === 404 && /rest_no_route/.test(err?.message ?? '')) {
        throw new AdapterError(
          'wordpress: multilingual was enabled but Polylang or the Hydra ' +
            'Companion plugin is not installed, so WordPress has no ' +
            'translation group to report',
          { code: 'NOT_IMPLEMENTED', status: 501 },
        );
      }
      throw err;
    }
  }

  async whoami() {
    return this.dispatch('auth.whoami', {});
  }

  /**
   * WordPress's pre-publish panel, as data.
   */
  async transitionForms(path) {
    const id = await this.resolvePath(path);
    const post = await this.fetchJson(`/wp/v2/${this.postType}/${id}`, {
      params: { context: 'edit' },
    });

    // This is WordPress's pre-publish panel, as data. It was never a
    // special case worth hardcoding in the admin — it is just what this
    // CMS asks for when you publish, the way Plone asks for effective and
    // expiration dates.
    const publishSchema = {
      fieldsets: [
        {
          id: 'default',
          title: 'Default',
          fields: ['date', 'visibility', 'password', 'slug'],
        },
      ],
      properties: {
        date: {
          title: 'Publish',
          description:
            'Leave empty to publish immediately. A future date schedules it — the post stays invisible until then.',
          type: 'string',
          widget: 'datetime',
        },
        visibility: {
          title: 'Visibility',
          description:
            'Private is visible to editors and administrators only. Password-protected is visible to anyone who has the password.',
          type: 'string',
          choices: [
            ['public', 'Public'],
            ['private', 'Private'],
            ['password', 'Password protected'],
          ],
        },
        password: {
          title: 'Password',
          description: 'Used only when visibility is password-protected.',
          type: 'string',
        },
        slug: {
          title: 'URL slug',
          description: 'The last part of this post\u2019s address.',
          type: 'string',
        },
      },
      required: [],
    };

    const current = {
      date: post.status === 'future' ? post.date : '',
      visibility:
        post.status === 'private'
          ? 'private'
          : post.password
            ? 'password'
            : 'public',
      password: post.password ?? '',
      slug: post.slug,
    };

    const empty = { fieldsets: [], properties: {}, required: [] };
    const forms = {};
    for (const t of TRANSITIONS[post.status] ?? []) {
      // Only becoming visible asks anything. Going back to draft or
      // pending takes it away from an audience; there is nothing to
      // configure about that.
      forms[t.id] =
        t.targetState === 'published' || t.targetState === 'private'
          ? { schema: publishSchema, data: current }
          : { schema: empty, data: {} };
    }
    return forms;
  }

  async dispatch(intent, args) {
    return this.dispatchWithInvalidation(intent, args, () =>
      this.withAuthRetry(() => this.dispatchOnce(intent, args)),
    );
  }

  /**
   * How this adapter proves who it is, wherever it makes a request.
   *
   * Centralised because it was not: requestJson learned to send the
   * application password while asset.upload — a hand-built fetch with its own
   * headers — kept sending only a nonce. Uploads then went out anonymous and
   * came back 401, which surfaced as an image that never rendered rather than
   * as an auth failure.
   */
  authHeaders() {
    return {
      ...(this.nonce ? { 'X-WP-Nonce': this.nonce } : {}),
      ...(this.credentials ? { Authorization: this.basicAuth() } : {}),
    };
  }

  /** Basic auth from an application password. */
  basicAuth() {
    const { username, appPassword } = this.credentials;
    // Application passwords are issued with spaces for readability; WordPress
    // accepts them either way, but stripping keeps the header canonical.
    const raw = `${username}:${String(appPassword).replace(/\s+/g, '')}`;
    const bytes = new TextEncoder().encode(raw);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return `Basic ${btoa(binary)}`;
  }

  /**
   * A batch WordPress can promise, or none at all.
   *
   * /batch/v1 (core, 5.6+) takes up to 25 requests per call, and its
   * `require-all-or-none` validation pre-flights every one and applies nothing if
   * any would fail. That is exactly `atomic`, which the emulated floor cannot
   * offer — so this is where the capability earns its name.
   *
   * It is NOT used for ordinary batches, and that is deliberate: with default
   * validation WordPress attempts every request even after one fails, so a
   * grouped non-atomic batch could not keep the floor's promise that nothing
   * after the failure ran. A caller who did not ask for atomicity gets the
   * sequential floor, whose semantics are exact.
   *
   * Only all-`content.update` batches are grouped. A create's id is not known
   * until it returns, and an upload is multipart — batching those would need the
   * responses of earlier requests, which one call cannot provide. Anything mixed
   * goes to the floor rather than being half-grouped.
   */
  async applyBatch(args = {}) {
    const operations = args.operations ?? [];
    const groupable =
      args.atomic &&
      operations.length > 0 &&
      operations.every((op) => op?.intent === 'content.update');
    if (!groupable) return super.applyBatch(args);

    // Preparation is reads, so it may run concurrently: resolve each path, and
    // fetch current content only where blocks are being written (content.update
    // preserves legacy markup alongside them).
    const requests = await Promise.all(
      operations.map(async ({ args: opArgs }) => {
        const id = await this.resolvePath(opArgs.path);
        const body = {};
        if (opArgs.data.title !== undefined) body.title = opArgs.data.title;
        if (opArgs.data.blocks !== undefined) {
          const current = await this.fetchJson(`/wp/v2/${this.postType}/${id}`, {
            params: { context: 'edit' },
          });
          const { legacy } = parseBlocks(current.content?.raw ?? '');
          const serialized = serializeBlocks(
            opArgs.data.blocks,
            opArgs.data.blocksLayout ?? { items: [] },
          );
          body.content = legacy ? `${serialized}\n${legacy}` : serialized;
        }
        return { method: 'POST', path: `/wp/v2/${this.postType}/${id}`, body };
      }),
    );

    // Chunked at 25, the endpoint's own limit. More than one chunk means the
    // all-or-none promise holds WITHIN each chunk and not across them, so that is
    // said out loud rather than left for a caller to discover.
    if (requests.length > 25) {
      throw new AdapterError(
        `WordPress applies at most 25 requests atomically (asked for ` +
          `${requests.length}). Split the batch, or drop atomic and handle ` +
          `failedIndex.`,
        { code: 'BATCH_TOO_LARGE', status: 400 },
      );
    }

    const answer = await this.fetchJson('/batch/v1', {
      method: 'POST',
      body: { validation: 'require-all-or-none', requests },
    });
    const failed = (answer?.responses ?? []).findIndex(
      (r) => r && r.status >= 400,
    );
    if (answer?.failed || failed !== -1) {
      const error = new AdapterError(
        `WordPress applied none of the ${requests.length} operations: ` +
          `pre-flight rejected operation ${failed === -1 ? '(unknown)' : failed}`,
        { code: 'BATCH_REJECTED', status: 400 },
      );
      error.failedIndex = failed === -1 ? undefined : failed;
      error.applied = 0;
      throw error;
    }
    return { results: (answer?.responses ?? []).map(() => null) };
  }

  /**
   * Signing out has to drop the NONCE as well as the credential.
   *
   * BaseAdapter.logout clears authToken, credentials and csrfToken — enough for a
   * bearer-token CMS, where forgetting the token is the whole of it. WordPress
   * authenticates a session with a cookie plus this nonce, and every request
   * sends `X-WP-Nonce: this.nonce`, so a logout that left it set kept presenting
   * a working session: whoami still answered as the signed-in user afterwards.
   *
   * That is the shared-machine case the contract warns about — the admin looks
   * signed out while the credential that reaches content still works — and it was
   * failing in CI unseen, because the contract step piped vitest through tee and
   * reported tee's exit status.
   */
  async logout() {
    await super.logout();
    this.nonce = null;
  }

  async dispatchOnce(intent, args) {
    switch (intent) {
      case 'content.get': {
        const id = await this.resolvePath(args.path);
        const post = await this.fetchJson(`/wp/v2/${this.postType}/${id}`, {
          params: { context: 'edit' },
        });
        return this.withContext(
          this.toDocument(post, args.path),
          args.path,
          args.expand,
        );
      }

      case 'content.update': {
        const id = await this.resolvePath(args.path);
        const body = {};
        if (args.data.title !== undefined) body.title = args.data.title;
        if (args.data.blocks !== undefined) {
          const current = await this.fetchJson(
            `/wp/v2/${this.postType}/${id}`,
            { params: { context: 'edit' } },
          );
          const { legacy } = parseBlocks(current.content?.raw ?? '');
          const serialized = serializeBlocks(
            args.data.blocks,
            args.data.blocksLayout ?? { items: [] },
          );
          body.content = legacy ? `${serialized}\n${legacy}` : serialized;
        }
        await this.fetchJson(`/wp/v2/${this.postType}/${id}`, {
          method: 'POST',
          body,
        });
        return null;
      }

      case 'content.create': {
        const intoView = parseViewPath(args.parentPath);
        if (intoView) {
          return this.addPlacement(
            { menu: intoView.menu, placementId: intoView.rest ? Number(intoView.rest) : null },
            args.data ?? {},
          );
        }

        const parentId =
          args.parentPath === '/' ? 0 : await this.resolvePath(args.parentPath);
        const post = await this.fetchJson(`/wp/v2/${this.postType}`, {
          method: 'POST',
          body: {
            title: args.data.title,
            // Explicit: a draft would otherwise have no slug at all, and the
            // document would not be addressable by path until published. The
            // id the caller asked for comes before the title: an importer
            // recreating a tree addresses the document by it next.
            slug: args.data.slug ?? args.data.id ?? slugify(args.data.title),
            status: 'draft',
            parent: parentId,
            content: serializeBlocks(
              args.data.blocks ?? {},
              args.data.blocksLayout ?? { items: [] },
            ),
          },
        });
        if (!post.slug) {
          throw new AdapterError(
            `WordPress created post ${post.id} with no slug; it has no addressable path`,
            { code: 'NO_SLUG' },
          );
        }
        const parentSegments =
          args.parentPath === '/'
            ? []
            : args.parentPath.split('/').filter(Boolean);
        return this.toDocument(post, this.pathFor(post, parentSegments));
      }

      case 'content.delete': {
        const placement = parseViewPath(args.path);
        if (placement) {
          const placementId = placement.rest ? Number(placement.rest) : null;
          if (!placementId) {
            throw new AdapterError(
              `wordpress: ${args.path} is a view, not something in it`,
              { code: 'BAD_REQUEST', status: 400 },
            );
          }
          // UNLINK, never delete. Removing a page from a menu must leave the page
          // alone — that is the whole difference between tidying a menu and
          // losing a page, and it is what `remove: 'unlink'` means on the view.
          await this.fetchJson(`/wp/v2/menu-items/${placementId}`, {
            method: 'DELETE',
            params: { force: 'true' },
          });
          return null;
        }

        const id = await this.resolvePath(args.path);
        await this.fetchJson(`/wp/v2/${this.postType}/${id}`, {
          method: 'DELETE',
          params: { force: 'true' },
        });
        // Same reasoning as content.move: the deleted post and anything under
        // it are stale, nothing else is.
        for (const cached of [...this.pathCache.keys()]) {
          if (cached === args.path || cached.startsWith(`${args.path}/`)) {
            this.pathCache.delete(cached);
          }
        }
        this.ancestorCache.delete(id);
        return null;
      }

      case 'state.get': {
        const id = await this.resolvePath(args.path);
        const post = await this.fetchJson(`/wp/v2/${this.postType}/${id}`, {
          params: { context: 'edit' },
        });
        // WordPress answers "may this user publish this post" per object, in
        // the edit-context response we already have: the presence of
        // wp:action-publish IS the answer. A Contributor holds edit_posts
        // without publish_posts, and hardcoding true here put a Publish button
        // in front of them that the REST API then refused.
        const canPublish = Boolean(
          post._links?.['https://api.w.org/action-publish'],
        );
        return {
          state: {
            name: STATE_MAP[post.status] ?? post.status,
            label: post.status,
          },
          transitions: TRANSITIONS[post.status] ?? [],
          effective: {
            canEdit: true,
            canPublish,
            canDelete: true,
            canShare: false,
            canComment: post.comment_status === 'open',
          },
          // Vanilla WordPress has no per-post grants; the sharing half of the
          // panel hides on this rather than showing an empty list.
          shareEntries: null,

          // Screens WordPress would rather show itself.
          //
          // These are not reimplementations waiting to be written: wp-admin
          // already has a media library and a settings page, and the user is
          // logged into it in their own browser. Delegating means no second
          // login and no second implementation.
          //
          // All open in a new window. wp-admin sends
          // X-Frame-Options: SAMEORIGIN, and a Hydra admin is never on the
          // CMS's origin, so an inline frame would come back blank with
          // nothing to tell the user.
          actions: [
            {
              id: 'wp-edit-native',
              title: 'Edit in WordPress',
              url: `${this.cmsBaseUrl}/wp-admin/post.php?post=${id}&action=edit`,
              category: 'object',
              target: 'window',
            },
            {
              id: 'wp-media',
              title: 'Media library',
              url: `${this.cmsBaseUrl}/wp-admin/upload.php`,
              category: 'site',
              target: 'window',
            },
            {
              // Your own account belongs to the CMS that holds it. Changing a
              // password or an email is not something to reimplement here, and
              // the admin has no credentials to do it with anyway.
              id: 'preferences',
              title: 'Your profile',
              url: `${this.cmsBaseUrl}/wp-admin/profile.php`,
              category: 'user',
              // Answers the admin's own Profile screen, which against
              // WordPress would PATCH endpoints that do not exist.
              panel: 'profile',
            },
            {
              id: 'wp-settings',
              title: 'Site settings',
              url: `${this.cmsBaseUrl}/wp-admin/options-general.php`,
              category: 'site',
              target: 'window',
              // Answers Site Setup. The media library above is also `site`,
              // which is why the category alone cannot say this.
              panel: 'site-setup',
            },
          ],
        };
      }

      case 'state.getForms':
        return this.transitionForms(args.path);

      case 'state.transition': {
        const id = await this.resolvePath(args.path);
        const forms = await this.transitionForms(args.path);
        this.assertDeclared(args.data, this.offeredTransition(forms, args.id).schema, args.id);
        const d = args.data ?? {};

        // WordPress has no transition call: state, schedule and visibility are
        // all fields on the post, set in the one write. Which is the same
        // reason its pre-publish panel exists — this IS the transition.
        const body = { status: args.id };
        if (d.date) body.date = d.date;
        if (d.slug) body.slug = d.slug;
        if (d.visibility === 'private') body.status = 'private';
        // Sent unconditionally when visibility was answered: clearing a
        // password is how you make a protected post public again, and skipping
        // an empty value would silently leave it protected.
        if (d.visibility !== undefined) {
          body.password = d.visibility === 'password' ? d.password : '';
        }

        await this.fetchJson(`/wp/v2/${this.postType}/${id}`, {
          method: 'POST',
          body,
        });
        return null;
      }

      case 'auth.logout':
        return this.logout();

      case 'auth.whoami': {
        const me = await this.fetchJson('/wp/v2/users/me', {
          params: { context: 'edit' },
        });
        return {
          id: String(me.id),
          username: me.slug,
          fullname: me.name,
          email: me.email,
          roles: me.roles ?? [],
        };
      }

      case 'reference.dependents': {
        // WordPress indexes no back-references, but it does not need to: our
        // blocks ride inside post_content as a comment, and REST `search` is a
        // LIKE over post_content — so the server does the scanning. Same shape
        // as Drupal's CONTAINS filter, and the same re-check afterwards.
        //
        // resolvePath first, so a path that does not exist is NOT_FOUND rather
        // than an empty list: "nothing links to it" must not be the answer to a
        // typo, which is the one answer a delete dialog must never give.
        const id = await this.resolvePath(args.path);
        const self = await this.fetchJson(`/wp/v2/${this.postType}/${id}`, {
          params: { context: 'edit' },
        });
        const path = await this.pathOfPost(self);
        // Both encodings a link here can carry: the path an author picks, and
        // the ?page_id= form that survives a slug change.
        const needles = [path, `?page_id=${id}`].filter(Boolean);

        const byId = new Map();
        for (const needle of needles) {
          const found = await this.fetchJson(`/wp/v2/${this.postType}`, {
            params: {
              search: needle,
              status: 'any',
              context: 'edit',
              per_page: '100',
            },
          });
          for (const candidate of found ?? []) {
            if (candidate.id === id) continue;
            // `search` is a substring match, so /about also matches /about-us,
            // and /news matches /news/first-post — which would make a link to a
            // CHILD look like a link to its parent and teach editors to dismiss
            // the warning. Re-check with a boundary that excludes a path
            // separator too, without knowing any block's shape.
            const content = candidate.content?.raw ?? '';
            const bounded = new RegExp(
              `${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w\\-/])`,
            );
            if (!bounded.test(content)) continue;
            byId.set(candidate.id, {
              id: String(candidate.id),
              path: await this.pathOfPost(candidate),
              title: candidate.title?.raw ?? candidate.title?.rendered ?? '',
            });
          }
        }
        return { references: [...byId.values()] };
      }

      case 'search': {
        const posts = await this.fetchJson(`/wp/v2/${this.postType}`, {
          params: {
            search: args.query ?? '',
            status: 'any',
            context: 'edit',
            per_page: String(args.limit ?? 25),
          },
        });
        const total = this.lastTotal;
        const items = [];
        for (const post of posts) {
          items.push(
            this.toDocument(post, await this.pathOfPost(post)),
          );
        }
        return { items, total };
      }

      case 'tree.list': {
        const view = parseViewPath(args.parent);
        if (view) {
          return this.listPlacements({
            menu: view.menu,
            excluded: view.excluded,
            placementId: view.rest ? Number(view.rest) : null,
          });
        }

        const parentId =
          args.parent === '/' ? 0 : await this.resolvePath(args.parent);
        const posts = await this.fetchJson(`/wp/v2/${this.postType}`, {
          params: {
            parent: String(parentId),
            status: 'any',
            context: 'edit',
            per_page: '100',
            // menu_order is the folder's OWN order — without it the ordering
            // set by content.order is invisible. An explicit sort replaces it,
            // named as an index the admin uses and mapped to WordPress's own
            // orderby; WordPress can do this itself, so unlike Drupal's
            // menu-derived tree there is nothing to sort client-side.
            orderby: args.sortOn ? orderByFor(args.sortOn) : 'menu_order',
            order: String(args.sortOrder ?? '').startsWith('desc')
              ? 'desc'
              : 'asc',
          },
        });
        const parentSegments =
          args.parent === '/' ? [] : args.parent.split('/').filter(Boolean);
        return {
          items: posts.map((p) => this.toDocument(p, this.pathFor(p, parentSegments))),
          total: this.lastTotal,
        };
      }

      case 'breadcrumbs.get': {
        const id = await this.resolvePath(args.path);
        const post = await this.fetchJson(`/wp/v2/${this.postType}/${id}`, {
          params: { context: 'edit' },
        });
        // Canonical breadcrumbs are the ancestors below the root, root-first,
        // including the document itself — matching the Plone adapter.
        //
        // The walk up already fetched every ancestor, so build the documents
        // from what it returns. This used to re-resolve and re-fetch each
        // ancestor path the walk had just visited: two extra round trips per
        // level, at ~1.1s each, for posts already in hand.
        const chain = await this.ancestorChain(post);
        const items = chain.map((entry) =>
          this.toDocument(entry.post, entry.path),
        );
        items.push(this.toDocument(post, args.path));
        return { items };
      }

      case 'content.lock':
      case 'content.unlock': {
        const id = await this.resolvePath(args.path);
        const taking = intent === 'content.lock';
        try {
          return await this.fetchJson(`/hydra/v1/lock/${id}`, {
            method: taking ? 'POST' : 'DELETE',
            body: taking && args.force ? { force: true } : undefined,
          });
        } catch (err) {
          // Distinguish "the plugin is not there" from "the post is not there".
          // Both arrive as 404, and the first is a deployment mistake that would
          // otherwise read as a missing document.
          if (err?.status === 404 && /rest_no_route/.test(err?.message ?? '')) {
            throw new AdapterError(
              'wordpress: locking was enabled but the Hydra Companion plugin ' +
                'is not installed, so WordPress exposes no lock over REST',
              { code: 'NOT_IMPLEMENTED', status: 501 },
            );
          }
          throw err;
        }
      }

      case 'translations.get': {
        const id = await this.resolvePath(args.path);
        const items = await this.translationGroup(id);
        return { items: items.map(({ language, path }) => ({ language, path })) };
      }

      case 'translations.locate': {
        // Where the CMS says the translation belongs, which is not a guess the
        // caller should make. Polylang has no per-language folder — one post per
        // language, related — so there is no /de/ branch to nest under, and the
        // answer is beside the translation of this document's PARENT where one
        // exists.
        const id = await this.resolvePath(args.path);
        const post = await this.fetchJson(`/wp/v2/${this.postType}/${id}`, {
          params: { context: 'edit' },
        });
        const parentId = Number(post.parent ?? 0);
        if (!parentId) return { path: '/' };

        const siblings = await this.translationGroup(parentId);
        const translated = siblings.find((t) => t.language === args.language);
        // No translated parent yet: the root, rather than nesting the
        // translation under a parent in the wrong language.
        return { path: translated?.path || '/' };
      }

      case 'translations.create': {
        const sourceId = await this.resolvePath(args.sourcePath);
        const created = await this.dispatch('content.create', {
          parentPath: args.parentPath,
          data: args.data,
        });
        // LINKING is the whole point. Without it this is a loose page that merely
        // looks like a translation, which is exactly the failure the contract
        // warns about — the editor finds out after typing a page.
        await this.fetchJson(`/hydra/v1/translations/${sourceId}/link`, {
          method: 'POST',
          body: { language: args.language, target_id: Number(created.id) },
        });
        return created;
      }

      case 'navigation.get': {
        const posts = await this.fetchJson(`/wp/v2/${this.postType}`, {
          params: { parent: '0', status: 'any', context: 'edit', per_page: '100' },
        });
        // Sorted HERE, by menu_order then title, rather than asking WordPress for
        // orderby=menu_order. The ordering itself is the point: menu_order is
        // what content.order writes. But asking the REST API to do it broke the
        // journey's link picker, reproducibly. Title breaks the tie, because
        // every page starts at menu_order 0.
        posts.sort(
          (a, b) =>
            (a.menu_order ?? 0) - (b.menu_order ?? 0) ||
            String(a.title?.rendered ?? a.title?.raw ?? '').localeCompare(
              String(b.title?.rendered ?? b.title?.raw ?? ''),
            ),
        );
        return {
          // THE PAGE TREE — the main hierarchy.
          //
          // Drupal's navigation.get reads menu links because its nodes are FLAT, so
          // a menu is its only hierarchy. WordPress pages form a tree, and that
          // tree is what its navigation is built from (wp_list_pages, the page-list
          // block, a theme with no menu assigned).
          //
          // A curated nav MENU is a separate view over the same content, not this.
          items: posts.map((post) => this.toDocument(post, `/${post.slug}`)),
        };
      }

      case 'vocabulary.get': {
        const params = {
          per_page: String(args.limit ?? 25),
          // WordPress filters terms server-side; pulling 10k back to filter
          // here would make type-ahead unusable.
          ...(args.title ? { search: args.title } : {}),
        };
        const terms = await this.fetchJson(
          `/wp/v2/${encodeURIComponent(args.name)}`,
          { params },
        );
        return {
          items: terms.map((t) => ({ token: t.slug, title: t.name })),
          total: this.lastTotal,
        };
      }

      case 'types.getSchema': {
        // The type endpoint describes the post type, not its fields; the field
        // schema comes from an OPTIONS request on the collection.
        const type = await this.cachedMeta(`type:${args.type}`, () =>
          this.fetchJson(`/wp/v2/types/${args.type}`),
        );
        // Cached like the type itself: the field schema is a property of the
        // SITE. The edit form asks for it on every mount, and this was the one
        // call issued twice in a single picker interaction.
        const described = await this.cachedMeta(
          `schema:${type.rest_base}`,
          async () => {
            const res = await fetch(this.url(`/wp/v2/${type.rest_base}`), {
              method: 'OPTIONS',
              // With an explicit nonce we must NOT also send cookies: a
              // wildcard Access-Control-Allow-Origin makes the browser reject
              // a credentialled cross-origin request outright, surfacing only
              // as "Failed to fetch". Same bug the Plone and Drupal adapters
              // had.
              credentials: this.nonce || this.credentials ? 'omit' : 'include',
              headers: this.authHeaders(),
            });
            return res.json();
          },
        );

        // What the editor can SET, not everything the endpoint returns.
        //
        // schema.properties describes the read shape — 25 fields for a page,
        // 9 of them readonly (guid, link, modified, permalink_template…).
        // Rendering those as form fields put widgets on screen for values
        // nobody can change, and the computed ones fed the number widget
        // values it rejected. WordPress already publishes the writable set as
        // the POST endpoint's args, so use that as the field list and the
        // schema only to describe the fields in it.
        const readShape = described.schema?.properties ?? {};
        const writable =
          described.endpoints?.find((e) => (e.methods ?? []).includes('POST'))
            ?.args ?? {};

        const properties = Object.fromEntries(
          Object.keys(writable).filter(isEditableField).map((name) => [
            name,
            canonicalField(name, { ...readShape[name], ...writable[name] }),
          ]),
        );
        // The blocks fields are part of the schema even though WordPress has
        // no idea they exist: this adapter stores them in post_content (see
        // serializeBlocks) and content.get returns them, so they are as
        // writable as any other field.
        //
        // Declaring them is not cosmetic. The admin decides whether a type can
        // be edited VISUALLY by looking for a property whose name ends in
        // "blocks"; finding none, it drops out of visual mode, unmounts the
        // preview iframe and re-initialises the sidebar as a plain field form.
        // Because the schema arrives after the content it depends on, that
        // happened seconds into the session — tearing down an open object
        // browser mid-navigation, whose listing then arrived to a component
        // that no longer existed.
        const withBlocks = {
          ...properties,
          blocks: { title: 'Blocks', type: 'object' },
          blocks_layout: { title: 'Blocks layout', type: 'object' },
        };
        return {
          properties: withBlocks,
          fieldsets: [
            {
              id: 'default',
              title: 'Default',
              fields: Object.keys(withBlocks),
            },
          ],
          required: Object.entries(writable)
            .filter(([, v]) => v.required === true)
            .map(([k]) => k),
        };
      }

      case 'asset.upload': {
        const binary = Uint8Array.from(atob(args.data), (c) => c.charCodeAt(0));
        const res = await fetch(this.url('/wp/v2/media'), {
          method: 'POST',
          // With an explicit nonce we must NOT also send cookies: a wildcard
      // Access-Control-Allow-Origin makes the browser reject a credentialled
      // cross-origin request outright, surfacing only as "Failed to fetch".
      // Same bug the Plone and Drupal adapters had.
      credentials: this.nonce || this.credentials ? 'omit' : 'include',
          headers: {
            ...this.authHeaders(),
            'Content-Type': args.contentType,
            'Content-Disposition': `attachment; filename="${args.filename}"`,
          },
          body: binary,
        });
        if (!res.ok) {
          // Say what the CMS said. A status on its own is unactionable: this
          // one surfaced as a bare "Upload failed: 500" and cost several runs
          // of guessing, while WordPress had a reason it was willing to give.
          const detail = await res.text().catch(() => '');
          throw new AdapterError(
            `Upload failed: ${res.status}${detail ? ` — ${detail.slice(0, 400)}` : ''}`,
            { code: 'UPLOAD_FAILED', status: res.status, data: detail },
          );
        }
        const media = await res.json();
        return {
          id: String(media.id),
          path: `/${media.slug}`,
          type: media.type,
          title: media.title?.rendered ?? args.filename,
          blocks: {},
          blocksLayout: { items: [] },
          // `url` is what the image widget reads back after an upload (see
          // assetToPlone); source_url is already absolute, which is the
          // requirement — an <img src> cannot resolve a CMS-relative path.
          fields: { link: media.source_url, url: media.source_url, filename: args.filename },
          state: 'published',
          _adapter: { raw: media },
        };
      }

      case 'asset.imageUrl': {
        // Callers address assets by path, like any other document. WordPress
        // media is flat, so the path is just the attachment slug.
        const slug = (args.path ?? '').replace(/^\//, '');
        const matches = await this.fetchJson('/wp/v2/media', {
          params: { slug, context: 'edit' },
        });
        const media = matches?.[0];
        if (!media) {
          throw new AdapterError(`No media at ${args.path}`, {
            code: 'NOT_FOUND',
            status: 404,
          });
        }
        // WordPress only generates a named size when the original is larger
        // than it, so a small image legitimately has none. The original is
        // always a valid rendition, so fall back to it rather than failing a
        // request the CMS can actually satisfy.
        const sizes = media.media_details?.sizes ?? {};
        const size = sizes[args.scale] ?? sizes.full;
        if (size?.source_url) return size.source_url;
        if (media.source_url) return media.source_url;
        throw new AdapterError(
          `Media ${media.id} has no retrievable image URL`,
          { code: 'NOT_FOUND', status: 404 },
        );
      }

      case 'content.move': {
        const fromView = parseViewPath(args.path);
        const toView = parseViewPath(args.targetParentPath);
        if (fromView || toView) {
          return this.movePlacement(fromView, toView, args);
        }

        if (
          args.targetParentPath === args.path ||
          args.targetParentPath.startsWith(`${args.path}/`)
        ) {
          throw new AdapterError('Cannot move a document inside itself', {
            code: 'INVALID_MOVE',
            status: 400,
          });
        }
        const id = await this.resolvePath(args.path);
        const parentId =
          args.targetParentPath === '/'
            ? 0
            : await this.resolvePath(args.targetParentPath);

        // A WordPress page's location IS its parent pointer, so descendants
        // follow for free — their own parent pointers are untouched and the
        // path is derived from the chain. The post id never changes, which is
        // what keeps stored links resolving.
        const moved = await this.fetchJson(`/wp/v2/${this.postType}/${id}`, {
          method: 'POST',
          body: { parent: parentId },
          params: { context: 'edit' },
        });

        // Only the moved subtree is wrong — invalidate exactly that.
        //
        // Clearing both maps wholesale was correct but ruinously broad: every
        // later lookup re-walked the tree at a full request per hop, and with
        // ~1.1s per request under PHP-WASM it put every move test within a few
        // seconds of the 30s limit, so whichever landed worst failed.
        //
        // A move re-parents ONE post. Paths at or under its old location are
        // stale; every other cached path still holds. In the ancestor map,
        // which is id -> {slug, parent}, only the moved post's own entry
        // changes — its descendants still have the same parent, namely it.
        for (const cached of [...this.pathCache.keys()]) {
          if (cached === args.path || cached.startsWith(`${args.path}/`)) {
            this.pathCache.delete(cached);
          }
        }
        this.ancestorCache.delete(id);

        const segments = args.path.split('/').filter(Boolean);
        const slug = segments[segments.length - 1];
        const destPath =
          args.targetParentPath === '/'
            ? `/${slug}`
            : `${args.targetParentPath}/${slug}`;

        // Built from the response we already have, not re-fetched by path.
        // content.get here would resolve destPath a segment at a time, fetch
        // the post again and re-walk its ancestors — around five requests to
        // rediscover what the write just returned. At ~1.1s each that was most
        // of the cost of a move.
        this.pathCache.set(destPath, id);
        return this.toDocument(moved, destPath);
      }

      case 'content.copy': {
        if (
          args.targetParentPath === args.path ||
          args.targetParentPath.startsWith(`${args.path}/`)
        ) {
          throw new AdapterError('Cannot copy a document inside itself', {
            code: 'INVALID_MOVE',
            status: 400,
          });
        }
        // WordPress has no duplicate route in the REST API — the "Duplicate
        // Post" everyone knows is a plugin — so the copy is a create carrying
        // the original's title and body. WordPress assigns the slug and
        // deduplicates it itself (first-post-2), which is why the path comes
        // back from the create rather than being predicted here.
        const source = await this.dispatchOnce('content.get', {
          path: args.path,
        });
        return this.dispatchOnce('content.create', {
          parentPath: args.targetParentPath,
          data: {
            type: source.type,
            title: source.title,
            blocks: source.blocks,
            blocksLayout: source.blocksLayout,
          },
        });
      }

      case 'content.sort': {
        // Persistent: the children are read in the order asked for and their
        // menu_order rewritten, so a later listing with no sort returns them
        // this way. That is what the contents view's sort means — a CMS that
        // only sorted the response would forget it on the next read.
        const children = await this.dispatchOnce('tree.list', {
          parent: args.path,
          sortOn: args.sortOn,
          sortOrder: args.sortOrder,
        });
        for (const [index, child] of children.items.entries()) {
          await this.dispatchOnce('content.order', {
            path: child.path,
            targetIndex: index,
          });
        }
        return null;
      }

      case 'content.order': {
        const id = await this.resolvePath(args.path);

        // resolvePath cached this post's parent on the way past, so the
        // separate fetch it used to do is redundant. The post itself is one of
        // the siblings fetched below.
        //
        // `?? 0` was WRONG here: a cold ancestorCache — which is what resolvePath
        // leaves when it answers from pathCache alone, as it does for any path
        // seen before — made every post look top-level, so the siblings fetched
        // below were the ROOT pages. A nested page was then "Not found among
        // siblings", and one that happened to be among them would have silently
        // reordered the wrong run of pages.
        const cached = this.ancestorCache.get(id);
        const parentId =
          cached?.parent ??
          Number(
            (
              await this.fetchJson(`/wp/v2/${this.postType}/${id}`, {
                params: { context: 'edit' },
              })
            ).parent ?? 0,
          );

        // Renumber ALL the siblings, not just this one.
        //
        // WordPress orders pages by menu_order, and every page starts at 0. So
        // writing menu_order on one post alone leaves it tied with its
        // siblings, WordPress breaks the tie however it likes, and the move
        // silently does nothing — "reorder draft-post to the front" returned
        // first-post still leading. A position is only meaningful relative to
        // the others, so the whole run has to be given distinct, ordered
        // values.
        const siblings = await this.fetchJson(`/wp/v2/${this.postType}`, {
          params: {
            parent: String(parentId),
            per_page: '100',
            orderby: 'menu_order',
            order: 'asc',
            status: 'any',
            context: 'edit',
          },
        });

        const post = (siblings ?? []).find((s) => s.id === id);
        if (!post) {
          throw new AdapterError(`Not found among siblings: ${args.path}`, {
            code: 'NOT_FOUND',
            status: 404,
          });
        }

        const rest = (siblings ?? []).filter((s) => s.id !== id);
        const index = resolveOrderPosition({
          targetIndex: args.targetIndex,
          delta: args.delta,
          from: (siblings ?? []).findIndex((s) => s.id === id),
          count: rest.length,
        });
        const ordered = [...rest.slice(0, index), post, ...rest.slice(index)];

        // ONE request for every renumbering, via WordPress core's batch
        // endpoint (5.6+). The writes are independent — each sets a different
        // post's menu_order — so there is nothing to serialise, and at ~1.1s
        // per round trip issuing them one at a time was most of what a reorder
        // cost. Batch caps at 25 per call, so long sibling runs are chunked.
        const writes = ordered
          .map((sibling, i) => ({ sibling, i }))
          .filter(({ sibling, i }) => sibling.menu_order !== i)
          .map(({ sibling, i }) => ({
            method: 'POST',
            path: `/wp/v2/${this.postType}/${sibling.id}`,
            body: { menu_order: i },
          }));

        for (let start = 0; start < writes.length; start += 25) {
          await this.fetchJson('/batch/v1', {
            method: 'POST',
            body: { requests: writes.slice(start, start + 25) },
          });
        }

        // NOT clearing the path caches. Ordering changes menu_order, which
        // affects neither slugs nor parents, so every cached path is still
        // correct. Clearing them made the following tree.list re-resolve every
        // ancestor at a full request each, which is what pushed this test past
        // the 30s limit — invalidating more than changed is not free when a
        // request costs a second.
        return null;
      }

      // WordPress keeps this in its settings endpoint. `language` is a WP
      // locale ('en_US'), and the admin wants a language tag, so the region is
      // dropped — 'en_US' and 'en_GB' are both English as far as choosing the
      // interface language goes.
      //
      // `multilingual: false` is the honest answer for core WordPress: holding
      // a page in two languages needs a plugin (Polylang, WPML), and until this
      // adapter detects one, offering to create a translation would offer
      // something that cannot exist.
      case 'site.get': {
        const settings = await this.fetchJson('/wp/v2/settings');
        const locale = settings?.language ?? 'en_US';
        let defaultLanguage = locale.split(/[_-]/)[0];
        let languages = [defaultLanguage];

        if (this.multilingual) {
          // DETECTED, not declared. Polylang's own route is the only thing that
          // knows which languages a site has, and `features.multilingual` has
          // to describe this site rather than the plugin: a site with Polylang
          // installed and one language configured still cannot hold a
          // translation, and offering one would waste the editor's work.
          const list = await this.fetchJson('/pll/v1/languages');
          if (!Array.isArray(list) || list.length === 0) {
            throw new AdapterError(
              'wordpress: multilingual was enabled but Polylang reports no ' +
                'languages, so no translation could be created or linked',
              { code: 'NOT_IMPLEMENTED', status: 501 },
            );
          }
          languages = list.map((l) => l.slug);
          defaultLanguage =
            list.find((l) => l.is_default)?.slug ?? languages[0];
        }

        // The views this CMS offers. The admin needs them to put a selector at the
        // root of the breadcrumb; nothing here invents a hierarchy WordPress does
        // not have.
        //
        // `ordered` says WHOSE order it is, which matters because a WordPress menu
        // carries its own positions while Plone's menu view IS the content tree —
        // "move up in the menu" would silently rearrange pages there.
        // `allowsLabels` is what navigation-title should have been: a property of
        // the view, since a menu item carries its own title and a page cannot.
        const menus = await this.fetchJson('/wp/v2/menus', {
          params: { per_page: '100' },
        });

        return {
          defaultLanguage,
          languages,
          ...(settings?.title ? { title: settings.title } : {}),
          views: [
            {
              id: 'content',
              title: 'Pages',
              shape: 'hierarchy',
              main: true,
              prefix: '',
              ordered: 'own',
              holdsContent: true,
              remove: 'delete',
            },
            ...(menus ?? []).map((menu) => ({
              id: `menu:${menu.slug}`,
              title: menu.name,
              shape: 'hierarchy',
              prefix: `${VIEW_PREFIX}/${menu.slug}`,
              ordered: 'own',
              holdsContent: true,
              allowsLinks: true,
              allowsLabels: true,
              // UNLINK: removing a page from a menu must leave the page alone.
              remove: 'unlink',
            })),
          ],
          // The KIND is structural and does not depend on today's
          // configuration; whether this site can actually hold a translation
          // does. Polylang keeps one post per language and relates them, which
          // is the grouped kind.
          features: {
            multilingual: languages.length > 1,
            translations: this.translationsMode,
          },
        };
      }

      case 'querystring.getIndexes': {
        // Discovered from the live site, not a hardcoded list. A WordPress
        // install's queryable fields ARE its registered post types and
        // taxonomies, which differ per site — a shop has product/category, a
        // magazine has article/section. Hardcoding "categories and tags"
        // would offer a query builder that does not describe this site, which
        // is exactly as useless as offering Plone's portal_type here.
        const [types, taxonomies] = await Promise.all([
          this.cachedMeta('types', () => this.fetchJson('/wp/v2/types')),
          this.cachedMeta('taxonomies', () => this.fetchJson('/wp/v2/taxonomies')),
        ]);

        const indexes = {
          title: {
            title: 'Title',
            description: 'Words in the title or body',
            group: 'Metadata',
            enabled: true,
            sortable: true,
            operations: ['string.contains'],
          },
          post_type: {
            title: 'Type',
            description: 'Content type',
            group: 'Metadata',
            enabled: true,
            sortable: false,
            operations: ['selection.any', 'selection.none'],
            values: Object.fromEntries(
              Object.entries(types).map(([id, t]) => [id, { title: t.name }]),
            ),
          },
          parent: {
            title: 'Location',
            description: 'Parent page',
            group: 'Metadata',
            enabled: true,
            sortable: false,
            operations: ['string.absolutePath'],
          },
          status: {
            title: 'State',
            description: 'Publication status',
            group: 'Metadata',
            enabled: true,
            sortable: false,
            operations: ['selection.any'],
            values: {
              publish: { title: 'Published' },
              draft: { title: 'Draft' },
              pending: { title: 'Pending review' },
              private: { title: 'Private' },
            },
          },
          author: {
            title: 'Author',
            group: 'Metadata',
            enabled: true,
            sortable: false,
            operations: ['selection.any'],
          },
          modified: {
            title: 'Last edited',
            description: 'When the content was last changed',
            group: 'Dates',
            enabled: true,
            // WordPress accepts orderby=modified already; it simply was not
            // offered, so the query builder had no way to sort by it.
            sortable: true,
            operations: ['date.lessThan', 'date.largerThan'],
          },
          date: {
            title: 'Date',
            group: 'Dates',
            enabled: true,
            sortable: true,
            operations: ['date.lessThan', 'date.largerThan'],
          },
        };

        // One index per registered taxonomy, with its terms as values, so a
        // custom taxonomy shows up in the query builder without any change
        // here.
        for (const [id, tax] of Object.entries(taxonomies)) {
          if (tax.visibility && tax.visibility.public === false) continue;
          indexes[id] = {
            title: tax.name,
            description: tax.description || undefined,
            group: 'Categorization',
            enabled: true,
            sortable: false,
            operations: ['selection.any', 'selection.none'],
          };
        }

        return { indexes };
      }

      case 'querystringSearch': {
        const params = {
          status: 'any',
          context: 'edit',
          per_page: String(args.limit ?? 25),
        };
        let postType = this.postType;

        for (const criterion of args.query ?? []) {
          const value = Array.isArray(criterion.v) ? criterion.v : [criterion.v];
          switch (criterion.i) {
            case 'post_type':
              postType = await this.restBaseFor(String(value[0]));
              if (postType === null) return { items: [], total: 0 };
              break;
            case 'parent':
              params.parent = String(
                await this.resolvePath(String(value[0])).catch(() => 0),
              );
              break;
            case 'status':
              params.status = value.join(',');
              break;
            case 'author':
              params.author = value.join(',');
              break;
            case 'title':
              // WordPress has no title query param — setting one is silently
              // ignored and the endpoint returns everything, which reads as a
              // filter that works. ?search= is the real one.
              params.search = String(value[0]);
              break;
            default:
              // A taxonomy index: WordPress filters by its rest_base with a
              // comma-separated term list.
              params[criterion.i] = value.join(',');
          }
        }

        if (args.sortOn) params.orderby = sortFieldFor(args.sortOn);
        if (args.sortOrder) {
          // WordPress accepts only asc|desc and 400s on anything else. The
          // canonical value is Plone's long form ("descending"), which passed
          // straight through and made every sorted query fail — as a 400 on
          // /wp/v2/pages, which says nothing about the parameter at fault.
          params.order = String(args.sortOrder).startsWith('desc') ? 'desc' : 'asc';
        }

        const posts = await this.fetchJson(`/wp/v2/${postType}`, { params });
        const total = this.lastTotal;
        const items = [];
        for (const post of posts ?? []) {
          items.push(
            this.toDocument(post, await this.pathOfPost(post)),
          );
        }
        return { items, total };
      }

      case 'reference.resolve': {
        // WordPress has no resolveuid. The post id IS stable across renames
        // and moves, but the permalink is not — so the id is what gets stored
        // and the link is resolved fresh on every render.
        const post = await this.fetchJson(
          `/wp/v2/${this.postType}/${args.id}`,
          { params: { context: 'edit' } },
        );
        const ancestry = await this.ancestryOf(post);
        return {
          id: String(post.id),
          path: this.pathFor(post, ancestry),
          url: post.link,
          title: post.title?.raw ?? post.title?.rendered ?? '',
        };
      }

      /**
       * Where to send the user to authorise this application.
       *
       * WordPress ships this flow in core: the user lands on their OWN login
       * page, approves by name, and WordPress redirects to success_url with a
       * freshly minted application password. The admin never sees a password,
       * and the credential is per-application and revocable from the user's
       * profile.
       *
       * Gated behind HTTPS by core (wp_is_application_passwords_available), so
       * over plain http this page 501s unless a site opts in.
       */
      case 'auth.begin': {
        const url = new URL('/wp-admin/authorize-application.php', this.cmsBaseUrl);
        url.searchParams.set('app_name', args?.appName ?? 'Hydra');
        if (args?.successUrl) url.searchParams.set('success_url', args.successUrl);
        return { url: url.href };
      }

      /**
       * Turn what WordPress handed back into a usable credential.
       *
       * The callback carries user_login and password as query parameters.
       * Parsing them is the ADAPTER's job — the shape is WordPress's, and the
       * admin neither knows nor needs to know it.
       */
      case 'auth.complete': {
        const username = args?.params?.user_login;
        const appPassword = args?.params?.password;
        if (!username || !appPassword) {
          throw new AdapterError('WordPress returned no application password', {
            code: 'AUTH_FAILED',
            status: 400,
          });
        }
        this.credentials = { username, appPassword };
        this.nonce = null; // the credential supersedes any cookie session
        this.invalidateReads();
        // A different user may create different types and see different
        // fields, so the site metadata is no longer known to be right.
        this.metaCache.clear();
        this.restBases = null;
        return this.dispatchOnce('auth.whoami', {});
      }

      case 'types.list': {
        const types = await this.cachedMeta('types', () => this.fetchJson('/wp/v2/types'));
        // Under a parent, only a HIERARCHICAL type can be created: a WordPress
        // post has no parent field, so creating one "inside" a page silently
        // produces a document that is not there.
        const underParent = Boolean(args?.path && args.path !== '/');
        return {
          items: Object.entries(types)
            .filter(([id]) => isContentType(id))
            .map(([id, t]) => ({
              id,
              title: t.name,
              addable: underParent ? Boolean(t.hierarchical) : true,
            })),
        };
      }

      default:
        return super.dispatch(intent, args);
    }
  }
}

export default WordPressAdapter;

/**
 * One WordPress REST field, as the canonical contract describes fields.
 *
 * Passing WordPress's own schema through was a CMS-shaped leak of exactly the
 * kind the contract exists to stop. WordPress describes an editable text field
 * as an OBJECT with `raw` and `rendered` members:
 *
 *   "title": { "type": "object", "properties": { "raw": …, "rendered": … } }
 *
 * The admin has no idea what that is, so it fell back to rendering a FILE
 * input for the title — the add form offered a file picker where the title
 * should be, and the journey could not create a page at all.
 */
function canonicalField(name, field) {
  const base = { title: field.description ? name : name, description: field.description };

  // raw/rendered pairs are text the editor types into.
  if (field.type === 'object' && field.properties?.raw) {
    return { ...base, type: 'string', ...(name === 'content' ? { widget: 'richtext' } : {}) };
  }

  switch (field.type) {
    case 'string':
      return {
        ...base,
        type: 'string',
        ...(field.format === 'date-time' ? { widget: 'datetime' } : {}),
        ...(field.enum ? { choices: field.enum.map((v) => [v, v]) } : {}),
      };
    case 'integer':
    case 'number':
      return { ...base, type: 'number' };
    case 'boolean':
      return { ...base, type: 'boolean' };
    case 'array':
      return { ...base, type: 'array' };
    default:
      // Anything still unrecognised is described as a plain string rather than
      // left as a CMS-specific shape: a wrong-but-typed widget is recoverable,
      // an untyped one silently becomes a file picker.
      return { ...base, type: 'string' };
  }
}

/**
 * Is this post type something an editor authors, or WordPress plumbing?
 *
 * /wp/v2/types lists everything registered with show_in_rest, which includes
 * attachments (handled by asset.upload, not content.create), menu items, and
 * the wp_* types backing the block editor — templates, patterns, navigation,
 * font families. Offering those in the admin's add menu invites creating a
 * document that is not a document.
 */
function isContentType(id) {
  return id !== 'attachment' && id !== 'nav_menu_item' && !id.startsWith('wp_');
}

/**
 * Is this writable arg a field the EDITOR fills in?
 *
 * WordPress's POST args mix content with structure. The contract models the
 * structural parts separately — where a document sits comes from
 * content.create/content.move, its lifecycle from state.get/state.transition —
 * so exposing them again as form fields both duplicates them and contradicts
 * the admin.
 *
 * `parent` is the concrete failure: the admin sends it as a reference object,
 *   "parent": { "@id": "/news" }
 * while WordPress types it as an integer. The form failed its own validation
 * and silently refused to submit — Save did nothing, no request was made, and
 * the journey sat on /add until it timed out.
 */
function isEditableField(name) {
  const STRUCTURAL = new Set([
    'parent', // hierarchy: content.create's parentPath, content.move
    'status', // lifecycle: state.get / state.transition
    'slug', // id derivation is the CMS's business
    'date',
    'date_gmt', // creation timestamps
    'author',
    'featured_media',
    'menu_order',
    'password',
    'template',
    'meta',
    'comment_status',
    'ping_status',
  ]);
  return !STRUCTURAL.has(name);
}

/**
 * A WordPress orderby, from whatever index name the admin sent.
 *
 * INTERIM. Volto's contents view offers sorting from a hard-coded list of
 * PLONE index names — id, sortable_title, EffectiveDate, CreationDate,
 * ModificationDate, portal_type — rather than from querystring.getIndexes,
 * which is what its own query builder uses and what every adapter answers with
 * its real indexes. So a click on "sort by modified" arrives here as
 * `ModificationDate`, which WordPress has never heard of.
 *
 * The proper fix is in the admin: drive that menu from the advertised indexes.
 * Until then this translates the six, so sorting works rather than silently
 * doing nothing.
 *
 * Anything unrecognised is passed through untouched — it is most likely
 * already a native name, from the query builder — and WordPress rejects what
 * it cannot sort by, which is louder than quietly ignoring it.
 */
/**
 * WordPress's own name for an index the admin asks to sort by.
 *
 * `getObjPositionInParent` is the folder's OWN order — the sibling order an
 * editor arranges by hand — which WordPress keeps in menu_order. It is also
 * what the contents view sends when nothing else has been chosen, so leaving
 * it to fall through put a Plone index name into orderby and WordPress
 * answered 400 for every listing.
 */
function sortFieldFor(index) {
  const PLONE_TO_WP = {
    ModificationDate: 'modified',
    CreationDate: 'date',
    EffectiveDate: 'date', // WordPress has no separate effective date
    sortable_title: 'title',
    id: 'id',
    getObjPositionInParent: 'menu_order',
  };
  return PLONE_TO_WP[index] ?? index;
}

/**
 * What WordPress will actually accept in `orderby` for a page collection.
 *
 * An index it does not know is a 400, and a 400 here means no listing at all —
 * so anything unrecognised falls back to the folder's own order rather than
 * taking the whole view down. Sorting by something WordPress cannot sort by is
 * a missing feature; an empty listing is a broken one.
 */
const WP_ORDERBY = new Set([
  'author',
  'date',
  'id',
  'include',
  'modified',
  'parent',
  'relevance',
  'slug',
  'include_slugs',
  'title',
  'menu_order',
]);

function orderByFor(index) {
  const mapped = sortFieldFor(index);
  return WP_ORDERBY.has(mapped) ? mapped : 'menu_order';
}
