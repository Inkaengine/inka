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
 * Nothing here decides what is allowed: the editor's handlers do, for every
 * caller. A template's locked block refuses a change, a fixed one refuses
 * removal, and nothing is added where the editor offers no "+"; the refusal
 * reaches the agent as the error it throws. To change a template, the agent
 * unlocks it and locks it again, as a person does (unlockTemplateOf,
 * lockTemplates).
 *
 * `live.current` is refreshed by the editor on every render with its current
 * state and handlers: { properties, blockPathMap, templateEditMode,
 * insertAndSelectBlock, onDeleteBlock, moveBlocks, onChangeBlock,
 * enterTemplateEdit, commitTemplateEdit, blocksConfig, intl }.
 */
import { PAGE_BLOCK_UID } from '@volto-hydra/hydra-js';
import {
  getBlockById,
  getBlockTypeSchema,
  getAllContainerFields,
  getContainerRegionDescriptors,
  resolveRegionConstraints,
  resolveObjectListConstraints,
  stripEmptyBlocks,
} from '../../utils/blockPath';
import { stripFixedInsideSlots } from '@volto-hydra/helpers';
import { getDefaultBlockType } from '../../utils/injectedVoltoConfig';
import { getPageAllowedBlocksFromRestricted } from '../../../../hydra-js/buildBlockPathMap.js';
import { lockedBy } from '../AgentSite/lockedBy';

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

/** `v` as plain data; a front end's guidance or examples must be data to reach an agent. */
function plainOrThrow(v, type, key) {
  const out = plain(v);
  if (out === undefined) throw new Error(`getBlockSchemas: ${type}'s ${key} is not plain data`);
  return out;
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
  // The home page's editor is at /edit: its path is "/", not "".
  const contentPath = () => window.location.pathname.replace(/\/edit\/?$/, '') || '/';
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
  const blockData = (id) => getBlockById(properties(), live.current.blockPathMap, id);

  const api = {
    /** The page as the editor holds it, and the version a save is checked against. */
    /**
     * The page as the editor has it, and `lockedBy` when someone else holds
     * its lock (the editor's "locked by" message): their save would win, and
     * this editor's is refused.
     */
    getPage() {
      const { properties: formData, blockPathMap, contentLock, sessionToken } = live.current;
      return {
        path: contentPath(), version: formData.modified, formData,
        // The page is a block of its content type (see getBlockSchemas).
        blockPathMap: { ...blockPathMap, [PAGE_BLOCK_UID]: { ...blockPathMap[PAGE_BLOCK_UID], blockType: formData['@type'] } },
        lockedBy: lockedBy(contentLock, sessionToken),
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
          ...(plain(blocksConfig[type].description) !== undefined && { description: plain(blocksConfig[type].description) }),
          // A block's display variants (a listing's summary/grid, …), as its variation field offers them.
          variations: (blocksConfig[type].variations ?? []).map((v) => ({
            id: v.id,
            ...(plain(v.title) !== undefined && { title: plain(v.title) }),
            ...(v.isDefault && { isDefault: true }),
          })),
          // What the front end says of the block, for an agent: how to use it,
          // and examples of it filled in (stored blocks).
          ...(blocksConfig[type].guidance !== undefined && { guidance: plainOrThrow(blocksConfig[type].guidance, type, 'guidance') }),
          ...(blocksConfig[type].examples !== undefined && { examples: plainOrThrow(blocksConfig[type].examples, type, 'examples') }),
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
      // The page is a block of its content type. The editor holds it as
      // `_page` (the content type's fields with the page's regions); an agent
      // sees it under the content type's own name, titled and described as the
      // content type is, so a page is read, described and changed as any block.
      const contentType = properties['@type'];
      const { contentTypeSchema } = live.current;
      if (!contentTypeSchema?.title) throw new Error(`getBlockSchemas: no schema for the page's content type ${contentType}`);
      types[contentType] = {
        ...types[PAGE_BLOCK_UID],
        title: contentTypeSchema.title,
        ...(contentTypeSchema.description && { description: contentTypeSchema.description }),
        contentType: true,
      };
      delete types[PAGE_BLOCK_UID];
      return { page: { ...page, contentType }, types };
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

    /** Change some of a block's fields, through the sidebar's own handler. */
    async update({ id, fields }) {
      requireBlock('update', id);
      await commit('update', () => live.current.onChangeBlock(id, { ...blockData(id), ...fields }));
    },

    /** Delete a block, as the editor's delete does. */
    async remove(id) {
      requireBlock('remove', id);
      await commit('remove', () => live.current.onDeleteBlock(id, true));
    },

    /**
     * Unlock the template a block belongs to, as its lock icon does: its
     * locked blocks become editable, and lockTemplates saves them to the
     * template. Resolves to the template instance id, or null for a block that
     * belongs to no template.
     */
    async unlockTemplateOf(id) {
      requireBlock('unlockTemplateOf', id);
      const instanceId = blockData(id)?.templateInstanceId;
      if (!instanceId) return null;
      if (!live.current.templateEditMode.includes(instanceId)) {
        await live.current.enterTemplateEdit(instanceId);
        await until(() => live.current.templateEditMode.includes(instanceId), STATE_LIMIT_MS,
          `unlockTemplateOf: the template of "${id}" did not unlock`);
      }
      return instanceId;
    },

    /**
     * Lock every unlocked template with "Change on all pages", as the lock's
     * dialog does: each is saved to its template document now, so every page
     * using it changes. Resolves to the templates saved.
     */
    async lockTemplates() {
      const saved = [];
      for (const instanceId of [...live.current.templateEditMode]) {
        delete live.current.templateCommitOutcomes[instanceId];
        if (!live.current.commitTemplateEdit(instanceId)) {
          throw new Error(`lockTemplates: the template's structure is not valid, so it was not saved (${instanceId})`);
        }
        await until(() => !live.current.templateEditMode.includes(instanceId) && !live.current.committingTemplate,
          SAVE_LIMIT_MS, `lockTemplates: the template (${instanceId}) did not finish saving`);
        const outcome = live.current.templateCommitOutcomes[instanceId];
        if (!outcome) throw new Error(`lockTemplates: the template (${instanceId}) was locked but not saved: the editor had not loaded it`);
        if (outcome.error) throw new Error(`lockTemplates: ${outcome.templateId} was not saved: ${outcome.error}`);
        saved.push(outcome.templateId);
      }
      return saved;
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
      // The editor's own save, as SAVE_REQUEST triggers it. It leaves the
      // editor when it saves; when the CMS refuses, the refusal is the
      // update's error, and says why.
      const before = live.current.contentUpdate;
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 's', ctrlKey: true, bubbles: true, cancelable: true,
      }));
      const refusal = () => {
        const update = live.current.contentUpdate;
        return update !== before && update?.error ? update.error : null;
      };
      await until(
        () => !/\/edit\/?$/.test(window.location.pathname) || refusal(),
        SAVE_LIMIT_MS, 'save: the editor did not save',
      );
      const refused = refusal();
      if (refused) {
        throw new Error(`save: the CMS refused it: ${refused.response?.body?.error?.message ?? refused.message}`);
      }
      return { version: await readVersion(path) };
    },
  };

  window.__inkaAgent = api;
  return () => {
    if (window.__inkaAgent === api) delete window.__inkaAgent;
  };
}
