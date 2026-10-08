import { BaseAdapter, AdapterError } from '@volto-hydra/hydra-adapters-core';

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
  } = {}) {
    super({
      name: 'strapi',
      capabilities: [
        // Deliberately minimal. Every other capability is added only once the
        // contract suite proves it against a real Strapi — advertising one the
        // backend cannot honour is the failure mode this suite exists to catch.
        'content',
      ],
    });
    this.cmsBaseUrl = cmsBaseUrl?.replace(/\/+$/, '');
    this.token = token;
    this.collection = collection;
    this.collectionPlural = collectionPlural;
    this.slugField = slugField;
    this.blocksField = blocksField;
  }

  async fetchJson(route, { method = 'GET', body, params } = {}) {
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
      // publishedAt is Strapi's whole workflow: null means draft.
      state: entry.publishedAt ? 'published' : 'private',
      _adapter: { raw: entry },
    };
  }

  async dispatch(intent, args) {
    switch (intent) {
      case 'content.get':
        return this.toDocument(await this.entryForPath(args.path), args.path);

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

      default:
        return super.dispatch(intent, args);
    }
  }
}
