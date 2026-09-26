import { BaseAdapter, AdapterError } from '@volto-hydra/hydra-adapters-core';

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

export function serializeBlocks(blocks, blocksLayout) {
  const payload = JSON.stringify({ v: 1, blocks, blocksLayout });
  return `<!-- ${BLOCK_MARKER} ${payload} /-->`;
}

/**
 * Pull the blocks payload back out of post_content.
 *
 * Anything else in post_content is legacy content authored elsewhere; it is
 * preserved verbatim on write so Hydra never destroys work done in Gutenberg.
 */
export function parseBlocks(content) {
  const start = content.indexOf(`<!-- ${BLOCK_MARKER} `);
  if (start === -1) {
    return { blocks: {}, blocksLayout: { items: [] }, legacy: content };
  }
  const end = content.indexOf('/-->', start);
  if (end === -1) {
    throw new AdapterError('Unterminated hydra-blocks comment in post_content', {
      code: 'MALFORMED_CONTENT',
    });
  }
  const json = content.slice(start + `<!-- ${BLOCK_MARKER} `.length, end).trim();
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
  constructor({ cmsBaseUrl, nonce, credentials, postType = 'pages' } = {}) {
    super({
      name: 'wordpress',
      capabilities: [
        'content',
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
    // { username, appPassword } from WordPress's application-password flow.
    // Sent as Basic auth, which is how WordPress accepts a credential from a
    // client acting on behalf of a user — and unlike a cookie it works
    // cross-origin, which a proxy on another origin needs.
    this.credentials = credentials ?? null;
    this.nonce = nonce ?? null;
    this.postType = postType;
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
      fields: { legacyContent: legacy, slug: post.slug, link: post.link },
      state: STATE_MAP[post.status] ?? post.status,
      _adapter: { raw: post },
    };
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
        const parentId =
          args.parentPath === '/' ? 0 : await this.resolvePath(args.parentPath);
        const post = await this.fetchJson(`/wp/v2/${this.postType}`, {
          method: 'POST',
          body: {
            title: args.data.title,
            // Explicit: a draft would otherwise have no slug at all, and the
            // document would not be addressable by path until published.
            slug: args.data.slug ?? slugify(args.data.title),
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
        this.assertDeclared(args.data, forms[args.id]?.schema, args.id);
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

      case 'navigation.get': {
        const posts = await this.fetchJson(`/wp/v2/${this.postType}`, {
          params: { parent: '0', status: 'any', context: 'edit', per_page: '100' },
        });
        return {
          items: posts.map((p) => this.toDocument(p, `/${p.slug}`)),
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

      case 'content.order': {
        const id = await this.resolvePath(args.path);

        // resolvePath cached this post's parent on the way past, so the
        // separate fetch it used to do is redundant. The post itself is one of
        // the siblings fetched below.
        const parentId = this.ancestorCache.get(id)?.parent ?? 0;

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
        const index = Math.max(0, Math.min(args.targetIndex ?? 0, rest.length));
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
        const defaultLanguage = locale.split(/[_-]/)[0];
        return {
          defaultLanguage,
          languages: [defaultLanguage],
          ...(settings?.title ? { title: settings.title } : {}),
          features: { multilingual: false },
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
