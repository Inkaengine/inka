/**
 * window.__inkaAgent — what an MCP server drives inside a headless admin.
 *
 * Every operation goes through the editor's OWN handlers, the ones its buttons
 * and drag-and-drop call, so an agent's edit gets exactly what a person's does:
 * defaults, template membership, container seeding, conversion checks, the
 * structure tidy-up. Nothing about blocks is reimplemented here.
 *
 * Each call resolves once the editor's state has taken the change, so calls can
 * be chained. Saving checks the page's version first: if anyone saved since the
 * agent read it, the save is refused, never merged.
 *
 * `live.current` is refreshed by the editor on every render with its current
 * state and handlers: { properties, blockPathMap, insertAndSelectBlock,
 * onDeleteBlock, moveBlocks, onChangeFormData }.
 */
import { getBlockById, updateBlockById } from '../../utils/blockPath';

const STATE_LIMIT_MS = 10000;
const SAVE_LIMIT_MS = 15000;

/** Resolve once `done()` is true; reject after `limitMs`, naming `what`. */
function until(done, limitMs, what) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const tick = () => {
      if (done()) return resolve();
      if (performance.now() - t0 > limitMs) {
        return reject(new Error(`${what}: did not happen within ${limitMs / 1000}s`));
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function authHeaders() {
  const m = document.cookie.match(/(?:^|; )auth_token=([^;]+)/);
  return m ? { Authorization: `Bearer ${decodeURIComponent(m[1])}` } : {};
}

/** The page's version as the CMS has it now (Plone's `modified`). */
async function readVersion(contentPath) {
  const res = await fetch(`/++api++${contentPath}`, {
    headers: { Accept: 'application/json', ...authHeaders() },
  });
  if (!res.ok) {
    throw new Error(`reading ${contentPath} for its version answered ${res.status}`);
  }
  const { modified } = await res.json();
  if (!modified) throw new Error(`${contentPath} has no version (modified)`);
  return modified;
}

export function registerAgentApi(live) {
  const properties = () => live.current.properties;
  const contentPath = () => window.location.pathname.replace(/\/edit\/?$/, '');
  /** Run `act`, then wait for the editor's state to take the change. */
  const commit = async (what, act) => {
    const before = properties();
    const result = act();
    await until(() => properties() !== before, STATE_LIMIT_MS, `${what}: the editor's state did not change`);
    return result;
  };
  const requireBlock = (what, id) => {
    if (!live.current.blockPathMap?.[id]) throw new Error(`${what}: no block "${id}" on this page`);
  };

  const api = {
    /** The page as the editor holds it, and the version a save is checked against. */
    getPage() {
      const { properties: formData, blockPathMap } = live.current;
      return { path: contentPath(), version: formData.modified, formData, blockPathMap };
    },

    /**
     * Add a block as a person does: a block of its type through the editor's
     * add (defaults, membership, seeding), then its fields. `action` is
     * 'after' | 'before' a block, or 'inside' a container's `field`.
     * Resolves to the new block's uid.
     */
    async insert({ refId, action = 'after', field = null, block }) {
      if (!block?.['@type']) throw new Error('insert: the block needs an "@type"');
      requireBlock('insert', refId);
      const id = await commit('insert', () => live.current.insertAndSelectBlock(
        refId, block['@type'], action, field, {},
      ));
      if (!id) throw new Error(`insert: the editor could not add a ${block['@type']} ${action} ${refId}`);
      const { '@type': _type, ...fields } = block;
      if (Object.keys(fields).length) await api.update({ id, fields });
      return id;
    },

    /** Change some of a block's fields, as the sidebar does. */
    async update({ id, fields }) {
      requireBlock('update', id);
      await commit('update', () => {
        const { properties: formData, blockPathMap, onChangeFormData } = live.current;
        const current = getBlockById(formData, blockPathMap, id);
        onChangeFormData(updateBlockById(formData, blockPathMap, id, { ...current, ...fields }));
      });
    },

    /** Delete a block, as the editor's delete does. */
    async remove(id) {
      requireBlock('remove', id);
      await commit('remove', () => live.current.onDeleteBlock(id, true));
    },

    /** Move a block before or after another, as drag-and-drop does. */
    async move({ id, targetId, insertAfter = true }) {
      requireBlock('move', id);
      requireBlock('move', targetId);
      const before = properties();
      const outcome = live.current.moveBlocks({
        blockIds: [id],
        targetBlockId: targetId,
        insertAfter,
        targetParentId: live.current.blockPathMap[targetId].parentId ?? null,
      });
      // 'rejected' | 'needs-choice' | 'needs-confirm' | 'failed': the editor
      // didn't move it, and says why.
      if (outcome !== 'moved') throw new Error(`move: ${outcome}`);
      await until(() => properties() !== before, STATE_LIMIT_MS, "move: the editor's state did not change");
    },

    /**
     * Save, if the page is still at `expectedVersion`; otherwise refuse — the
     * agent reads it again and reapplies. Resolves to the new version.
     */
    async save({ expectedVersion }) {
      if (!expectedVersion) throw new Error('save: expectedVersion is required');
      const path = contentPath();
      const now = await readVersion(path);
      if (now !== expectedVersion) {
        throw new Error(
          `save: the page has changed since it was read (read at ${expectedVersion}, now ${now}). Read it again and reapply.`,
        );
      }
      // The editor's own save, as SAVE_REQUEST triggers it.
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 's', ctrlKey: true, bubbles: true, cancelable: true,
      }));
      await until(() => !/\/edit\/?$/.test(window.location.pathname), SAVE_LIMIT_MS, 'save: the editor did not save');
      return { version: await readVersion(path) };
    },
  };

  window.__inkaAgent = api;
  return () => {
    if (window.__inkaAgent === api) delete window.__inkaAgent;
  };
}
