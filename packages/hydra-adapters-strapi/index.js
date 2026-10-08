import {
  BaseAdapter,
  AdapterError,
  resolveOrderPosition,
  VIEW_PREFIX,
  EXCLUDED_NODE,
  parseViewPath,
} from '@volto-hydra/hydra-adapters-core';

/**
 * Strapi 5, over its REST API.
 *
 * Strapi is the first backend here with NO addressing of its own. Plone has a
 * content tree, WordPress has a page tree, Drupal at least has path aliases and
 * menu links — Strapi has none: "no URL concept in the data layer at all",
 * because a Strapi frontend decides its own URLs from whatever fields it likes.
 *
 * So the path↔document mapping is a CONVENTION this adapter is told about
 * (`collection` + `slugField`) rather than one it infers, the same way the
 * WordPress adapter is told its `postType`. An adapter that guessed would be
 * inventing a rule the CMS does not have.
 *
 * Blocks live in a JSON field, NOT in a dynamic zone, and that is deliberate.
 *
 * A dynamic zone looks like the natural home — an ordered array where each entry
 * carries its own `__component` type, which is structurally blocks + blocksLayout.
 * It is not, because Hydra's block model is RECURSIVE and OPEN: a columnsBlock
 * holds columns which hold slates, any type nesting any other, each level with its
 * own blocks_layout. A dynamic zone's component list is closed and flat — a real
 * create came back
 *
 *   __component must be one of the following values: blocks.slate, blocks.image
 *
 * and even a declared component has nowhere to put `data.blocks.c1.blocks.t1`.
 *
 * So Strapi stores what Drupal stores in a string_long field and WordPress in a
 * data-hydra-blocks element. The other adapters are not settling for opaque JSON;
 * it is the only representation that round-trips, and the contract is explicit
 * that the storage is adapter business as long as "what goes in comes back out".
 *
 * The cost is that the blocks are not editable in Strapi's own admin UI. A
 * dynamic zone would be, at the price of a block model Hydra cannot express.
 */
/**
 * Strapi's field types, as the admin's schema describes them.
 *
 * Exhaustive by intent: an unmapped type throws rather than being passed
 * through, because the admin renders an unrecognised description as a file
 * input — the WordPress raw/rendered bug, which served a file picker where the
 * title belonged.
 */
const STRAPI_FIELD_TYPES = {
  string: { type: 'string' },
  uid: { type: 'string' },
  email: { type: 'string' },
  password: { type: 'string', widget: 'password' },
  text: { type: 'string', widget: 'textarea' },
  richtext: { type: 'string', widget: 'richtext' },
  blocks: { type: 'string', widget: 'richtext' },
  enumeration: { type: 'string' },
  integer: { type: 'integer' },
  biginteger: { type: 'integer' },
  float: { type: 'number' },
  decimal: { type: 'number' },
  boolean: { type: 'boolean' },
  date: { type: 'string', widget: 'date' },
  time: { type: 'string', widget: 'time' },
  datetime: { type: 'string', widget: 'datetime' },
  timestamp: { type: 'string', widget: 'datetime' },
  json: { type: 'object' },
  media: { type: 'object', widget: 'file' },
  relation: { type: 'string', widget: 'reference' },
  component: { type: 'object' },
  dynamiczone: { type: 'array' },
};

export class StrapiAdapter extends BaseAdapter {
  constructor({
    cmsBaseUrl,
    token,
    // Which collection type holds documents, and which field carries the path
    // segment. Strapi supplies neither by convention, so they are configuration.
    collection = 'page',
    collectionPlural = 'pages',
    slugField = 'slug',
    // The JSON field holding { blocks, blocksLayout }.
    blocksField = 'hydraBlocks',
    // Where a manual position lives. Strapi has no implicit ordering.
    orderField = 'sortOrder',
    // Which field keeps a page out of the navigation.
    //
    // This is Strapi's equivalent of Plone's exclude_from_nav, and it is a
    // CONVENTION this adapter is told about, like slug, parent, blocks and
    // order above — Strapi has no navigation concept of its own, so there is
    // nothing to discover and nothing native to bypass. That is what makes it
    // a different decision from the WordPress case, where inventing post meta
    // would have gone around nav_menu_item, a real feature of that CMS.
    navExcludeField = 'excludeFromNav',
    // Where this deployment's frontend serves the content, for the absolute
    // URLs reference.resolve has to hand back. Strapi itself serves no pages,
    // so there is nothing to discover: a deployment that has a frontend says
    // where, and one that has not gets Strapi's own origin, which at least
    // resolves.
    siteBaseUrl,
  } = {}) {
    super({
      name: 'strapi',
      capabilities: [
        // Each one is here because the contract suite proves it against a real
        // Strapi — advertising a capability the backend cannot honour is the
        // failure mode this suite exists to catch, and capabilities.spec
        // checks the converse too: an UNadvertised capability must answer
        // NOT_IMPLEMENTED rather than half work.
        'content',
        'search-filter',
        'schema',
        'asset',
        'reference',
        'vocabulary',
      ],
    });
    this.cmsBaseUrl = cmsBaseUrl?.replace(/\/+$/, '');
    this.token = token;
    this.collection = collection;
    this.collectionPlural = collectionPlural;
    this.slugField = slugField;
    this.blocksField = blocksField;
    this.orderField = orderField;
    this.navExcludeField = navExcludeField;
    this.siteBaseUrl = (siteBaseUrl ?? this.cmsBaseUrl)?.replace(/\/+$/, '');
  }

