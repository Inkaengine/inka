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
export function createPublicReader({ cmsBaseUrl, fetch: fetchImpl = globalThis.fetch }) {
  const base = cmsBaseUrl.replace(/\/+$/, '');
  // `?rest_route=` rather than /wp-json/, so this works on a site without pretty
  // permalinks.
  const rest = (route) => `${base}/?rest_route=${route}`;

  return {
    /**
     * A page's blocks, or null when it is not readable.
     *
     * null means NOT READABLE; {} means readable but carrying no blocks.
     */
    async blocks(path) {
      const slug = path.split('/').filter(Boolean).pop() ?? '';
      const res = await fetchImpl(
        rest(`/wp/v2/pages&slug=${encodeURIComponent(slug)}&status=publish`),
      );
      if (!res.ok) return null;
      const [post] = await res.json();
      if (!post) return null;
      return parseBlocks(post.content?.rendered ?? '').blocks ?? {};
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
      const res = await fetchImpl(
        rest('/wp/v2/pages&parent=0&status=publish&per_page=100'),
      );
      if (!res.ok) return null;
      const posts = await res.json();
      return posts.map((post) => ({
        path: new URL(post.link, base).pathname.replace(/\/+$/, '') || '/',
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
      const where = language ? `(where: { language: ${language} })` : '';
      const res = await fetchImpl(`${base}/index.php?graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{ menuItems${where} { nodes { id label uri parentId } } }`,
        }),
      });
      if (!res.ok) return null;
      const body = await res.json();
      if (body.errors) {
        throw new Error(
          `wordpress: the public menu query failed, which usually means ` +
            `WPGraphQL is not installed: ${JSON.stringify(body.errors)}`,
        );
      }
      const nodes = body.data?.menuItems?.nodes;
      if (!nodes) return null;
      // parentId is an opaque global id, so a parent is named by its label.
      const labelById = new Map(nodes.map((n) => [n.id, n.label]));
      return nodes.map((n) => ({
        label: n.label,
        path: new URL(n.uri, base).pathname.replace(/\/+$/, '') || '/',
        parentLabel: n.parentId ? (labelById.get(n.parentId) ?? null) : null,
      }));
    },
  };
}
