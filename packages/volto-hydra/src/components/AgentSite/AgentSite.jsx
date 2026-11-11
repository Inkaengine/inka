/**
 * window.__inkaSite — the site-wide half of what an MCP server drives in a
 * headless admin: finding pages, moving, copying, ordering, renaming and deleting them, and what
 * state they are in and taking them to another.
 * Mounted on every admin page (appExtras), so none of it needs an editor
 * open — an open editor locks its page, and a locked page can't be moved or
 * deleted. Every call dispatches the admin's own action, so it goes wherever
 * the admin's CMS connection goes. Page edits are window.__inkaAgent, in the
 * editor (Iframe/agentApi.js).
 */
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useHistory } from 'react-router-dom';
import { searchContent } from '@plone/volto/actions/search/search';
import { copyContent, moveContent } from '@plone/volto/actions/clipboard/clipboard';
import { getHistory, revertHistory } from '@plone/volto/actions/history/history';
import {
  deleteContent,
  getContent,
  linkIntegrityCheck,
  orderContent,
  updateContent,
} from '@plone/volto/actions/content/content';
import { flattenToAppURL } from '@plone/volto/helpers/Url/Url';
import { lockedBy } from './lockedBy';
import { contentState } from './contentState';

/** A rejected action's error as an Error naming the call. */
const failure = (what, error) => new Error(
  `${what}: ${error?.response?.body?.error?.message || error?.response?.body?.message || error?.message || error?.status || 'failed'}`,
);

