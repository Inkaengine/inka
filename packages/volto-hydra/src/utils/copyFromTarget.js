/**
 * Copy-from-target: a generic version of the Volto teaser's "sync data from
 * the linked content item" behaviour, driven by `fieldMappings['@target']`.
 *
 * A block declares which target-content attributes map to which of its own
 * fields, reading each brain key verbatim (same shape the listing expander uses):
 *
 *   fieldMappings: {
 *     '@target': {
 *       title: 'title',
 *       description: 'description',
 *       Subject: 'tags',
 *       image: 'preview_image',
 *     },
 *   }
 *
 * The target snapshot rides on the block's link/url field (the object_browser
 * `selectedItemAttrs`), e.g. `block.href[0] = { title, description, … }`.
 *
 * A mapped field is LINKED only when the block SAYS a link owns it, in
 * `_pullFrom` ({ linkField: [field, ...] }). Everything else is the author's own
 * and is never written to.
 *
 * This module is the PURE core (no React): mapping lookup, schema field-widget
 * swap, and per-field value extraction — the last DELEGATED to the shared
 * `convertFieldValue` + `widgetToTargetType` (the type is derived from the dest
 * field's widget), so copy-from-target and the listing expander pull identically.
 * The enhancer that installs it on every block and the `copyFromTargetField`
 * wrapper widget build on these.
 */
import { getMappingTarget, widgetToTargetType } from './blockSync';
import { convertFieldValue, normalizeCatalogImage } from '@volto-hydra/helpers';
import { isInternalURL } from '@plone/volto/helpers/Url/Url';
import {
  getTargetMapping,
  getSourceField,
  fieldsToPullOnPick,
  sourceFieldFor,
  isFieldPulled,
  withFieldNotPulled,
  schemaProperties,
  PULL_FROM_KEY,
  targetDestinations,
} from './copyFromTargetMapping';
export {
  getTargetMapping,
  getSourceField,
  sourceFieldFor,
  isFieldPulled,
  withFieldPulled,
  withFieldNotPulled,
  fieldsToPullOnPick,
  linkFields,
  PULL_FROM_KEY,
} from './copyFromTargetMapping';

/** Widget name the mapped destination fields are swapped to (the wrapper). */
export const COPY_FROM_TARGET_WIDGET = 'copyFromTargetField';

/**
 * Catalog-brain keys a copy-from-target block could ever pull. The link field's
 * object_browser widget keeps exactly these on a pick (its `selectedItemAttrs`),
 * so the stored snapshot carries the full set — any mapped field pulls from it,
 * and a field the author has claimed stays re-linkable — without a live @search. `image`
 * is the raw `image_scales` + `image_field` pair (normalizeCatalogImage folds
 * them into a single `image` object at pull time).
 */
export const CANONICAL_SNAPSHOT_KEYS = [
  'title',
  'description',
  'image_scales',
  'image_field',
  'hasPreviewImage',
  'Subject',
  'created',
  'modified',
  'effective',
  'expires',
  'start',
  'end',
];


/**
 * Swap each mapped destination field's widget to the wrapper, stashing the
 * original field def under `baseWidget` for faithful re-resolution. No-op when
 * the block declares no @target mapping. Idempotent. Returns a new schema.
 */
export function applyCopyFromTargetToSchema(schema, blockConfig) {
  const mapping = getTargetMapping(blockConfig);
  if (!mapping || !schema?.properties) return schema;

  const dests = targetDestinations(mapping);
  const properties = { ...schema.properties };
  let changed = false;

  for (const field of dests) {
    const def = properties[field];
    if (!def) continue; // mapped to a field the schema doesn't declare
    if (def.widget === COPY_FROM_TARGET_WIDGET) continue; // already wrapped (idempotent)
    properties[field] = {
      ...def,
      widget: COPY_FROM_TARGET_WIDGET,
      // Preserve the ORIGINAL field def so the wrapper can re-resolve the
      // real widget (object_browser/textarea/select/…) exactly as Volto would.
      baseWidget: def,
    };
    changed = true;
  }

  // Tell the link field's object_browser widget to KEEP every field we COULD ever
  // pull when it stores a pick — not just the ones this block's mapping uses today
  // (the widget projects the picked item to `[...selectedItemAttrs, '@id', 'title']`,
  // and the object browser fetches metadata_fields:'_all', so the data is there).
  // A block may map any of these; a field the author has claimed must still be
  // re-linkable. So the snapshot carries the full canonical set and every field
  // pulls from it — no live @search.
  //
  // It goes on the DECLARED source. Stamped onto whichever link field came first
  // in the schema, a button's keys landed on its dead `url: 'Link (legacy)'` while
  // `href` — the field the author actually picks with — never stored a snapshot,
  // so the pull could not have worked there even pointed correctly.
  const sourceField = getSourceField(blockConfig);
  if (sourceField && properties[sourceField]) {
    properties[sourceField] = {
      ...properties[sourceField],
      selectedItemAttrs: [...CANONICAL_SNAPSHOT_KEYS],
    };
    changed = true;
  }

  return changed ? { ...schema, properties } : schema;
}

