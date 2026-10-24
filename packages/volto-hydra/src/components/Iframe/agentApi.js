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
 * onDeleteBlock, moveBlocks, onChangeFormData, blocksConfig, intl, dispatch }.
 */
import { PAGE_BLOCK_UID } from '@volto-hydra/hydra-js';
import {
  getBlockById,
  updateBlockById,
  getBlockTypeSchema,
  getAllContainerFields,
  getContainerRegionDescriptors,
  resolveRegionConstraints,
  resolveObjectListConstraints,
  stripEmptyBlocks,
} from '../../utils/blockPath';
import { stripFixedInsideSlots } from '@volto-hydra/helpers';
import { searchContent } from '@plone/volto/actions/search/search';
import { flattenToAppURL } from '@plone/volto/helpers/Url/Url';
import { getDefaultBlockType } from '../../utils/injectedVoltoConfig';
import { getPageAllowedBlocksFromRestricted } from '../../../../hydra-js/buildBlockPathMap.js';

// The schema facts an agent needs, as plain data (see plain()).
const FIELD_FACTS = ['title', 'description', 'widget', 'type', 'choices', 'default', 'maxLength', 'allowedBlocks'];

function schemaFacts(schema) {
  return {
    required: schema?.required ?? [],
    properties: Object.fromEntries(
      Object.entries(schema?.properties ?? {}).map(([field, def]) => [field, fieldFacts(def)]),
    ),
  };
}

/**
 * `v` as plain data, or undefined: schema values can be React elements (a
 * description written as JSX, holding the live component tree) or functions,
 * which mean nothing to an agent and can't leave the page.
 */
function plain(v) {
  if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) return v;
  if (Array.isArray(v)) {
    const items = v.map(plain);
    return items.includes(undefined) ? undefined : items;
  }
  if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype && !v.$$typeof) {
    const entries = Object.entries(v).map(([k, x]) => [k, plain(x)]);
    return entries.some(([, x]) => x === undefined) ? undefined : Object.fromEntries(entries);
  }
  return undefined;
}

function fieldFacts(def) {
  const out = {};
  for (const key of FIELD_FACTS) {
    const value = plain(def?.[key]);
    if (value !== undefined) out[key] = value;
  }
  if (def?.schema?.properties) out.schema = schemaFacts(def.schema);
  return out;
}

/** The field definition of `region`, under the object fields of `regionPath`. */
function fieldAt(schema, regionPath, region) {
  let properties = schema.properties;
  for (const key of regionPath) properties = properties[key].schema.properties;
  const def = properties[region];
  if (!def) throw new Error(`getBlockSchemas: no field "${region}" at ${regionPath.join('/') || 'the block root'}`);
  return def;
}

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
     * Find content through the admin's own @search (so it goes wherever the
     * admin's CMS connection goes). `text` searches the full text; `types`
     * narrows by content type; `depth: 1` lists the direct children of `path`,
     * in their order. Paths come back site-relative.
     */
    async search({ path = '/', text, types, depth, limit = 25, start = 0 }) {
      const options = {
        SearchableText: text,
        portal_type: types,
        'path.depth': depth,
        ...(depth === 1 && { sort_on: 'getObjPositionInParent' }),
        b_size: limit,
        b_start: start,
      };
      const response = await live.current.dispatch(
        searchContent(path === '/' ? '' : path, options, 'inka-agent-search'),
      );
      return {
        total: response.items_total,
        items: response.items.map((item) => ({
          path: flattenToAppURL(item['@id']),
          title: item.title,
          type: item['@type'],
          description: item.description,
          reviewState: item.review_state,
        })),
      };
    },

    /**
     * The page as a save would persist it: without the empty slot blocks the
     * editor keeps for its canvas, and with fixed flags scrubbed inside slots —
     * the same two steps the Form's save takes. What a preview renders.
     */
    getDraft() {
      const { properties, blocksConfig, intl } = live.current;
      return stripFixedInsideSlots(stripEmptyBlocks(properties, blocksConfig, intl));
    },

    /**
     * What blocks this page can hold, from the block config the frontends
     * registered, resolved by the editor's own rules (field → block → page):
     *   page:  { regions: [{ region, regionPath?, allowedBlocks, defaultBlockType, maxLength }] }
     *   types: { type: { title, blockSchema: { required, properties }, regions: [...] } }
     * A region that restricts nothing lists what the page allows. Items of a
     * list without types of their own are the `<type>:<field>` types the admin
     * registers for them. Plain data — properties keep only the facts an agent
     * needs (title, widget, choices, …), with nested `schema` for objects.
     */
    getBlockSchemas() {
      const { blocksConfig, intl, properties, blockPathMap } = live.current;
      const pageDefaults = {
        allowedBlocks: getPageAllowedBlocksFromRestricted(blocksConfig, { properties }),
        defaultBlockType: getDefaultBlockType(),
      };
      const regionFacts = (r) => ({
        region: r.region,
        ...(r.regionPath && { regionPath: r.regionPath }),
        isObjectList: !!r.isObjectList,
        allowedBlocks: r.allowedBlocks,
        defaultBlockType: r.defaultBlockType,
        maxLength: r.maxLength,
      });
      const page = {
        regions: getAllContainerFields(PAGE_BLOCK_UID, blockPathMap, properties, blocksConfig, intl)
          .map(regionFacts),
      };
      const types = {};
      for (const type of Object.keys(blocksConfig)) {
        const schema = getBlockTypeSchema(type, intl, blocksConfig);
        types[type] = {
          title: blocksConfig[type].title,
          blockSchema: schemaFacts(schema),
          regions: getContainerRegionDescriptors(type, blocksConfig, intl).map((d) => {
            const fieldDef = fieldAt(schema, d.regionPath ?? [], d.region);
            const rc = d.isObjectList
              ? resolveObjectListConstraints(fieldDef, type, d.region)
              : resolveRegionConstraints(fieldDef, blocksConfig[type], pageDefaults);
            return regionFacts({ ...d, ...rc });
          }),
        };
      }
      return { page, types };
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
