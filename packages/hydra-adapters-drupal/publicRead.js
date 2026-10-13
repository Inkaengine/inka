/**
 * Reading Drupal as a VISITOR — no adapter, no session.
 *
 * See the note in the Plone reader for why a public read is its own problem.
 *
 * OPTIONAL: each function is a thin wrapper over ONE documented JSON:API request.
 */

/**
 * @param {object} options
 * @param {string} options.cmsBaseUrl
 * @param {typeof globalThis.fetch} [options.fetch]
 */
export function createPublicReader({ cmsBaseUrl, fetch: fetchImpl = globalThis.fetch }) {
  const base = cmsBaseUrl.replace(/\/+$/, '');
  const jsonApi = { headers: { Accept: 'application/vnd.api+json' } };

  return {
    /** A node's blocks, or null when it is not readable. */
    async blocks(path) {
      const res = await fetchImpl(
        `${base}/jsonapi/node/page?filter[path.alias]=${encodeURIComponent(path)}`,
        jsonApi,
      );
      if (!res.ok) return null;
      const body = await res.json();
      const node = body?.data?.[0];
      if (!node) return null;
      const raw = node.attributes?.field_hydra_blocks;
      if (!raw) return {};
      try {
        return JSON.parse(raw).blocks ?? {};
      } catch {
        return {};
      }
    },

    /**
     * Everything a frontend needs to RENDER the node, from one request.
     *
     * The same JSON:API read as `blocks`, keeping the title: a frontend draws
     * both, and an anonymous view has no adapter to ask for the rest.
     */
    async document(path) {
      const res = await fetchImpl(
        `${base}/jsonapi/node/page?filter[path.alias]=${encodeURIComponent(path)}`,
        jsonApi,
      );
      if (!res.ok) return null;
      const node = (await res.json())?.data?.[0];
      if (!node) return null;
      let stored = { blocks: {}, blocks_layout: { items: [] } };
      try {
        stored = JSON.parse(node.attributes?.field_hydra_blocks ?? '{}');
      } catch {
        // Unparseable stored blocks are an empty page, not a failed read: the
        // node IS readable, which is what a visitor's frontend has to act on.
      }
      return {
        path,
        title: node.attributes?.title ?? '',
        blocks: stored.blocks ?? {},
        blocksLayout: stored.blocks_layout ?? stored.blocksLayout ?? { items: [] },
      };
    },

    /**
     * The menu, which in Drupal is the hierarchy — its nodes are flat, so
     * menu_link_content is where the tree lives.
     *
     * A stock Drupal 11 serves menu_link_content to anonymous callers. MEASURED:
     * an earlier mock wrongly forbade it, and a module was invented to work
     * around a restriction that was not there.
     */
    async navigation() {
      const res = await fetchImpl(
        // `include=node` resolves every link's target in ONE request — JSON:API's
        // answer to N+1. Without it this fetched each referenced node separately.
        `${base}/jsonapi/menu_link_content/menu_link_content?include=node`,
        jsonApi,
      );
      if (!res.ok) return null;
      const body = await res.json();
      const aliasByUuid = new Map(
        (body.included ?? []).map((n) => [n.id, n.attributes?.path?.alias ?? '']),
      );
      return (body.data ?? [])
        .filter(
          (link) =>
            !link.relationships?.parent?.data &&
            link.attributes?.enabled !== false,
        )
        .map((link) => ({
          path: aliasByUuid.get(link.relationships?.node?.data?.id) ?? '',
          title: link.attributes?.title ?? '',
        }));
    },
  };
}
