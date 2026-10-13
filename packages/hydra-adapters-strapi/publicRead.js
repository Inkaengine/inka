/**
 * Reading Strapi as a VISITOR — no adapter, no session.
 *
 * The public site is not rendered through the bridge: a frontend reads the CMS
 * directly, and on an anonymous view there is no adapter mounted at all. This
 * file is that read, and it is deliberately thin — one documented request per
 * function, so a frontend that would rather make the request itself can read
 * this instead of importing it.
 *
 * Two things about Strapi a frontend developer has to be told:
 *
 *   - NEVER pass `status=draft`. It is not permission-gated beyond the
 *     collection's find permission, so an anonymous caller that asks for the
 *     draft variant GETS it — measured: title and body of an unpublished
 *     document, while the same request without `status` returns nothing. The
 *     admin's adapter asks for drafts on purpose; a public read must not.
 *   - Strapi stores no path. The slug field and the parent self-relation are a
 *     CONVENTION the adapter is told about (`collection`, `slugField`), so this
 *     reader has to be told the same thing. A deployment that addresses its
 *     content differently reads it differently.
 */

/**
 * @param {object} options
 * @param {string} options.cmsBaseUrl
 * @param {string} [options.collectionPlural] The collection's API route segment.
 * @param {string} [options.slugField] The field holding a path segment.
 * @param {string} [options.blocksField] The JSON field holding the blocks.
 * @param {typeof globalThis.fetch} [options.fetch]
 */
export function createPublicReader({
  cmsBaseUrl,
  collectionPlural = 'pages',
  slugField = 'slug',
  blocksField = 'hydraBlocks',
  fetch: fetchImpl = globalThis.fetch,
}) {
  const base = cmsBaseUrl.replace(/\/+$/, '');
  const api = (params) =>
    `${base}/api/${collectionPlural}?${new URLSearchParams(params)}`;

  /** The published document at a path, by its last segment. */
  const readEntry = async (path) => {
    const slug = path.split('/').filter(Boolean).pop() ?? '';
    // No `status`: the default is the published variant, which is the whole of
    // what a visitor may see.
    const res = await fetchImpl(api({ [`filters[${slugField}][$eq]`]: slug }));
    if (!res.ok) return null;
    return (await res.json())?.data?.[0] ?? null;
  };

  return {
    /**
     * A document's blocks, or null when it is not readable.
     *
     * null means NOT READABLE; {} means readable but carrying no blocks.
     */
    async blocks(path) {
      const entry = await readEntry(path);
      if (!entry) return null;
      return entry[blocksField]?.blocks ?? {};
    },

    /** Everything a frontend needs to RENDER the document, from one request. */
    async document(path) {
      const entry = await readEntry(path);
      if (!entry) return null;
      const stored = entry[blocksField] ?? {};
      return {
        path,
        title: entry.title ?? '',
        blocks: stored.blocks ?? {},
        blocksLayout: stored.blocksLayout ?? { items: [] },
      };
    },

    /**
     * A LISTING, as a visitor: published documents, optionally under a parent
     * and narrowed by text.
     *
     * The SUBSET a public listing needs. No `status`, so the published variant
     * is all this can see — the whole point, since asking for `draft` is not
     * permission-gated.
     *
     * A path scope becomes the parent relation, which is CHILDREN and not the
     * subtree: Strapi stores no path, so a descendant query would mean walking
     * the tree a level at a time. A caller needing more has to say so.
     */
    async listing({ query = [], text, contextPath = '/', sortOn, sortOrder, start = 0, size = 25 } = {}) {
      const params = {
        'pagination[start]': String(start),
        'pagination[limit]': String(size),
      };
      // The criteria arrive in STRAPI's vocabulary — `parent`, `collection`,
      // `title` — because that is what this adapter's getIndexes advertises
      // and what the listing block stored. Translated here, where the names
      // mean something, and nowhere else.
      let scope = null;
      for (const { i, v } of query) {
        const value = Array.isArray(v) ? v[0] : v;
        if (i === 'parent') {
          scope = String(value);
        } else if (i === 'collection') {
          // One request reads one collection, so a type criterion is answered
          // by whether this is the collection asked for.
          const wanted = Array.isArray(v) ? v : [value];
          if (!wanted.includes(collectionPlural) && !wanted.includes('page')) {
            return { items: [], total: 0 };
          }
        } else if (i === 'title') {
          params['filters[title][$containsi]'] = String(value);
        } else {
          throw new Error(
            `strapi public listing: no read for the '${i}' index. It is one ` +
              `this adapter advertises, so add it here rather than dropping ` +
              `it — a listing that ignores a criterion shows the wrong ` +
              `content and looks right.`,
          );
        }
      }
      if (text) {
        params['filters[$or][0][title][$containsi]'] = text;
        params[`filters[$or][1][${blocksField}][$containsi]`] = text;
      }
      if (sortOn) {
        const field = sortOn === 'sortable_title' ? 'title' : sortOn;
        params.sort = `${field}:${String(sortOrder).startsWith('desc') ? 'desc' : 'asc'}`;
      }
      if (scope === null) scope = contextPath;
      if (scope && scope !== '/') {
        const parent = await readEntry(scope);
        if (!parent) return { items: [], total: 0 };
        params['filters[parent][documentId][$eq]'] = parent.documentId;
      }
      const res = await fetchImpl(api(params));
      if (!res.ok) return null;
      const body = await res.json();
      return {
        items: (body?.data ?? []).map((entry) => ({
          // The slug is the last segment; a visitor's listing links to it
          // under whatever prefix the frontend serves. Strapi knows no path,
          // so this is the convention the reader was told about.
          path: `/${entry[slugField]}`,
          title: entry.title ?? '',
        })),
        total: body?.meta?.pagination?.total ?? (body?.data ?? []).length,
      };
    },

    /**
     * The navigation: the top of the one hierarchy.
     *
     * Strapi has no menu feature, so its tree IS its navigation — the Plone
     * shape. `excludeFromNav` is the adapter's convention for membership, and a
     * visitor's menu must honour it; the `$or` is load-bearing, because a row
     * written before that field existed holds NULL and SQL's `NULL != true` is
     * NULL, which would hide every untouched page.
     */
    async navigation() {
      const res = await fetchImpl(
        api({
          'filters[parent][id][$null]': 'true',
          'filters[$or][0][excludeFromNav][$null]': 'true',
          'filters[$or][1][excludeFromNav][$eq]': 'false',
          'pagination[pageSize]': '100',
          sort: 'sortOrder:asc,title:asc',
        }),
      );
      if (!res.ok) return null;
      return ((await res.json())?.data ?? []).map((entry) => ({
        path: `/${entry[slugField]}`,
        title: entry.title,
      }));
    },
  };
}