/**
 * The @target mapping entry whose destination is `field`: its source attr and
 * (optional) declared hydra type ({ field, type } form). Null if not mapped.
 */
function mappingEntryFor(field, mapping) {
  for (const [src, dest] of Object.entries(mapping)) {
    if (getMappingTarget(dest) === field) {
      return { src, type: typeof dest === 'object' ? dest.type : undefined };
    }
  }
  return null;
}

/**
 * The @id of the target `field` pulls from — the first item of ITS source link
 * field — or undefined.
 *
 * Per field, not per block: a block may pull its title from `href` and its
 * image from `preview_image_link`, and each resolves against its own link. With
 * no field named, or a field nothing owns yet, it answers for the declared
 * source — which is what "what WOULD this field pull" needs.
 */
export function getTargetId(blockConfig, blockData, field) {
  const linkField =
    (field && sourceFieldFor(field, blockData)) || getSourceField(blockConfig);
  return linkField ? blockData?.[linkField]?.[0]?.['@id'] : undefined;
}

/**
 * The value `field` should hold if synced from the target, or undefined when
 * the field isn't mapped or no target is selected.
 *
 * `liveTarget` (snapshot-shaped, from a fresh catalog @search) overrides the
 * stored link-field snapshot, so a linked field pulls the target AS IT IS NOW,
 * not as it was when it was last selected. Falls back to the stored snapshot
 * when no live target is available.
 *
 * Value handling is the SAME contract the listing expander uses: normalize the
 * brain (package image_scales/image_field into a single `image` object), read the
 * mapped source key verbatim, then `convertFieldValue` it to the shape the dest
 * field's widget wants — object_browser image → array, ImageWidget → URL string,
 * slate → nodes, and plain fields (tags, dates, strings) straight through. The
 * type is derived from the widget (or an explicit `{type}` on the mapping wins).
 */
export function getTargetValueForField(field, blockConfig, blockData, liveTarget) {
  const mapping = getTargetMapping(blockConfig);
  if (!mapping) return undefined;
  const entry = mappingEntryFor(field, mapping);
  if (!entry) return undefined;

  const linkField =
    sourceFieldFor(field, blockData) || getSourceField(blockConfig);
  const rawSnapshot = liveTarget || (linkField ? blockData?.[linkField]?.[0] : undefined);
  if (!rawSnapshot) return undefined;

  const snapshot = normalizeCatalogImage(rawSnapshot);
  const raw = snapshot[entry.src];
  if (raw === undefined) return undefined;

  // Derive the conversion type from the DESTINATION field's widget (the same
  // rule block-type conversion uses), so we never hard-code per-field behaviour.
  const rawDef = schemaProperties(blockConfig, blockData)[field];
  const destDef = rawDef?.widget === COPY_FROM_TARGET_WIDGET ? rawDef.baseWidget : rawDef;
  const type = entry.type ?? widgetToTargetType(destDef?.widget, destDef);
  return convertFieldValue(raw, type);
}


/**
 * A mapped field is LINKED when the block SAYS a link owns it (`_pullFrom`) and
 * that link holds a resolvable internal target. Everything else — including a
 * block that says nothing at all — is the author's own and is never written to.
 *
 * Only an INTERNAL link is a pull source: an external URL has no catalog item
 * to pull from, so its fields stay plain editable (no linked state, no pull).
 */
export function isFieldLinked(field, blockConfig, blockData) {
  const mapping = getTargetMapping(blockConfig);
  if (!mapping || !mappingEntryFor(field, mapping)) return false;
  const recorded = sourceFieldFor(field, blockData);
  if (!recorded) return false;
  // The source is the one the MAPPING declares, and nothing can choose another:
  // the sidebar's toggle is per destination field, and every path asks the
  // config (`getSourceField`). A record naming a different link is therefore
  // unreachable — bad data rather than a second source — so it fails here
  // instead of quietly pulling from a link nobody mapped.
  const declared = getSourceField(blockConfig);
  if (recorded !== declared) {
    throw new Error(
      `${blockConfig?.id || 'block'}._pullFrom says "${field}" pulls from "${recorded}", ` +
        `but the mapping declares "${declared}" as the source. Nothing can pick a ` +
        `different link, so this record cannot have come from the editor.`,
    );
  }
  const targetId = getTargetId(blockConfig, blockData, field);
  return !!targetId && isInternalURL(targetId);
}

