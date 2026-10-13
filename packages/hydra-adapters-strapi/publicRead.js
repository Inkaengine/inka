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
