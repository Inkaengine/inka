/**
 * Reading Plone as a VISITOR — no adapter, no session.
 *
 * The public site is not rendered through the bridge: a frontend builds or serves
 * it by reading the CMS directly. That read is a different problem from the
 * adapter's, because the adapter holds credentials and a visitor does not, and
 * the two can disagree — an authenticated read can succeed while the public one
 * returns nothing, leaving the editor looking perfect while the published site
 * renders blank.
 *
 * OPTIONAL. Every function here is a thin wrapper over ONE documented request, so
 * a frontend that would rather make the request itself can read this file as the
 * documentation and skip the import. Nothing is hidden behind it.
 *
 * Plone needs the least of the three: its REST API serves a document's blocks and
 * its navigation to an anonymous client with no extra configuration.
 */

/**
 * @param {object} options
 * @param {string} options.cmsBaseUrl
 * @param {typeof globalThis.fetch} [options.fetch] An injectable fetch, for a
 *   caller that has to carry transport state the CMS does not define.
 */
export function createPublicReader({ cmsBaseUrl, fetch: fetchImpl = globalThis.fetch }) {
  const base = cmsBaseUrl.replace(/\/+$/, '');
  const json = (accept = 'application/json') => ({ headers: { Accept: accept } });

  return {
    /**
     * A document's blocks, or null when it is not readable.
     *
     * null means NOT READABLE; {} means readable but carrying no blocks. A caller
     * that collapses the two cannot tell a private page from an empty one.
     */
    async blocks(path) {
      const res = await fetchImpl(`${base}${path}`, json());
      if (!res.ok) return null;
      const body = await res.json();
      return body.blocks ?? {};
    },

    /**
     * Everything a frontend needs to RENDER the page, from one request.
     *
     * `blocks` above answers "is this readable"; this answers "what do I draw".
     * Separate because the contract asks the first question and a frontend asks
     * the second, and a reader that only returned blocks sent the frontend back
     * to the adapter — which is not mounted on an anonymous view at all.
     */
    async document(path) {
      const res = await fetchImpl(`${base}${path}`, json());
      if (!res.ok) return null;
      const body = await res.json();
      return {
        path,
        title: body.title ?? '',
        description: body.description ?? '',
        blocks: body.blocks ?? {},
        blocksLayout: body.blocks_layout ?? { items: [] },
      };
    },

    /**
     * What the SITE is called, and the language it is in.
     *
     * `@site` is public in Plone, and it carries both — which is why the
     * WordPress reader's answer has a null language rather than this shape
     * being invented for it.
     */
    async site() {
      const res = await fetchImpl(`${base}/@site`, json());
      if (!res.ok) return null;
      const body = await res.json();
      return {
        title: body['plone.site_title'] ?? '',
        description: body['plone.site_description'] ?? '',
        language: body['plone.default_language'] ?? null,
      };
    },

    /** The navigation, as paths and titles. */
    async navigation() {
      const res = await fetchImpl(`${base}/@navigation`, json());
      if (!res.ok) return null;
      const body = await res.json();
      return (body.items ?? []).map((item) => ({
        path: new URL(item['@id'], base).pathname.replace(/\/+$/, '') || '/',
        title: item.title,
      }));
    },
  };
}