/** Mapped destination field names a @target mapping writes to, or []. */
function targetDestFields(blockConfig) {
  const mapping = getTargetMapping(blockConfig);
  if (!mapping) return [];
  return [...new Set(Object.values(mapping).map(getMappingTarget).filter(Boolean))];
}

function isEqualJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Pull every field a link OWNS (`_pullFrom`) from the target in ONE write,
 * returning a new block with all of them set. Call this synchronously when the
 * source link changes (pick/type) so a multi-field @target block fills all its
 * fields atomically.
 *
 * Without it, each field's widget pulls independently via a field-scoped
 * onChange; those concurrent writes read the same stale block and clobber one
 * another, so a single-field block (button → title) is fine but a multi-field
 * @default block (hero → heading/subheading/image) keeps only the last-written
 * field and loses the rest. Fields already at their target value, fields no link
 * owns, and fields with no resolvable target value (e.g. a typed URL carrying no
 * snapshot metadata) are left untouched.
 */
export function pullLinkedFields(blockConfig, blockData, liveTarget) {
  let next = blockData;
  for (const field of targetDestFields(blockConfig)) {
    if (!isFieldLinked(field, blockConfig, blockData)) continue;
    const value = getTargetValueForField(field, blockConfig, blockData, liveTarget);
    if (value === undefined) continue;
    if (isEqualJson(blockData?.[field], value)) continue;
    next = { ...next, [field]: value };
  }
  return next;
}

/**
 * Picking a link hands it the mapped fields that are still EMPTY — which is
 * what makes them track it, since nothing is pulled unless the block says so.
 *
 * It applies only while the block has said NOTHING about that link. Once the
 * record names the source, the decision has been made and is left alone — even
 * when its list is empty, which is the state after unticking every toggle. That
 * is why `withFieldNotPulled` keeps the key: it is the difference between "the
 * author released these" and "nobody has decided yet".
 *
 * A field already holding words stays the author's, so a pick never overwrites
 * anything (Volto's own guard on its teaser, kept). Shared by both pick paths —
 * the canvas link widget and the sidebar — so they cannot drift.
 */
export function linkPickedFields(blockConfig, blockData) {
  const sourceField = getSourceField(blockConfig);
  if (!sourceField) return blockData;
  if (blockData?.[PULL_FROM_KEY]?.[sourceField] !== undefined) return blockData;

  const targetId = blockData?.[sourceField]?.[0]?.['@id'];
  if (!targetId || !isInternalURL(targetId)) return blockData;

  const fields = fieldsToPullOnPick(blockConfig, blockData);
  if (!fields.length) return blockData;
  return { ...blockData, [PULL_FROM_KEY]: { ...blockData[PULL_FROM_KEY], [sourceField]: fields } };
}

/**
 * Editing a linked field CLAIMS it: the field drops out of `_pullFrom`, keeping
 * the value just typed. The ONE mechanism for EVERY edit path (sidebar, inline
 * canvas, image, link) — rather than hook each path, compare by value: diff
 * `incoming` against `previous` and release any @target destination whose value
 * changed. This runs on every committed formData change, so three guards keep it
 * correct:
 *   1. it was LINKED in the previous (pre-edit) state — typing into a field no
 *      link owns changes nothing, and a field nothing owns is already the
 *      author's;
 *   2. its value actually changed;
 *   3. the NEW value differs from the TARGET value — this is what distinguishes a
 *      user edit (writes something other than the target) from the PULL itself
 *      (writes exactly the target). Without it, the pull would release the very
 *      field it just synced.
 *
 * An agent can do the same thing by hand, because the record is a list of
 * strings on the block: that is the point of storing it rather than inferring
 * it (inka#595).
 *
 * Recurses into nested container blocks. Returns a shallow clone (=== previous
 * content when nothing changed, so callers can cheaply skip a no-op write).
 */