  /**
   * The ONE place an HTTP request happens.
   *
   * Named requestJson because the contract's caching tests stub it to count real
   * round trips below the cache — `adapter.requestJson.bind(adapter)`. A cache
   * that bypassed this seam would be untestable.
   */
  async requestJson(route, { method = 'GET', body, params } = {}) {
    const url = new URL(`${this.cmsBaseUrl}${route}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, String(value));
    }
    const res = await fetch(url, {
      method,
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 404) {
      throw new AdapterError(`Not found: ${route}`, {
        code: 'NOT_FOUND',
        status: 404,
      });
    }
    if (res.status === 401 || res.status === 403) {
      throw new AdapterError(`Strapi refused ${route}`, {
        code: 'UNAUTHORIZED',
        status: res.status,
      });
    }
    if (!res.ok) {
      throw new AdapterError(
        `Strapi returned ${res.status} for ${route}: ${(await res.text()).slice(0, 300)}`,
        { code: 'ADAPTER_ERROR', status: res.status },
      );
    }
    if (res.status === 204) return null;
    return res.json();
  }

  /**
   * A read through the session cache; a write invalidates it.
   *
   * Same split every adapter here uses: GETs are retained until something writes,
   * because the admin re-reads the same document repeatedly while editing it.
   */
  async fetchJson(route, options = {}) {
    const method = options.method ?? 'GET';
    if (method !== 'GET') {
      this.invalidateReads();
      return this.requestJson(route, options);
    }
    return this.cachedRead(`GET ${this.scopeKey(route, options.params)}`, () =>
      this.requestJson(route, options),
    );
  }

  /**
   * Walk a path down the parent relation, a query per segment.
   *
   * Strapi ships no hierarchy and "no URL concept in the data layer at all", so a
   * tree is a modelling choice: a `parent` self-relation, declared in the content
   * type. Drupal does the equivalent by borrowing its tree from menu links.
   *
   * One request per segment rather than a deep `populate` chain: Strapi's populate
   * nests explicitly (`populate[parent][populate][parent]…`), so an arbitrary-depth
   * path cannot be expressed as a single populate and a fixed depth would silently
   * truncate.
   */
  async entryForPath(path) {
    const segments = String(path ?? '').split('/').filter(Boolean);
    if (segments.length === 0) {
      throw new AdapterError('strapi: there is no root document', {
        code: 'NOT_FOUND',
        status: 404,
      });
    }

    let parent = null;
    let entry = null;
    for (const segment of segments) {
      const params = {
        [`filters[${this.slugField}][$eq]`]: segment,
        'pagination[pageSize]': '1',
        // The DRAFT version, which every document has — a published one simply
        // has a published version too. Without this the adapter reads only
        // published documents and a draft is a 404 to the editor, which is the
        // opposite of what an editing client needs.
        status: 'draft',
      };
      if (parent) {
        params['filters[parent][documentId][$eq]'] = parent;
      } else {
        // Root level: no parent. Without this a child slug would match at the
        // top and the path would resolve to the wrong document.
        params['filters[parent][id][$null]'] = 'true';
      }
      const payload = await this.fetchJson(`/api/${this.collectionPlural}`, {
        params,
      });
      entry = payload?.data?.[0];
      if (!entry) {
        throw new AdapterError(`Not found: ${path}`, {
          code: 'NOT_FOUND',
          status: 404,
        });
      }
      parent = entry.documentId;
    }
    return entry;
  }

  /**
   * Every document's path, computed once.
   *
   * Strapi stores no path — the class comment says why — so there is no index
   * to delegate a path query to, and no result can be addressed without
   * knowing its ancestors. Both needs are the same read: fetch the whole
   * collection's (documentId, slug, parent) and compute paths in memory.
   *
   * Only the three addressing fields, so this stays cheap relative to the real
   * query that follows it; and it goes through fetchJson, so a listing that
   * runs several queries in one request pays for it once.
   */
  async addressingMap() {
    const entries = new Map();
    for (let page = 1; ; page += 1) {
      const payload = await this.fetchJson(`/api/${this.collectionPlural}`, {
        params: {
          // `draft` means "every document, as the editor sees it" — a listing
          // in the admin must show unpublished pages, and a path lookup that
          // skipped them would make a draft unaddressable.
          status: 'draft',
          'fields[0]': this.slugField,
          'populate[parent][fields][0]': 'documentId',
          'pagination[page]': String(page),
          'pagination[pageSize]': '100',
        },
      });
      for (const entry of payload?.data ?? []) {
        entries.set(entry.documentId, {
          slug: entry[this.slugField],
          parent: entry.parent?.documentId ?? null,
        });
      }
      const pagination = payload?.meta?.pagination;
      if (!pagination || page >= pagination.pageCount) break;
    }

    const paths = new Map();
    const pathOf = (documentId, seen) => {
      if (paths.has(documentId)) return paths.get(documentId);
      const entry = entries.get(documentId);
      // A parent outside the fetched set, or a cycle: either means the stored
      // tree is not a tree, and guessing a path for it would put a document at
      // an address nothing else agrees on.
      if (!entry) return null;
      if (seen.has(documentId)) {
        throw new AdapterError(
          `Strapi parent chain cycles at ${documentId}`,
          { code: 'ADAPTER_ERROR', status: 500 },
        );
      }
      seen.add(documentId);
      const parentPath = entry.parent ? pathOf(entry.parent, seen) : '';
      if (parentPath === null) return null;
      const path = `${parentPath}/${entry.slug}`;
      paths.set(documentId, path);
      return path;
    };
    for (const documentId of entries.keys()) pathOf(documentId, new Set());
    return paths;
  }

  /**
   * The native field an index name refers to.
   *
   * The admin's sort menu is still hardcoded to Plone's index names — see the
   * WordPress adapter's note on the same translation — so `ModificationDate`
   * arrives for what Strapi calls `updatedAt`. Anything else is passed
   * through: it is most likely already native, having come from the query
   * builder, and Strapi rejects a field it cannot sort by, which is louder
   * than quietly returning an unsorted list.
   */
  sortField(sortOn) {
    const plone = {
      ModificationDate: 'updatedAt',
      modified: 'updatedAt',
      created: 'createdAt',
      EffectiveDate: 'publishedAt',
      sortable_title: 'title',
      getObjPositionInParent: this.orderField,
    };
    return plone[sortOn] ?? sortOn;
  }

  /**
   * Fill in whether each document is published.
   *
   * Strapi 5 keeps a draft and a published VARIANT of every document, and the
   * draft's own publishedAt is always null — a document that is published
   * still reads as null in the draft it is edited through. So `publishedAt`
   * off a draft read says nothing about the workflow state, and the only
   * honest answer comes from asking whether a published variant exists.
   *
   * One query for the whole set, not one per document: the admin lists before
   * it reads, and a per-row request would make a contents view of fifty pages
   * fifty round trips.
   */
  async withPublishedState(entries) {
    const ids = entries.map((entry) => entry.documentId).filter(Boolean);
    if (!ids.length) return entries;
    const params = {
      status: 'published',
      'fields[0]': 'publishedAt',
      'pagination[pageSize]': String(ids.length),
    };
    ids.forEach((id, n) => {
      params[`filters[documentId][$in][${n}]`] = id;
    });
    const payload = await this.fetchJson(`/api/${this.collectionPlural}`, {
      params,
    });
    const published = new Map(
      (payload?.data ?? []).map((entry) => [entry.documentId, entry.publishedAt]),
    );
    return entries.map((entry) => ({
      ...entry,
      publishedAt: published.get(entry.documentId) ?? null,
    }));
  }

  /** Prefix a provider-relative media URL with the CMS origin. */
  absoluteUrl(url) {
    // Strapi's LOCAL upload provider returns site-relative URLs; a remote one
    // (S3, Cloudinary) returns absolute ones. The admin puts this straight in
    // an <img src> and cannot resolve a CMS-relative path against its own
    // origin, so the relative case has to be completed here.
    return /^https?:\/\//.test(url) ? url : `${this.cmsBaseUrl}${url}`;
  }

  /**
   * A media-library file as a canonical Document.
   *
   * The file's own URL is its path. Media has no place in the content tree, so
   * there is no tree path to give it, and the URL is the one address Strapi
   * guarantees is unique and resolvable — which is what fileForPath reads back.
   */
  assetToDocument(file) {
    const url = this.absoluteUrl(file.url);
    return {
      id: String(file.id),
      path: file.url,
      type: 'file',
      title: file.name,
      blocks: {},
      blocksLayout: { items: [] },
      // `url` is what the image widget reads back after an upload; `link` is
      // its equivalent in the other adapters. Both absolute.
      fields: { link: url, url, filename: file.name },
      state: 'published',
      _adapter: { raw: file },
    };
  }

  /** The media-library file addressed by a path from assetToDocument. */
  async fileForPath(path) {
    const files = await this.fetchJson('/api/upload/files', {
      params: { 'filters[url][$eq]': path },
    });
    // /api/upload/files is a plugin route and answers with a bare array, not
    // the { data, meta } envelope the content API uses.
    const file = files?.[0];
    if (!file) {
      throw new AdapterError(`No file at ${path}`, {
        code: 'NOT_FOUND',
        status: 404,
      });
    }
    return file;
  }

  /**
   * Is this page in the navigation?
   *
   * As a filter rather than a post-filter, because the public frontend reads
   * the menu with the same query and an admin that filtered in memory would
   * show a menu no visitor sees.
   *
   * `$ne true` would not do: a row created before this field existed holds
   * NULL, and SQL's `NULL != true` is NULL, so every such page would vanish
   * from the navigation. Unset means "not excluded", which is what this says.
   */
  navFilter(params = {}) {
    return {
      ...params,
      [`filters[$or][0][${this.navExcludeField}][$null]`]: 'true',
      [`filters[$or][1][${this.navExcludeField}][$eq]`]: 'false',
    };
  }

  /**
   * A node in a menu view, which in Strapi IS the document.
   *
   * One hierarchy, as in Plone: the placement and the content are the same
   * object, so a node always carries a reference and it is itself. The node's
   * own path is synthetic and must never be mistaken for the content's —
   * `content.get` refuses one.
   */
  toPlacement(menu, contentPath, title, excluded) {
    const base = excluded
      ? `/${VIEW_PREFIX}/${menu}/${EXCLUDED_NODE}`
      : `/${VIEW_PREFIX}/${menu}`;
    return {
      id: contentPath,
      path: `${base}${contentPath}`,
      type: 'placement',
      title,
      blocks: {},
      blocksLayout: { items: [] },
      fields: { reference: contentPath, url: null },
      state: 'published',
      _adapter: { raw: null },
    };
  }

  /**
   * A menu view's nodes.
   *
   * Both halves come from ONE query over the same container, differing only in
   * the exclusion filter — so what the editor is shown and what a visitor is
   * served cannot drift apart, which two sources would allow.
   */
  async listPlacements({ menu, excluded, rest }) {
    const parentPath = rest ? `/${rest}` : '/';
    const parent =
      parentPath === '/'
        ? null
        : (await this.entryForPath(parentPath)).documentId;
    const params = {
      status: 'draft',
      'pagination[pageSize]': '100',
      sort: `${this.orderField}:asc,title:asc`,
    };
    if (parent) {
      params['filters[parent][documentId][$eq]'] = parent;
    } else {
      params['filters[parent][id][$null]'] = 'true';
    }
    const payload = await this.fetchJson(`/api/${this.collectionPlural}`, {
      params: excluded
        ? {
            ...params,
            [`filters[${this.navExcludeField}][$eq]`]: 'true',
          }
        : this.navFilter(params),
    });
    const base = parentPath === '/' ? '' : parentPath;
    const nodes = (payload?.data ?? []).map((entry) =>
      this.toPlacement(
        menu,
        `${base}/${entry[this.slugField]}`,
        entry.title,
        excluded,
      ),
    );

    if (!excluded && !rest) {
      // Offered at the view's ROOT, so what was taken out of the menu is
      // discoverable in the menu rather than only through the picker. Not
      // selectable: it is a bucket, not content.
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
   * Move a document into or out of the menu view's Excluded node.
   *
   * The document itself never moves: it keeps its place in the one hierarchy
   * and stays readable by anyone holding its address, which is what makes this
   * a different claim from unpublishing it.
   */
  async movePlacement(fromView, toView, args) {
    if (!fromView || !fromView.rest) {
      throw new AdapterError(
        `strapi: ${args.path} is not something in a menu view`,
        { code: 'INVALID_MOVE', status: 400 },
      );
    }
    if (!toView || toView.menu !== fromView.menu) {
      throw new AdapterError(
        'strapi: a document can only move within its own menu view; its place ' +
          "in the one hierarchy is the main view's business",
        { code: 'INVALID_MOVE', status: 400 },
      );
    }
    const entry = await this.entryForPath(`/${fromView.rest}`);
    await this.fetchJson(
      `/api/${this.collectionPlural}/${entry.documentId}`,
      {
        method: 'PUT',
        body: { data: { [this.navExcludeField]: Boolean(toView.excluded) } },
      },
    );
    const base = toView.excluded
      ? `/${VIEW_PREFIX}/${toView.menu}/${EXCLUDED_NODE}`
      : `/${VIEW_PREFIX}/${toView.menu}`;
    return { path: `${base}/${fromView.rest}` };
  }

  /** The children of a container, in their stored order. */
  async siblingsOf(parentPath) {
    const parent =
      parentPath && parentPath !== '/'
        ? (await this.entryForPath(parentPath)).documentId
        : null;
    const params = {
      'pagination[pageSize]': '100',
      status: 'draft',
      sort: `${this.orderField}:asc,title:asc`,
      ...(parent
        ? { 'filters[parent][documentId][$eq]': parent }
        : { 'filters[parent][id][$null]': 'true' }),
    };
    const payload = await this.fetchJson(`/api/${this.collectionPlural}`, {
      params,
    });
    return payload?.data ?? [];
  }

  /** Give a run of documents distinct, ascending positions. */
  async renumber(entries) {
    for (const [index, entry] of entries.entries()) {
      await this.fetchJson(
        `/api/${this.collectionPlural}/${entry.documentId}`,
        { method: 'PUT', body: { data: { [this.orderField]: index + 1 } } },
      );
    }
  }

  /**
   * The stored { blocks, blocksLayout } for an entry.
   *
   * Strapi returns a json field already parsed, and the uids are dict keys, so
   * they are whatever the admin minted — the adapter neither mints nor rewrites
   * them. That is the whole point: the admin owns block identity.
   */
  decodeBlocks(entry) {
    const stored = entry?.[this.blocksField];
    if (!stored || typeof stored !== 'object') {
      return { blocks: {}, blocksLayout: { items: [] } };
    }
    return {
      blocks: stored.blocks ?? {},
      blocksLayout: stored.blocksLayout ?? { items: [] },
    };
  }

  /** Stored verbatim. Nesting and uids survive because nothing reshapes them. */
  encodeBlocks(blocks = {}, blocksLayout = { items: [] }) {
    return { blocks, blocksLayout };
  }

  toDocument(entry, path) {
    const { blocks, blocksLayout } = this.decodeBlocks(entry);
    return {
      // documentId, not the numeric id: Strapi 5 addresses documents by it and it
      // is stable across the draft and published variants of one document.
      id: entry.documentId,
      path,
      type: this.collection,
      title: entry.title,
      blocks,
      blocksLayout,
      fields: { slug: entry[this.slugField] },
      // publishedAt is Strapi's whole workflow, and withPublishedState is what
      // makes it mean anything: null means this document has no published
      // variant. 'draft' rather than Plone's 'private' because that is what
      // the state IS here — Strapi has no permission-bearing states, just the
      // two variants.
      state: entry.publishedAt ? 'published' : 'draft',
      _adapter: { raw: entry },
    };
  }

  /**
   * The same identity the intent reports.
   *
   * The base returns null, and the admin reads this method rather than the
   * intent in some places — two answers to one question is how a toolbar comes
   * to show nobody signed in while every read succeeds.
   */
  async whoami() {
    return this.dispatchOnce('auth.whoami', {});
  }

  /**
   * Invalidation and auth-retry come from the base class, as in every other
   * adapter: the switch itself must not know about either.
   */
  async dispatch(intent, args) {
    return this.dispatchWithInvalidation(intent, args, () =>
      this.withAuthRetry(() => this.dispatchOnce(intent, args)),
    );
  }

  async dispatchOnce(intent, args) {
    switch (intent) {
      case 'content.get': {
        // A view path is NOT content, and must not resolve to something
        // plausible: a synthetic path that escaped into stored data would
        // otherwise reach the published site looking like a real reference.
        if (parseViewPath(args.path)) {
          throw new AdapterError(
            `strapi: ${args.path} is a node in a view, not content — read it ` +
              `by its reference`,
            { code: 'BAD_REQUEST', status: 400 },
          );
        }
        const [entry] = await this.withPublishedState([
          await this.entryForPath(args.path),
        ]);
        return this.withContext(
          this.toDocument(entry, args.path),
          args.path,
          args.expand,
        );
      }

      case 'content.create': {
        const parent =
          args.parentPath && args.parentPath !== '/'
            ? (await this.entryForPath(args.parentPath)).documentId
            : null;
        const slug = args.data?.slug ?? args.data?.id ?? args.data?.title;
        const payload = await this.fetchJson(`/api/${this.collectionPlural}`, {
          method: 'POST',
          body: {
            data: {
              title: args.data?.title,
              [this.slugField]: slug,
              ...(parent ? { parent } : {}),
              [this.blocksField]: this.encodeBlocks(
                args.data?.blocks,
                args.data?.blocksLayout,
              ),
            },
          },
        });
        const base = args.parentPath === '/' ? '' : (args.parentPath ?? '');
        return this.toDocument(payload.data, `${base}/${slug}`);
      }

      case 'content.update': {
        const entry = await this.entryForPath(args.path);
        const data = {};
        if (args.data?.title !== undefined) data.title = args.data.title;
        if (args.data?.blocks !== undefined) {
          data[this.blocksField] = this.encodeBlocks(
            args.data.blocks,
            args.data.blocksLayout,
          );
        }
        const payload = await this.fetchJson(
          `/api/${this.collectionPlural}/${entry.documentId}`,
          { method: 'PUT', body: { data } },
        );
        return this.toDocument(payload.data, args.path);
      }

      case 'content.delete': {
        const entry = await this.entryForPath(args.path);
        await this.fetchJson(
          `/api/${this.collectionPlural}/${entry.documentId}`,
          { method: 'DELETE' },
        );
        return null;
      }

      case 'site.get': {
        // Strapi has no site object. What it does have is a locale list from the
        // i18n plugin when that is installed; without it there is exactly one.
        return {
          defaultLanguage: 'en',
          languages: ['en'],
          features: { multilingual: false, translations: 'grouped' },
          // Two views over ONE hierarchy, which is the Plone shape rather than
          // the WordPress one: Strapi has a single tree, and that tree IS the
          // navigation — `navigation.get` is built from it and a visitor reads
          // it directly.
          //
          // So `ordered: 'main'` on the menu, as in Plone: reordering within
          // the menu reorders the content, because there is only one order to
          // change. A WordPress or Drupal menu carries its own positions and
          // says 'own'.
          //
          // `allowsLinks: false` because the fixture's collection has no url
          // field — an external link in a Strapi menu is a content-model
          // decision for the deployment, not something the adapter can assume.
          views: [
            {
              id: 'content',
              title: 'Content',
              shape: 'hierarchy',
              main: true,
              prefix: '',
              ordered: 'own',
              holdsContent: true,
              remove: 'delete',
            },
            {
              id: 'menu:navigation',
              title: 'Navigation',
              shape: 'hierarchy',
              prefix: `${VIEW_PREFIX}/navigation`,
              ordered: 'main',
              holdsContent: true,
              allowsLinks: false,
              allowsLabels: false,
              remove: 'unlink',
            },
          ],
        };
      }

      case 'types.list':
        // One collection type, named by configuration. Strapi's real type list
        // lives behind /api/content-type-builder, which needs an admin role — so
        // discovering it is a deployment question, not something to assume here.
        return {
          items: [{ id: this.collection, title: this.collection, addable: true }],
        };

      case 'tree.list': {
        const view = parseViewPath(args.parent);
        if (view) return this.listPlacements(view);

        const parent =
          args.parent && args.parent !== '/'
            ? (await this.entryForPath(args.parent)).documentId
            : null;
        const params = {
          'pagination[pageSize]': '100',
          status: 'draft',
          sort: `${this.orderField}:asc,title:asc`,
        };
        if (parent) {
          params['filters[parent][documentId][$eq]'] = parent;
        } else {
          params['filters[parent][id][$null]'] = 'true';
        }
        const payload = await this.fetchJson(`/api/${this.collectionPlural}`, {
          params,
        });
        const base = args.parent && args.parent !== '/' ? args.parent : '';
        const entries = await this.withPublishedState(payload?.data ?? []);
        return {
          items: entries.map((entry) =>
            this.toDocument(entry, `${base}/${entry[this.slugField]}`),
          ),
        };
      }

      case 'navigation.get': {
        // The top of the one hierarchy, minus what has been taken out of the
        // menu. Built with the SAME filter a visitor's read uses, so the admin
        // cannot show a menu the public site does not have.
        const payload = await this.fetchJson(`/api/${this.collectionPlural}`, {
          params: this.navFilter({
            status: 'draft',
            'pagination[pageSize]': '100',
            'filters[parent][id][$null]': 'true',
            sort: `${this.orderField}:asc,title:asc`,
          }),
        });
        const entries = await this.withPublishedState(payload?.data ?? []);
        return {
          items: entries.map((entry) =>
            this.toDocument(entry, `/${entry[this.slugField]}`),
          ),
        };
      }

      case 'breadcrumbs.get': {
        // Built from the path rather than by walking parents upward: the walk
        // already resolved every ancestor on the way down, and Strapi cannot
        // populate an arbitrary-depth parent chain in one request anyway.
        const segments = String(args.path ?? '').split('/').filter(Boolean);
        const items = [];
        for (let depth = 1; depth <= segments.length; depth += 1) {
          const path = `/${segments.slice(0, depth).join('/')}`;
          const entry = await this.entryForPath(path);
          items.push({ path, title: entry.title });
        }
        return { items };
      }

      case 'content.move': {
        const fromView = parseViewPath(args.path);
        const toView = parseViewPath(args.targetParentPath);
        if (fromView || toView) {
          return this.movePlacement(fromView, toView, args);
        }

        const entry = await this.entryForPath(args.path);
        const target =
          args.targetParentPath && args.targetParentPath !== '/'
            ? (await this.entryForPath(args.targetParentPath)).documentId
            : null;
        if (target === entry.documentId) {
          throw new AdapterError('Cannot move a document inside itself', {
            code: 'INVALID_MOVE',
            status: 400,
          });
        }
        const payload = await this.fetchJson(
          `/api/${this.collectionPlural}/${entry.documentId}`,
          { method: 'PUT', body: { data: { parent: target } } },
        );
        const base =
          args.targetParentPath === '/' ? '' : (args.targetParentPath ?? '');
        return this.toDocument(
          payload.data,
          `${base}/${entry[this.slugField]}`,
        );
      }

      case 'content.copy': {
        // Same containment check as content.move. A copy into its own subtree
        // would recurse while it copied — the children it is about to read
        // include the copy it just made.
        if (
          args.targetParentPath === args.path ||
          String(args.targetParentPath ?? '').startsWith(`${args.path}/`)
        ) {
          throw new AdapterError('Cannot copy a document inside itself', {
            code: 'INVALID_MOVE',
            status: 400,
          });
        }

        const entry = await this.entryForPath(args.path);
        const target =
          args.targetParentPath && args.targetParentPath !== '/'
            ? (await this.entryForPath(args.targetParentPath)).documentId
            : null;
        // Strapi has no copy action, so this is a read plus a create. The slug is
        // reused where it can be — a copy into a different parent keeps its name,
        // and only a copy alongside the original needs a new one.
        const siblings = await this.fetchJson(`/api/${this.collectionPlural}`, {
          params: {
            [`filters[${this.slugField}][$eq]`]: entry[this.slugField],
            ...(target
              ? { 'filters[parent][documentId][$eq]': target }
              : { 'filters[parent][id][$null]': 'true' }),
            status: 'draft',
          },
        });
        const taken = (siblings?.data ?? []).length > 0;
        const slug = taken
          ? `copy_of_${entry[this.slugField]}`
          : entry[this.slugField];
        const payload = await this.fetchJson(`/api/${this.collectionPlural}`, {
          method: 'POST',
          body: {
            data: {
              title: entry.title,
              [this.slugField]: slug,
              ...(target ? { parent: target } : {}),
              [this.blocksField]: entry[this.blocksField] ?? {
                blocks: {},
                blocksLayout: { items: [] },
              },
            },
          },
        });
        const base =
          args.targetParentPath === '/' ? '' : (args.targetParentPath ?? '');
        return this.toDocument(payload.data, `${base}/${slug}`);
      }

      case 'content.order': {
        const entry = await this.entryForPath(args.path);
        const parentPath = args.path.split('/').slice(0, -1).join('/') || '/';
        const siblings = await this.siblingsOf(parentPath);

        const mine = siblings.findIndex((s) => s.documentId === entry.documentId);
        if (mine < 0) {
          throw new AdapterError(`Not found among siblings: ${args.path}`, {
            code: 'NOT_FOUND',
            status: 404,
          });
        }
        const rest = siblings.filter((s) => s.documentId !== entry.documentId);
        const index = resolveOrderPosition({
          targetIndex: args.targetIndex,
          delta: args.delta,
          from: mine,
          // The run WITHOUT the moved document, which is the list the position
          // indexes into. Passing the full length puts 'to the bottom' one past
          // the end.
          count: rest.length,
        });
        rest.splice(index, 0, entry);

        // Renumber the WHOLE run, not just the moved document. Every page starts
        // at sortOrder 0, so writing one position alone leaves it tied and the
        // move silently does nothing.
        await this.renumber(rest);
        return null;
      }

      case 'content.sort': {
        const children = await this.siblingsOf(args.parent ?? args.path ?? '/');
        const field = args.sortOn === 'title' ? 'title' : args.sortOn;
        const sorted = [...children].sort((a, b) => {
          const left = String(a[field] ?? '');
          const right = String(b[field] ?? '');
          return left.localeCompare(right);
        });
        if (String(args.sortOrder ?? '').startsWith('desc')) sorted.reverse();
        // PERSISTED, not just a sorted answer: the contract requires a later
        // tree.list with no sort to come back in the order that was written.
        await this.renumber(sorted);
        return null;
      }

      case 'querystring.getIndexes':
        // The fields THIS collection can be queried on, named as Strapi names
        // them. Four are Strapi's own and present on every collection; the
        // fifth is the configured slug field, which is addressing, not content.
        return {
          indexes: {
            collection: {
              title: 'Type',
              description: 'Content type',
              group: 'Metadata',
              enabled: true,
              // Strapi has no cross-collection query: one request reads one
              // collection, so there is nothing to order BY type.
              sortable: false,
              operations: ['selection.any', 'selection.none'],
              values: { [this.collection]: { title: this.collection } },
            },
            title: {
              title: 'Title',
              description: 'Words in the title',
              group: 'Metadata',
              enabled: true,
              sortable: true,
              operations: ['string.contains', 'string.is'],
            },
            parent: {
              title: 'Location',
              description: 'Somewhere under this page',
              group: 'Metadata',
              enabled: true,
              sortable: false,
              operations: ['string.absolutePath'],
            },
            publishedAt: {
              title: 'Published',
              description: 'Whether the document is published',
              group: 'Metadata',
              enabled: true,
              sortable: true,
              operations: ['selection.any'],
            },
            updatedAt: {
              title: 'Last edited',
              description: 'When the document was last saved',
              group: 'Dates',
              enabled: true,
              sortable: true,
              operations: ['date.afterRelativeDate', 'date.beforeRelativeDate'],
            },
          },
        };

      case 'querystringSearch': {
        // Paths come from the addressing map whatever the query, because a
        // result with no path is not addressable; so a path filter costs
        // nothing extra and is applied here rather than delegated.
        const paths = await this.addressingMap();
        const params = {
          status: 'draft',
          'pagination[page]': '1',
          'pagination[pageSize]': String(args.limit ?? 100),
        };
        let candidates = null;

        for (const criterion of args.query ?? []) {
          const { i: index, o: operation, v: value } = criterion;
          const values = Array.isArray(value) ? value : [value];
          if (index === 'collection') {
            if (operation !== 'selection.any' && operation !== 'selection.none') {
              throw new AdapterError(
                `Strapi cannot apply '${operation}' to the type index`,
                { code: 'BAD_REQUEST', status: 400 },
              );
            }
            const wanted = values.includes(this.collection);
            // One request reads one collection, so a type query is answered
            // by whether THIS collection is in the set — not by a filter.
            if (operation === 'selection.any' ? !wanted : wanted) {
              return { items: [], total: 0 };
            }
          } else if (index === 'parent') {
            if (operation !== 'string.absolutePath') {
              throw new AdapterError(
                `Strapi cannot apply '${operation}' to the location index`,
                { code: 'BAD_REQUEST', status: 400 },
              );
            }
            const root = String(values[0] ?? '').replace(/\/$/, '');
            const under = [...paths.entries()]
              .filter(([, path]) => path === root || path.startsWith(`${root}/`))
              .map(([documentId]) => documentId);
            candidates = candidates
              ? candidates.filter((id) => under.includes(id))
              : under;
          } else if (index === 'title') {
            if (operation === 'string.contains') {
              params['filters[title][$containsi]'] = String(values[0] ?? '');
            } else if (operation === 'string.is') {
              params['filters[title][$eq]'] = String(values[0] ?? '');
            } else {
              throw new AdapterError(
                `Strapi cannot apply '${operation}' to the title index`,
                { code: 'BAD_REQUEST', status: 400 },
              );
            }
          } else if (index === 'publishedAt') {
            // Strapi's whole workflow is one nullable timestamp.
            params['filters[publishedAt][$null]'] = values.includes('published')
              ? 'false'
              : 'true';
          } else {
            // Not a field this collection has. Answering with the unfiltered
            // collection would make a query builder look like it worked.
            throw new AdapterError(`Strapi has no '${index}' index`, {
              code: 'BAD_REQUEST',
              status: 400,
            });
          }
        }

        if (candidates) {
          if (!candidates.length) return { items: [], total: 0 };
          candidates.forEach((id, n) => {
            params[`filters[documentId][$in][${n}]`] = id;
          });
        }
        if (args.sortOn) {
          params.sort = `${this.sortField(args.sortOn)}:${
            args.sortOrder === 'descending' ? 'desc' : 'asc'
          }`;
        }

        const payload = await this.fetchJson(`/api/${this.collectionPlural}`, {
          params,
        });
        const found = await this.withPublishedState(payload?.data ?? []);
        return {
          items: found.map((entry) =>
            this.toDocument(entry, paths.get(entry.documentId)),
          ),
          // The whole matching set, not the page: a listing block renders
          // "showing N of TOTAL", and reporting the page size there makes
          // every truncated listing claim it is complete.
          total: payload?.meta?.pagination?.total ?? 0,
        };
      }

      case 'types.getSchema': {
        const payload = await this.fetchJson(`/api/hydra/schema/${args.type}`);
        const attributes = payload?.attributes ?? {};
        const properties = {};
        const required = [];
        for (const [name, attribute] of Object.entries(attributes)) {
          // Strapi's own bookkeeping, not fields an editor fills in.
          if (name === 'createdBy' || name === 'updatedBy') continue;
          const canonical = STRAPI_FIELD_TYPES[attribute.type];
          if (!canonical) {
            // Loudly, because the alternative is an add form with a widget
            // that cannot store what it collects. A new field type is a
            // mapping to decide, not a shape to guess.
            throw new AdapterError(
              `Strapi field '${name}' has type '${attribute.type}', which this adapter has no canonical mapping for`,
              { code: 'ADAPTER_ERROR', status: 500 },
            );
          }
          properties[name] = {
            title: name === 'title' ? 'Title' : name,
            ...canonical,
          };
          if (attribute.required) required.push(name);
        }
        return {
          title: payload?.info?.displayName ?? args.type,
          // One fieldset: Strapi has no field grouping of its own, and
          // inventing groups would put a layout decision in the adapter.
          fieldsets: [
            {
              id: 'default',
              title: 'Default',
              fields: Object.keys(properties),
            },
          ],
          properties,
          required,
        };
      }

      case 'vocabulary.get': {
        // A Strapi "vocabulary" is just another collection — a flat one you
        // point a relation at — so the name IS its API route segment, the same
        // convention as `collectionPlural` for content. An unknown name is a
        // route Strapi does not serve, which requestJson turns into NOT_FOUND.
        const params = {
          'fields[0]': 'title',
          'pagination[page]': '1',
          'pagination[pageSize]': String(args.limit ?? 25),
          sort: 'title:asc',
        };
        // Server-side, which is the whole property under test: ten thousand
        // terms filtered in the admin's memory is a type-ahead that stops
        // working long before anyone notices why.
        if (args.title) params['filters[title][$containsi]'] = args.title;
        if (args.token) params['filters[documentId][$eq]'] = args.token;
        const payload = await this.fetchJson(`/api/${args.name}`, { params });
        return {
          items: (payload?.data ?? []).map((term) => ({
            token: term.documentId,
            title: term.title,
          })),
          total: payload?.meta?.pagination?.total ?? 0,
        };
      }

      case 'reference.resolve': {
        // A documentId survives a rename, which is the whole point of storing
        // one: Strapi's documentId is stable for the life of the document
        // while slug, title and therefore path are not.
        const payload = await this.fetchJson(
          `/api/${this.collectionPlural}/${args.id}`,
          { params: { status: 'draft' } },
        );
        const entry = payload?.data;
        if (!entry) {
          throw new AdapterError(`No document ${args.id}`, {
            code: 'NOT_FOUND',
            status: 404,
          });
        }
        const path = (await this.addressingMap()).get(entry.documentId);
        if (!path) {
          throw new AdapterError(
            `Document ${args.id} has no resolvable path`,
            { code: 'NOT_FOUND', status: 404 },
          );
        }
        return {
          id: entry.documentId,
          path,
          title: entry.title,
          // Strapi serves no pages, so it has no public URL for a document to
          // offer — the class comment says why. siteBaseUrl is where this
          // deployment's frontend answers; without one configured the only
          // origin the adapter knows of is Strapi's own.
          url: `${this.siteBaseUrl}${path}`,
        };
      }

      case 'asset.upload': {
        // Strapi's media library is a plugin with its own flat store, not part
        // of the content collection — so an upload has no parent, exactly as in
        // WordPress. parentPath is accepted and ignored, which is what the
        // contract's comment says it expects of such a CMS.
        const binary = Uint8Array.from(atob(args.data), (c) => c.charCodeAt(0));
        const form = new FormData();
        form.append(
          'files',
          new Blob([binary], { type: args.contentType }),
          args.filename,
        );
        // Not through requestJson: that one is JSON in and JSON out, and
        // setting Content-Type by hand on a multipart body loses the boundary
        // that undici generates. Uploads are outside the read cache anyway.
        const res = await fetch(`${this.cmsBaseUrl}/api/upload`, {
          method: 'POST',
          headers: {
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          },
          body: form,
        });
        if (!res.ok) {
          // Say what Strapi said: its upload errors name the reason (size
          // limit, refused mime type, provider misconfiguration) and a bare
          // status is unactionable.
          const detail = await res.text().catch(() => '');
          throw new AdapterError(
            `Upload failed: ${res.status}${detail ? ` \u2014 ${detail.slice(0, 400)}` : ''}`,
            { code: 'UPLOAD_FAILED', status: res.status, data: detail },
          );
        }
        // One file per `files` part, but the endpoint always answers with an
        // array. Reading [0] of an empty one would hand back `undefined` as a
        // document, so check.
        const uploaded = (await res.json())?.[0];
        if (!uploaded) {
          throw new AdapterError('Strapi accepted the upload but returned no file', {
            code: 'UPLOAD_FAILED',
            status: 502,
          });
        }
        this.invalidateReads();
        return this.assetToDocument(uploaded);
      }

      case 'asset.imageUrl': {
        const file = await this.fileForPath(args.path);
        // Strapi generates a responsive format only when the original is
        // larger than that breakpoint, so a small image legitimately has none.
        // The original is always a valid rendition of itself, so serve it
        // rather than failing a request the CMS can satisfy.
        const format = file.formats?.[args.scale];
        const url = format?.url ?? file.url;
        if (!url) {
          throw new AdapterError(`File ${file.id} has no retrievable URL`, {
            code: 'NOT_FOUND',
            status: 404,
          });
        }
        return this.absoluteUrl(url);
      }

      case 'auth.whoami': {
        // An API token is not a user. Strapi's /api/users/me belongs to the
        // users-permissions plugin and answers for a JWT session, so a token-based
        // client has no identity to report beyond the token itself — which is the
        // honest answer, and it still lets the admin show WHO is editing.
        // The probe has to be a request only a CREDENTIAL can make. The
        // collection itself is not one: this fixture grants the public role
        // find/findOne so the public-read tests can be answered honestly, so
        // reading it proves nothing about the token. The companion schema
        // route is behind Strapi's default auth, which is exactly the
        // question being asked.
        const res = await fetch(
          `${this.cmsBaseUrl}/api/hydra/schema/${this.collection}`,
          {
            headers: this.token
              ? { Authorization: `Bearer ${this.token}` }
              : {},
            method: 'HEAD',
          },
        );
        if (res.status === 401 || res.status === 403) {
          throw new AdapterError('strapi: the API token was rejected', {
            code: 'UNAUTHORIZED',
            status: res.status,
          });
        }
        return { id: 'api-token', username: 'api-token', roles: ['full-access'] };
      }

      case 'auth.logout':
        // There is no session to end server-side — an API token is revoked in
        // Strapi's own admin, not over the content API — so the credential is
        // dropped HERE, which is the part that matters: what makes a logout a
        // logout is that this client can no longer read as that user. Leaving
        // the token in place would leave a working credential behind a UI that
        // says it signed out.
        this.token = null;
        this.invalidateReads();
        return null;

      default:
        return super.dispatch(intent, args);
    }
  }
}