export function siteApi(dispatch, history, token) {
  const run = async (what, action) => {
    try {
      return await dispatch(action);
    } catch (error) {
      throw failure(what, error);
    }
  };
  // No action of the admin's sends all a transition can set (its own workflow
  // action sends only include_children), so a plain request, through the same
  // connection and sign-in.
  const state = contentState({
    fetchJson: (path, { method = 'GET', body } = {}) => run(`${method} ${path}`, {
      type: 'INKA_AGENT_STATE',
      request: { op: method === 'DELETE' ? 'del' : method.toLowerCase(), path, data: body },
    }),
    toPath: flattenToAppURL,
  });
  const summary = (item) => ({
    path: flattenToAppURL(item['@id']),
    title: item.title,
    type: item['@type'],
    description: item.description,
    reviewState: item.review_state,
    ...(item.is_working_copy && { isDraft: true }),
  });
  return {
    /**
     * Find content through the admin's own @search. `text` searches the full
     * text; `types` narrows by content type; `depth: 1` lists the direct
     * children of `path`, in their order; `blockTypes` finds the pages that
     * use those block types (plone.volto's block_types index); `uid` finds the
     * item with that UID; `reviewState` narrows by workflow state. Paths come
     * back site-relative. Which results are drafts is metadata, not an index, so
     * it is shown on a result but can't be searched for.
     */
    async search({ path = '/', text, types, blockTypes, uid, reviewState, depth, limit = 25, start = 0 }) {
      const response = await run('search', searchContent(path === '/' ? '' : path, {
        SearchableText: text,
        UID: uid,
        portal_type: types,
        block_types: blockTypes,
        review_state: reviewState,
        metadata_fields: 'is_working_copy',
        'path.depth': depth,
        ...(depth === 1 && { sort_on: 'getObjPositionInParent' }),
        b_size: limit,
        b_start: start,
      }, 'inka-agent-search'));
      return { total: response.items_total, items: response.items.map(summary) };
    },

    /** Whether there is content at `path`: a 404 is no; any other failure is thrown. */
    async exists(path) {
      try {
        await dispatch(getContent(path, null, 'inka-agent-exists'));
        return true;
      } catch (error) {
        if (error?.status === 404) return false;
        throw failure(`look up ${path}`, error);
      }
    },

    /**
     * The content types this user may add in `path` (Plone's @types there),
     * by id and title. Which types go where is the site's.
     */
    async addableTypes(path) {
      const types = await run(`types allowed in ${path}`, {
        type: 'INKA_AGENT_TYPES',
        request: { op: 'get', path: `${path === '/' ? '' : path}/@types` },
      });
      return types.filter((t) => t.addable).map(({ id, title }) => ({ id, title }));
    },

    /** A page as the CMS has it now (stored shape). */
    async get(path) {
      return run(`get ${path}`, getContent(path, null, 'inka-agent-get'));
    },

    /**
     * A page as the CMS has it now: its version (its modification date), and
     * who is editing it if that is someone else (they hold its lock).
     */
    async status(path) {
      const content = await run(`status of ${path}`, getContent(path, null, 'inka-agent-status'));
      return { version: content.modified, lockedBy: lockedBy(content.lock, token) };
    },

    /** Move `path` into the section `target`; resolves to its new path. */
    async move({ path, target }) {
      const results = await run(`move ${path}`, moveContent([path], target === '/' ? '' : target));
      return flattenToAppURL(results[0].target);
    },

    /** Copy `path`, and what it holds, into the section `target` (copy and paste); resolves to the copy's path. */
    async copy({ path, target }) {
      const results = await run(`copy ${path}`, copyContent([path], target === '/' ? '' : target));
      return flattenToAppURL(results[0].target);
    },

    /**
     * Move the page `id` by `delta` places among the pages of `section` named
     * in `subset` (in their current order), as the contents view reorders.
     */
    async order({ section, id, delta, subset }) {
      await run(`order ${id} in ${section}`, orderContent(section === '/' ? '' : section, id, delta, subset));
    },

    /** Give `path` a new id (its last path segment) and/or title; resolves to its path. */
    async rename({ path, id, title }) {
      await run(`rename ${path}`, updateContent(path, { ...(id && { id }), ...(title && { title }) }));
      return id ? `${path.replace(/\/[^/]+\/?$/, '')}/${id}` : path;
    },

    /**
     * What deleting `path` would break, as the editor's delete dialog asks
     * (@linkintegrity): the pages outside it that link to it or to anything
     * in it, and how many items it holds.
     */
    async linksInto(path) {
      const { UID } = await run(`get ${path}`, getContent(path, null, 'inka-agent-links'));
      const [result] = await run(`links into ${path}`, linkIntegrityCheck([UID]));
      return {
        holds: result?.items_total ?? 0,
        linkedFrom: (result?.breaches ?? []).map((source) => ({
          path: flattenToAppURL(source['@id']),
          title: source.title,
        })),
      };
    },

    /** The page's saves and workflow changes, newest first (@history, as the History view lists them). */
    async history(path) {
      return run(`history of ${path}`, getHistory(path));
    },

    /** What one of `path`'s saved versions held, as stored (@history/<version>, what Compare shows). */
    async historyVersion({ path, version }) {
      return run(`version ${version} of ${path}`, {
        type: 'INKA_AGENT_HISTORY_VERSION',
        request: { op: 'get', path: `${path === '/' ? '' : path}/@history/${version}` },
      });
    },

    /** Put `path` back to one of its saved versions, as the History view's revert does. */
    async revert({ path, version }) {
      await run(`revert ${path} to version ${version}`, revertHistory(path, version));
    },

    /** Delete `path`. */
    async remove(path) {
      await run(`delete ${path}`, deleteContent(path));
    },

    /** Its state, the transitions on offer and what the user may do (contentState). */
    state: (path) => state.get(path),

    /** What each transition on offer can set at the same time (contentState). */
    stateForms: (path) => state.getForms(path),

    /** The path of the page's draft, or null (contentState). */
    draftOf: (path) => state.draftOf(path),

    /** The pages that have a draft, across the site, as search results (contentState). */
    pagesWithDrafts: async () => (await state.pagesWithDrafts()).map(summary),

    /** The address of `path` in this admin, for a person to open. */
    adminUrl: (path) => `${window.location.origin}${path}`,

    /** Take a transition; resolves to null, or { redirect } if the page moved (contentState). */
    transition: (op) => state.transition(op),

    /**
     * Go to `path` in the admin as its own links do: the app stays loaded,
     * so moving between pages costs a page's data, not a fresh admin. What
     * the page left behind goes as when a person leaves it (an editor
     * unlocks its page, its unsaved changes are dropped).
     */
    navigate(path) {
      history.push(path);
    },
  };
}

/** Registers window.__inkaSite while the admin is mounted. */
const AgentSite = () => {
  const dispatch = useDispatch();
  const history = useHistory();
  const token = useSelector((state) => state.userSession.token);
  useEffect(() => {
    const api = siteApi(dispatch, history, token);
    window.__inkaSite = api;
    return () => {
      if (window.__inkaSite === api) delete window.__inkaSite;
    };
  }, [dispatch, history, token]);
  return null;
};

export default AgentSite;
