/**
 * window.__inkaSite — the site-wide half of what an MCP server drives in a
 * headless admin: finding pages, and moving, renaming and deleting them.
 * Mounted on every admin page (appExtras), so none of it needs an editor
 * open — an open editor locks its page, and a locked page can't be moved or
 * deleted. Every call dispatches the admin's own action, so it goes wherever
 * the admin's CMS connection goes. Page edits are window.__inkaAgent, in the
 * editor (Iframe/agentApi.js).
 */
import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { searchContent } from '@plone/volto/actions/search/search';
import { moveContent } from '@plone/volto/actions/clipboard/clipboard';
import { deleteContent, getContent, updateContent } from '@plone/volto/actions/content/content';
import { flattenToAppURL } from '@plone/volto/helpers/Url/Url';

/** A rejected action's error as an Error naming the call. */
const failure = (what, error) => new Error(
  `${what}: ${error?.response?.body?.message || error?.message || error?.status || 'failed'}`,
);

export function siteApi(dispatch) {
  const run = async (what, action) => {
    try {
      return await dispatch(action);
    } catch (error) {
      throw failure(what, error);
    }
  };
  const summary = (item) => ({
    path: flattenToAppURL(item['@id']),
    title: item.title,
    type: item['@type'],
    description: item.description,
    reviewState: item.review_state,
  });
  return {
    /**
     * Find content through the admin's own @search. `text` searches the full
     * text; `types` narrows by content type; `depth: 1` lists the direct
     * children of `path`, in their order; `blockTypes` finds the pages that
     * use those block types (plone.volto's block_types index). Paths come back
     * site-relative.
     */
    async search({ path = '/', text, types, blockTypes, depth, limit = 25, start = 0 }) {
      const response = await run('search', searchContent(path === '/' ? '' : path, {
        SearchableText: text,
        portal_type: types,
        block_types: blockTypes,
        'path.depth': depth,
        ...(depth === 1 && { sort_on: 'getObjPositionInParent' }),
        b_size: limit,
        b_start: start,
      }, 'inka-agent-search'));
      return { total: response.items_total, items: response.items.map(summary) };
    },

    /** A page as the CMS has it now (stored shape). */
    async get(path) {
      return run(`get ${path}`, getContent(path, null, 'inka-agent-get'));
    },

    /** A page's version (its modification date) as the CMS has it now. */
    async version(path) {
      const content = await run(`version of ${path}`, getContent(path, null, 'inka-agent-version'));
      return content.modified;
    },

    /** Move `path` into the section `target`; resolves to its new path. */
    async move({ path, target }) {
      const results = await run(`move ${path}`, moveContent([path], target === '/' ? '' : target));
      return flattenToAppURL(results[0].target);
    },

    /** Give `path` a new id (its last path segment) and/or title; resolves to its path. */
    async rename({ path, id, title }) {
      await run(`rename ${path}`, updateContent(path, { ...(id && { id }), ...(title && { title }) }));
      return id ? `${path.replace(/\/[^/]+\/?$/, '')}/${id}` : path;
    },

    /** Delete `path`. */
    async remove(path) {
      await run(`delete ${path}`, deleteContent(path));
    },
  };
}

/** Registers window.__inkaSite while the admin is mounted. */
const AgentSite = () => {
  const dispatch = useDispatch();
  useEffect(() => {
    const api = siteApi(dispatch);
    window.__inkaSite = api;
    return () => {
      if (window.__inkaSite === api) delete window.__inkaSite;
    };
  }, [dispatch]);
  return null;
};

export default AgentSite;