export function unpullEditedFields(incoming, previous, blocksConfig) {
  if (!incoming?.blocks || !previous?.blocks || !blocksConfig) return incoming;
  let anyFlipped = false;

  const visit = (inBlocks, prevBlocks) => {
    for (const id of Object.keys(inBlocks)) {
      let block = inBlocks[id];
      const prevBlock = prevBlocks?.[id];
      if (!block || typeof block !== 'object') continue;

      const cfg = blocksConfig[block['@type']];
      if (cfg && prevBlock) {
        for (const field of targetDestFields(cfg)) {
          if (
            isFieldLinked(field, cfg, prevBlock) && // was linked BEFORE the edit
            isFieldPulled(field, block) && // not already released (idempotent)
            !isEqualJson(block[field], prevBlock[field]) && // its value changed
            !isEqualJson(block[field], getTargetValueForField(field, cfg, block)) // not the pull
          ) {
            block = withFieldNotPulled(block, field);
            inBlocks[id] = block;
            anyFlipped = true;
          }
        }
      }
      if (block.blocks) {
        block = { ...block, blocks: { ...block.blocks } };
        inBlocks[id] = block;
        visit(block.blocks, prevBlock?.blocks);
      }
    }
  };

  const cloned = { ...incoming, blocks: { ...incoming.blocks } };
  visit(cloned.blocks, previous.blocks);
  return anyFlipped ? cloned : incoming;
}

/**
 * Pull every OWNED field of every block from its stored snapshot — the on-load
 * pass that refreshes them when the page is opened for editing. A block that
 * names no source is left exactly as it was: that is what keeps an authored
 * title written by the importer or by an agent from being replaced (inka#595). Snapshot-based
 * (no live @search): a canvas pick stores the full selectedItemAttrs, so its
 * linked fields fill; a sidebar link that stored only `[{@id}]` has no metadata
 * to pull from (the unsupported path). Unowned fields are left untouched. Recurses
 * nested container blocks. Returns the same formData when nothing changed, so a
 * settled document is a no-op.
 */
export function pullAllLinkedFields(formData, blocksConfig) {
  if (!formData?.blocks || !blocksConfig) return formData;
  let anyPulled = false;

  const visit = (blocks) => {
    for (const id of Object.keys(blocks)) {
      let block = blocks[id];
      if (!block || typeof block !== 'object') continue;

      const cfg = blocksConfig[block['@type']];
      if (cfg) {
        const pulled = pullLinkedFields(cfg, block);
        if (pulled !== block) {
          block = pulled;
          blocks[id] = block;
          anyPulled = true;
        }
      }
      if (block.blocks) {
        block = { ...block, blocks: { ...block.blocks } };
        blocks[id] = block;
        visit(block.blocks);
      }
    }
  };

  const cloned = { ...formData, blocks: { ...formData.blocks } };
  visit(cloned.blocks);
  return anyPulled ? cloned : formData;
}

/**
 * A block schemaEnhancer that applies the copy-from-target field-widget swap.
 * Bound to the block's config at install time (so this module stays free of the
 * Volto registry / React context — the tested pure core).
 */
export function copyFromTargetEnhancer(blockConfig) {
  const enhancer = ({ schema }) => applyCopyFromTargetToSchema(schema, blockConfig);
  enhancer._isCopyFromTargetEnhancer = true;
  return enhancer;
}

/**
 * Append `copyFromTargetEnhancer` to every block that declares a
 * `fieldMappings['@target']` — the author's only opt-in is the mapping itself
 * (no per-block enhancer wiring). Idempotent. Mirrors installChildBlockEnhancers.
 *
 * Call once at INIT, after blocksConfig is populated.
 */
export function installCopyFromTargetEnhancers(blocksConfig) {
  if (!blocksConfig) return;
  const isInstalled = (fn) => fn?._isCopyFromTargetEnhancer === true;

  for (const blockType of Object.keys(blocksConfig)) {
    const cfg = blocksConfig[blockType];
    if (!cfg || blockType === '_page') continue;
    if (!getTargetMapping(cfg)) continue; // gate: no @target mapping → skip

    const existing = cfg.schemaEnhancer;
    if (typeof existing === 'function') {
      if (isInstalled(existing)) continue;
      if (Array.isArray(existing._parts) && existing._parts.some(isInstalled)) continue;
    } else if (existing && typeof existing === 'object') {
      // Recipe form — installed on a later function-form pass (same caveat as
      // installChildBlockEnhancers).
      continue;
    }

    const enhancer = copyFromTargetEnhancer(cfg);
    let combined;
    if (typeof existing === 'function') {
      const parts = Array.isArray(existing._parts)
        ? [...existing._parts, enhancer]
        : [existing, enhancer];
      combined = (args) => parts.reduce((schema, fn) => fn({ ...args, schema }), args.schema);
      combined.config = existing.config;
      combined._parts = parts;
    } else {
      combined = enhancer;
    }
    cfg.schemaEnhancer = combined;
  }
}
