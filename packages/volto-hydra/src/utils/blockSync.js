/**
 * Block Sync Utilities
 *
 * How a container block SYNCS schema + data with its child blocks: a grid/listing
 * fixing its children's item type, inheriting shared defaults, hiding the fields
 * the parent owns, and gating a child's fields on the parent's settings
 * (`fieldRules`). Formerly "schemaInheritance" — the through-line is keeping
 * parent and child blocks in sync, not inheritance per se.
 *
 * Used by listing blocks, grid blocks, and other containers that need to show
 * editable fields from a referenced block type.
 *
 * ## Two valid sources for blockId / blockPathMap
 *
 * Three enhancers in this file — `inheritSchemaFrom`, `hideParentOwnedFields`,
 * and `resolveFieldPath` (used by `fieldRules`) — need to know which block
 * they're enhancing and where it lives in the page tree. They get that from
 * one of two sources, both first-class (NOT a fallback chain):
 *
 *   1. **`args.blockId` / `args.blockPathMap`** — passed explicitly by
 *      `buildBlockPathMap` pass 2 in `packages/hydra-js/buildBlockPathMap.js`.
 *      That code runs the enhancer outside any React tree to populate
 *      `pathMap._schemas` with fully-enhanced schemas.
 *
 *   2. **`hydraContext`** (from `../context/HydraSchemaContext`) — set by
 *      `HydraSchemaProvider` around the sidebar render in
 *      `components/Sidebar/ParentBlocksWidget.jsx`. Volto core call sites
 *      (`withVariationSchemaEnhancer` HOC wrapping `BlockDataForm`,
 *      `applySchemaEnhancer` in `Form.jsx` validation, `Blocks.js`
 *      schema-derived helpers, etc.) invoke block enhancers with only
 *      `{ schema, formData, intl }` — no blockId. `hydraContext` is the
 *      bridge that carries the currently-rendering block id from
 *      `ParentBlocksWidget` down through Volto's HOCs to our enhancers.
 *
 * Each path is the canonical source for its caller; one is not a substitute
 * for the other. If you ever shadow Volto's `withBlockSchemaEnhancer.jsx` to
 * inject `blockId` into the args at every Volto call site, the `hydraContext`
 * branch can be removed — until then, both branches are load-bearing.
 */
import { getInjectedBlocksConfig, getSlateStyleGlobals, getSlateVocabulary } from './injectedVoltoConfig.js';
import { normalizeSlateFields, undefinedSlateTypes } from '../../../hydra-js/slateStyles.js';
import { getContainerFieldConfig, getBlockByPath, getBlockTypeSchema, getBlockById, updateBlockById,
  deleteBlockFromContainer, ensureEmptyBlockIfEmpty, removeReplacedPlaceholder, getChildBlockIds, getChildField, getChildBlockIdsInField, convertValueContainer, convertContainerBlock, getContainerRegionDescriptors, insertBlockInContainer, parseRegionPath, expandValueIntoRegion, collapseRegionToValue } from './blockPath.js';
import { addableSiblingTypes, buildBlockPathMap } from '../../../hydra-js/buildBlockPathMap.js';
import { PAGE_BLOCK_UID } from '@volto-hydra/hydra-js';
import {
  convertFieldValue,
  resolveFieldPath as resolveBlockFieldPath,
  getFieldValue,
  getFieldDef,
  getFieldTypeString,
  getChildBlockEntries,
  setChildBlockEntries,
  getBlockType,
  isSlateFieldType,
  slateNodesText,
  isBlockReadonly,
  isBlockPositionLocked,
  getBlockAddability,
} from '@volto-hydra/helpers';
import { getHydraSchemaContext, setHydraSchemaContext, getLiveBlockData } from '../context/index.js';
// Pure validation/default-application logic lives in schemaValidation.js
// (no dependencies — safe to import from CI scripts and test runners).
// Re-exported here for backward compat; schemaValidation.js is the SSOT.
export {
  applySchemaDefaultsToBlock,
  applySchemaDefaultsToBlockWithContext,
} from './schemaValidation.mjs';
// The internal callers below need direct access (re-exports aren't visible
// to module-local code in some bundler configs).
import {
  applySchemaDefaultsToBlock,
  applySchemaDefaultsToBlockWithContext,
} from './schemaValidation.mjs';

// Conversion-graph logic lives in conversionValidation.mjs so it stays free of
// the React context barrel (a Playwright gate imports it directly).
// Re-exported here for backward compat; conversionValidation.mjs is the SSOT.
export {
  DEFAULT_TYPE_FIELDS,
  hasValidDefault,
  shapeSignature,
  getConvertibleTypes,
  validateConversionRegistry,
} from './conversionValidation.mjs';
import {
  DEFAULT_TYPE_FIELDS,
  getConvertibleTypes,
  hasValidDefault,
} from './conversionValidation.mjs';

// Re-export getBlockTypeSchema from blockPath for convenience
export { getBlockTypeSchema };

/**
 * Synthesize a schemaEnhancer that adds Volto's "variation" field to the
 * schema for blocks that declare `variations` on their config.
 *
 * Volto adds this field at sidebar render time via `withVariationSchemaEnhancer`
 * — but that means it's never present in pathmap-built schemas (`pathMap._schemas`),
 * causing a split between what the sidebar sees and what hydra sees.
 *
 * Prepending this enhancer to a block's schemaEnhancer chain at INIT
 * (see `installVariationFieldEnhancers` below) puts the variation field
 * into the schema during pathmap-build, so the cached schema is a true
 * superset of what Volto would render. Volto's own
 * `withVariationSchemaEnhancer` is then redundant — it runs the same field
 * add and overwrites with identical content (harmless), or we suppress
 * it via `applySchemaEnhancers=false` on the sidebar form.
 *
 * Mirrors the field shape produced by Volto's `addExtensionFieldToSchema`
 * so the resulting schema is identical regardless of which path produced it.
 */
function addVariationFieldEnhancer(variations) {
  const fn = ({ schema, intl }) => {
    if (!variations || variations.length <= 1) return schema;

    const _ = (msg) =>
      typeof intl?.formatMessage === 'function'
        ? intl.formatMessage(typeof msg === 'string' ? { id: msg, defaultMessage: msg } : msg)
        : (typeof msg === 'string' ? msg : msg?.defaultMessage || msg?.id || '');

    const hasDefault = variations.findIndex(({ isDefault }) => isDefault) > -1;

    const newSchema = {
      ...schema,
      properties: {
        ...schema.properties,
        variation: {
          title: _('Variation'),
          choices: variations.map(({ id, title }) => [id, _(title)]),
          noValueOption: false,
          default: hasDefault ? variations.find((v) => v.isDefault).id : null,
        },
      },
      fieldsets: schema.fieldsets ? schema.fieldsets.map((fs) => ({ ...fs })) : [],
    };

    // Ensure 'variation' appears in the default fieldset (mirrors Volto's _addField).
    const defaultFs = newSchema.fieldsets.find((fs) => fs.id === 'default');
    if (defaultFs) {
      if (!defaultFs.fields?.includes('variation')) {
        defaultFs.fields = ['variation', ...(defaultFs.fields || [])];
      }
    } else {
      newSchema.fieldsets.unshift({
        id: 'default',
        title: _('Default'),
        fields: ['variation'],
      });
    }

    return newSchema;
  };
  // Tag so installVariationFieldEnhancers can detect already-installed and avoid double-prepend.
  fn._isVariationFieldEnhancer = true;
  return fn;
}

/**
 * Eager-populate the module-level `_typeSchemaCache` for every registered
 * block type by calling `getBlockTypeSchema(type, intl, blocksConfig)`.
 *
 * Why: the cache was lazy and could be filled during a sidebar render
 * (when `hydraContext.currentBlockId` is set to whatever's rendering),
 * leaking instance context into a type-only lookup and producing
 * filtered schemas that all later callers got. Filling at INIT — when no
 * sidebar is rendering and `hydraContext` is null — guarantees the cached
 * value reflects the type's intrinsic schema, not "image-as-it-appears-
 * inside-the-grid-currently-being-rendered."
 *
 * Call after `installVariationFieldEnhancers` so cached schemas include
 * the variation field for blocks that have one.
 */
export function populateTypeSchemaCache(blocksConfig, intl) {
  if (!blocksConfig) return;
  for (const blockType of Object.keys(blocksConfig)) {
    // getBlockTypeSchema short-circuits on cache hit; first call fills.
    getBlockTypeSchema(blockType, intl, blocksConfig);
  }
}

/**
 * Walk the registered blocksConfig and, for any block with
 * `variations.length > 1`, prepend an `addVariationFieldEnhancer` to its
 * schemaEnhancer chain. Idempotent — re-running is safe (already-installed
 * enhancers are tagged and skipped).
 *
 * Call this once at INIT after blocksConfig is fully populated, so every
 * code path that runs the schemaEnhancer chain (pathmap build, sidebar
 * render, type-cache fill) sees the same fully-resolved schema.
 */
export function installVariationFieldEnhancers(blocksConfig) {
  if (!blocksConfig) return;
  for (const blockType of Object.keys(blocksConfig)) {
    const cfg = blocksConfig[blockType];
    if (!cfg || !Array.isArray(cfg.variations) || cfg.variations.length <= 1) continue;

    const existing = cfg.schemaEnhancer;
    // Detect already-installed (top of chain or via _parts):
    if (typeof existing === 'function' && existing._isVariationFieldEnhancer) continue;
    if (typeof existing === 'function' && Array.isArray(existing._parts)
        && existing._parts[0]?._isVariationFieldEnhancer) continue;

    const variationEnhancer = addVariationFieldEnhancer(cfg.variations);

    let combined;
    if (typeof existing === 'function') {
      const parts = Array.isArray(existing._parts)
        ? [variationEnhancer, ...existing._parts]
        : [variationEnhancer, existing];
      combined = (args) => parts.reduce((schema, fn) => fn({ ...args, schema }), args.schema);
      combined.config = existing.config;
      combined._parts = parts;
    } else if (existing && typeof existing === 'object') {
      // Recipe form (rare here — recipes are turned into functions by createSchemaEnhancerFromRecipe).
      // Don't touch — the recipe processor will invoke its own composition; we'll be re-run after.
      continue;
    } else {
      // No existing enhancer — set the variation enhancer as the sole one.
      combined = variationEnhancer;
    }

    cfg.schemaEnhancer = combined;
  }
}

/**
 * Append a `hideParentOwnedFields()` enhancer to every block's schemaEnhancer
 * chain. Idempotent (already-installed enhancers are tagged via
 * `_isChildBlockEnhancer`).
 *
 * Why: in Volto Hydra, any block can be a child of a parent that uses
 * schema inheritance (typeField + mappingField). Auto-installing the
 * enhancer makes the default behavior correct: when a parent has a
 * typeField selected and claims fields (via runtime fieldMapping or via
 * `parentControlled[childType]`), those fields are hidden on the child
 * sidebar form. Blocks don't need to opt in or remember any per-child
 * configuration.
 *
 * Parent-side override: declare a `parentControlled: { childType: [...] }`
 * map on the parent's `inheritSchemaFrom` config to claim ADDITIONAL
 * fields beyond what runtime fieldMapping captures (e.g. styling fields
 * that the parent always owns).
 *
 * Call this once at INIT, after blocksConfig is fully populated.
 */
export function installChildBlockEnhancers(blocksConfig) {
  if (!blocksConfig) return;
  for (const blockType of Object.keys(blocksConfig)) {
    const cfg = blocksConfig[blockType];
    if (!cfg || blockType === '_page') continue;

    const existing = cfg.schemaEnhancer;
    const isInstalled = (fn) => fn?._isChildBlockEnhancer === true;

    if (typeof existing === 'function') {
      if (isInstalled(existing)) continue;
      if (Array.isArray(existing._parts) && existing._parts.some(isInstalled)) continue;
    } else if (existing && typeof existing === 'object') {
      // Recipe form — `createSchemaEnhancerFromRecipe` turns it into a
      // function elsewhere. We can't rewrite the recipe here cleanly; the
      // recipe processor will run its enhancers and we install ours later
      // via the function-form branch above on a subsequent INIT pass.
      continue;
    }

    const childEnhancer = hideParentOwnedFields();
    childEnhancer._isChildBlockEnhancer = true;
    childEnhancer._needsBlockPathMap = true;

    let combined;
    if (typeof existing === 'function') {
      // Append after existing parts so other enhancers add their fields
      // first; we hide last from the final schema.
      const parts = Array.isArray(existing._parts)
        ? [...existing._parts, childEnhancer]
        : [existing, childEnhancer];
      combined = (args) => parts.reduce((schema, fn) => fn({ ...args, schema }), args.schema);
      combined.config = existing.config;
      combined._parts = parts;
    } else {
      combined = childEnhancer;
    }

    cfg.schemaEnhancer = combined;
  }
}

/**
 * Resolve a block's blockSchema.properties, handling both static and
 * factory-form blockSchemas. Returns null if no schema declared.
 *
 * @private
 */
function _resolveBlockSchemaProperties(blockConfig, intl) {
  const schemaSource = blockConfig?.blockSchema || blockConfig?.schema;
  if (!schemaSource) return null;
  const schema = typeof schemaSource === 'function'
    ? schemaSource({ formData: {}, data: {}, intl })
    : schemaSource;
  return schema?.properties || null;
}

/**
 * Find the typeField name for a block.
 *
 * Lookup order:
 *   1. inheritSchemaFrom recipe with explicit `typeField` (used by listings,
 *    which have no blocks field to declare on).
 *   2. Schema walk: first blocks field with `itemTypeField` declared on it
 *    (used by container blocks).
 *
 * Returns null if no typeField is found.
 *
 * @param {Object} blockConfig - blocksConfig entry for the block type
 * @param {Object} intl - react-intl object (for resolving factory schemas)
 * @returns {string|null} The typeField name, or null
 */
export function findTypeField(blockConfig, intl) {
  if (!blockConfig) return null;

  // 1. Recipe-level typeField
  const enhancerCfg = blockConfig.schemaEnhancer;
  const recipeTypeField =
    enhancerCfg?.inheritSchemaFrom?.typeField ||
    enhancerCfg?.config?.typeField;
  if (recipeTypeField) return recipeTypeField;

  // 2. Schema walk for blocks field with itemTypeField declaration
  const properties = _resolveBlockSchemaProperties(blockConfig, intl);
  if (properties) {
    for (const fieldDef of Object.values(properties)) {
      if (fieldDef?.itemTypeField) return fieldDef.itemTypeField;
    }
  }

  return null;
}

/**
 * Find which blocks field declares the given typeField (for sync scope).
 * Returns the field name, or null if no declaration found.
 *
 * @param {Object} blockConfig - blocksConfig entry for the block type
 * @param {string} typeField - the typeField name to look up
 * @param {Object} intl - react-intl object (for resolving factory schemas)
 * @returns {string|null} The blocks field name, or null
 */
export function findBlocksFieldForTypeField(blockConfig, typeField, intl) {
  if (!blockConfig || !typeField) return null;
  const properties = _resolveBlockSchemaProperties(blockConfig, intl);
  if (!properties) return null;
  for (const [fieldName, fieldDef] of Object.entries(properties)) {
    if (fieldDef?.itemTypeField === typeField) return fieldName;
  }
  return null;
}

/**
 * Generate a unique slotId name based on block type.
 * Format: "blocktype-N" where N is the next available number.
 */
function generateSlotId(blockType, allBlocks) {
  const baseType = blockType || 'block';
  const existingNames = new Set();

  for (const block of Object.values(allBlocks || {})) {
    if (block?.slotId) existingNames.add(block.slotId);
  }

  let counter = 1;
  while (existingNames.has(`${baseType}-${counter}`)) {
    counter++;
  }

  return `${baseType}-${counter}`;
}

/**
 * Check if a position is inside a template by looking at neighbor blocks.
 * Returns { templateId, templateInstanceId, slotId } if inside a template, undefined otherwise.
 * The slotId is inherited from adjacent non-fixed slot blocks.
 *
 * Template membership is determined by the TARGET block of the insertion:
 * - "insert after X" → inherit from X (the block we're inserting after)
 * - "insert before Y" → inherit from Y (the block we're inserting before)
 * This ensures that inserting after a non-template block stays outside the template,
 * even if the next block is a template block.
 */
/**
 * Resolve a neighbor's block data from the container.
 * Supports both blocks_layout (layoutItems + allBlocks map) and object_list (items array).
 */
function getNeighborData(index, context) {
  const { layoutItems, allBlocks, items } = context;
  if (items) {
    // object_list: items is an array of objects
    return (index >= 0 && index < items.length) ? items[index] : null;
  }
  // blocks_layout: layoutItems is array of IDs, allBlocks is the map
  const neighborId = (index >= 0 && index < layoutItems.length) ? layoutItems[index] : null;
  return neighborId ? allBlocks[neighborId] : null;
}

function getTemplateInfoFromNeighbors(context) {
  const { position, layoutItems, allBlocks, containerId, field, items } = context;
  const containerLength = items ? items.length : layoutItems?.length || 0;

  if (containerLength === 0) {
    // Empty container — check if parent container has childSlotIds for this field.
    // This handles the case where all blocks in a slot region inside a container
    // have been deleted, leaving the container field empty.
    if (containerId && field) {
      // The parent container (for childSlotIds). Prefer the explicitly-passed block:
      // for a nested add, allBlocks is THIS level's siblings, so the parent lives one
      // level up and isn't in it. The id lookup only resolves when a caller passes the
      // parent-level allBlocks (e.g. a top-level container's empty slot).
      const parentBlock = context.parentBlock || allBlocks?.[containerId];
      if (parentBlock?.templateId && parentBlock?.childSlotIds?.[field]) {
        return {
          templateId: parentBlock.templateId,
          templateInstanceId: parentBlock.templateInstanceId,
          slotId: parentBlock.childSlotIds[field],
          fixed: true,
          readOnly: true,
        };
      }
    }
    return undefined;
  }

  // Position-based membership: examine BOTH neighbors and see whether a slot region
  // reaches this insertion gap. Drag DIRECTION is irrelevant — the same position always
  // yields the same membership. (The old `insertAfter ? prev : next` "inherit from the
  // target block" rule made one position mean two different things and, before the first
  // fixed anchor, inherited templateId + fixed:true from the fixed block while finding no
  // slot — an in-template, slot-less, read-only corrupt half-membership.)
  //
  // A neighbor "offers" this position into a slot when a slot region touches the gap:
  //   - a non-fixed slot block on EITHER side (the slot continues into the gap) → its slotId
  //   - the block BEFORE the gap, if fixed, via its `nextSlotId` (slot region AFTER it)
  //   - the block AFTER  the gap, if fixed, via its `prevSlotId` (slot region BEFORE it)
  // `prevSlotId` mirrors `nextSlotId` so a leading slot (bottom-anchored layout: slots
  // above a fixed footer) is reachable, symmetric with a trailing slot. No offer from
  // either side → outside every template. A block that joins a slot is a real slot
  // member: never fixed, never readOnly.
  const prevNeighbor = getNeighborData(position - 1, context);
  const nextNeighbor = getNeighborData(position, context);

  const slotOffer = (neighbor, fixedSlotField) => {
    if (!neighbor?.templateId) return null;
    // An 'empty' placeholder offers its OWN slot, fixed or not. A fixed block is
    // otherwise chrome — its slotId is its identity, not an invitation, which is
    // why fixed blocks only reach a neighbouring slot through next/prevSlotId.
    // A placeholder is the opposite: it exists to be filled, and its slot is the
    // slot being filled. Without this a forced region's seeded empty offered
    // nothing, so a block added or dropped beside it joined no template and the
    // author had nothing to lock.
    const isPlaceholder = neighbor['@type'] === 'empty';
    const slotId =
      (isPlaceholder || !neighbor.fixed) && neighbor.slotId
        ? neighbor.slotId
        : neighbor.fixed && neighbor[fixedSlotField]
          ? neighbor[fixedSlotField]
          : null;
    // A placeholder in a FORCED region has no slot of its own — the region IS
    // the template, so there is nothing to name. Offer the instance anyway and
    // let the caller mint a slot (it already prefers an existing slotId, then a
    // neighbour's, then a fresh one). Requiring a slot here is what left a block
    // dropped into an emptied announcement belonging to nothing.
    if (!slotId && !isPlaceholder) return null;
    return {
      templateId: neighbor.templateId,
      templateInstanceId: neighbor.templateInstanceId,
      slotId,
    };
  };

  // prev reaches forward via nextSlotId; next reaches backward via prevSlotId.
  const offer =
    slotOffer(prevNeighbor, 'nextSlotId') || slotOffer(nextNeighbor, 'prevSlotId');
  if (offer) {
    return {
      templateId: offer.templateId,
      templateInstanceId: offer.templateInstanceId,
      slotId: offer.slotId,
      fixed: false,
      readOnly: false,
    };
  }

  // No slot faces this position. If the CONTAINER itself is a template instance (e.g. a
  // columns block whose children are each their own fixed slot), a block added INSIDE it
  // still joins that template — with a FRESH slotId (left null; the caller generates one).
  // This is what separates "inside a template instance" (join) from the template's OUTER
  // edge (746: the container is the page, which has no templateId, so a drop before a
  // top/bottom fixed anchor correctly stays out).
  const container = context.parentBlock || allBlocks?.[containerId];
  if (container?.templateId) {
    return {
      templateId: container.templateId,
      templateInstanceId: container.templateInstanceId,
      slotId: null,
      fixed: false,
      readOnly: false,
    };
  }

  return undefined;
}

/**
 * Apply block defaults with extended context for dynamic defaults.
 * This is used when adding/moving blocks to pass position context
 * that schemaEnhancers and function defaults can use.
 *
 * Also handles template field inheritance: if adding a block inside
 * a template (adjacent to blocks with templateId), inherits
 * the template fields with a generated slotId.
 *
 * @param {Object} blockData - The new block's data (with @type)
 * @param {Object} context - Extended context for defaults
 * @param {string} context.containerId - Parent container ID ('page' or block ID)
 * @param {string} context.field - Container field name ('blocks_layout', 'items', etc.)
 * @param {number} context.position - Index where block is being inserted
 * @param {Object} context.allBlocks - All blocks in the form (formData.blocks)
 * @param {Object} context.blockPathMap - Block path map
 * @param {Object} context.blocksConfig - Blocks configuration
 * @param {Object} context.intl - Intl object
 * @returns {Object} - Block data with defaults applied
 */
export function applyBlockDefaultsWithContext(blockData, context) {
  const { blocksConfig, intl, allBlocks } = context;
  const blockType = blockData?.['@type'];
  if (!blockType || !blocksConfig) return blockData;

  const blockConfig = blocksConfig[blockType];

  // Get base schema
  let schema = null;
  if (blockConfig) {
    if (typeof blockConfig.blockSchema === 'function') {
      schema = blockConfig.blockSchema({ formData: blockData, intl });
    } else if (blockConfig.blockSchema) {
      schema = blockConfig.blockSchema;
    }
  }

  // Ensure schema with properties exists
  schema = schema
    ? { ...schema, properties: { ...schema.properties } }
    : { properties: {} };

  // Compute derived template fields based on neighbors using choices pattern
  // These are calculated fields - values are always determined by position
  const neighborTemplateInfo = getTemplateInfoFromNeighbors(context);
  if (neighborTemplateInfo) {
    // Inside a template - derive the template fields
    const derivedTemplateId = neighborTemplateInfo.templateId;
    const derivedInstanceId = neighborTemplateInfo.templateInstanceId;
    // Priority: keep existing slotId > inherit from neighbors > generate new
    const derivedSlotId = blockData.slotId || neighborTemplateInfo.slotId || generateSlotId(blockType, allBlocks);

    schema.properties.templateId = {
      choices: [derivedTemplateId],
      default: derivedTemplateId,
    };
    schema.properties.templateInstanceId = {
      choices: [derivedInstanceId],
      default: derivedInstanceId,
    };
    schema.properties.slotId = {
      choices: [derivedSlotId],
      default: derivedSlotId,
    };
    schema.properties.fixed = {
      default: neighborTemplateInfo.fixed,
    };
    schema.properties.readOnly = {
      default: neighborTemplateInfo.readOnly,
    };
  } else {
    // Outside a template - values should be undefined
    schema.properties.templateId = {
      choices: [undefined],
      default: undefined,
    };
    schema.properties.templateInstanceId = {
      choices: [undefined],
      default: undefined,
    };
    schema.properties.slotId = {
      choices: [undefined],
      default: undefined,
    };
  }

  // Apply block-specific schemaEnhancer with extended context
  if (blockConfig?.schemaEnhancer) {
    let enhancer = blockConfig.schemaEnhancer;
    if (typeof enhancer === 'function') {
      schema = enhancer({
        schema,
        formData: blockData,
        intl,
        // Extended context for dynamic values
        containerId: context.containerId,
        field: context.field,
        position: context.position,
        layoutItems: context.layoutItems,
        allBlocks: context.allBlocks,
        blockPathMap: context.blockPathMap,
      });
    }
  }

  // Apply defaults with context (supports function defaults)
  return applySchemaDefaultsToBlockWithContext(blockData, schema, context);
}

/**
 * Creates a schemaEnhancer that inherits fields from a referenced block type.
 *
 * Use this for blocks that reference another block type (e.g., listing → teaser).
 * The referenced type's schema fields are added to the parent's sidebar,
 * minus any fields that are mapped to external data.
 *
 * @param {string|null} typeField - Field name containing the block type, or null to read from
 *                                  blocksConfig[blockType].itemTypeField at call time
 * @param {string} mappingField - Field name containing field mappings (e.g., 'fieldMapping')
 *                                Can be null if no mapping is used
 * @param {string} defaultsField - Field name to store inherited values (e.g., 'itemDefaults')
 * @param {Object} typeFieldOptions - Options for the typeField (optional)
 * @param {string} typeFieldOptions.title - Title for the typeField (default: 'Item Type')
 * @param {string} typeFieldOptions.filterConvertibleFrom - Only show types with fieldMappings[this]
 * @param {string} typeFieldOptions.default - Default value for the typeField
 * @returns {Function} - A schemaEnhancer function
 *
 * @example
 * // In block config:
 * config.blocks.blocksConfig.listing = {
 *   itemTypeField: 'variation',
 *   schemaEnhancer: { inheritSchemaFrom: { mappingField: 'fieldMapping' } },
 * };
 */
export function inheritSchemaFrom(typeField, mappingField, defaultsField, typeFieldOptions = {}) {
  return (args) => {
    let { formData, schema, intl } = args;

    const blocksConfig =
      getHydraSchemaContext?.()?.blocksConfig || getInjectedBlocksConfig();

    // Read typeField from block-level config if not provided directly.
    // Uses the standard lookup (recipe → schema walk).
    if (!typeField) {
      typeField = findTypeField(blocksConfig[formData?.['@type']], intl);
      if (!typeField) return schema;
    }

    // Resolve blockPathMap/blockId from one of two sources, depending on
    // who is calling the enhancer. These are NOT a fallback chain — each
    // is the canonical source for its respective code path:
    //
    //   - args.blockId / args.blockPathMap: set by buildBlockPathMap pass 2,
    //     which runs the enhancer outside any React tree to populate
    //     pathMap._schemas with fully-enhanced schemas.
    //
    //   - hydraContext: set by HydraSchemaProvider in ParentBlocksWidget
    //     around the sidebar render. Volto core call sites (the variation
    //     HOC, applySchemaEnhancer in Form.jsx validation, etc.) don't pass
    //     blockId in args, so hydraContext is the only way to know which
    //     block is currently rendering.
    const hydraContext = getHydraSchemaContext();
    const blockPathMap = args.blockPathMap || hydraContext?.blockPathMap;
    const blockId = args.blockId ?? hydraContext?.currentBlockId;
    // For getLiveBlockData calls below: pass current pageFormData + pathMap
    // so a getBlockById lookup works when there is no React context (i.e.,
    // the buildBlockPathMap pass 2 path). The React-render path goes
    // through hydraContext.liveBlockDataRef inside getLiveBlockData itself.
    const liveFallback = { formData: args.pageFormData, blockPathMap };

    // Create or update typeField with computed choices
    const { filterConvertibleFrom, blocksField, title, default: defaultValue } = typeFieldOptions;
    if (filterConvertibleFrom || blocksField) {
      const choices = getBlockTypeChoices(
        { filterConvertibleFrom, blocksField },
        blocksConfig,
        blockPathMap,
        blockId,
        formData,  // Pass formData for blocksField lookup
        intl,
      );

      // Create or update the typeField
      schema = {
        ...schema,
        properties: {
          ...schema.properties,
          [typeField]: {
            ...(schema.properties?.[typeField] || {}),
            title: title || schema.properties?.[typeField]?.title || 'Item Type',
            choices,
            ...(defaultValue ? { default: defaultValue } : {}),
          },
        },
      };
    }

    // Use formData value, falling back to schema default for the typeField
    const referencedType = formData?.[typeField] ?? schema.properties?.[typeField]?.default;

    // Check if parent controls our type (parent has inheritSchemaFrom with typeField selected)
    // If so, hide our typeField and defaults fieldset since parent controls those

    let parentControlsType = false;
    if (blockPathMap && blockId) {
      const pathInfo = blockPathMap[blockId];
      if (pathInfo?.parentId) {
        // Use getLiveBlockData to get fresh parent data from form internal state
        const parentBlock = getLiveBlockData(pathInfo.parentId, liveFallback);
        if (parentBlock) {
          const parentConfig = blocksConfig?.[parentBlock['@type']];
          const parentTypeField = findTypeField(parentConfig, intl);
          // If parent has a typeField AND has selected a value, it controls our type
          if (parentTypeField && parentBlock[parentTypeField]) {
            parentControlsType = true;
          }
        }
      }
    }

    // If parent controls our type, hide typeField but still update fieldMapping
    // The parent's itemDefaults will control default values
    if (parentControlsType) {
      // Get the type from parent's selection (via getLiveBlockData)
      const pathInfo = blockPathMap[blockId];
      const parentBlock = getLiveBlockData(pathInfo.parentId, liveFallback);
      const parentConfig = blocksConfig?.[parentBlock?.['@type']];
      const parentTypeField = findTypeField(parentConfig, intl);
      const parentSelectedType = parentBlock?.[parentTypeField];

      // Use parent's selected type for computing fieldMapping
      const effectiveType = parentSelectedType || referencedType;
      const effectiveSchema = effectiveType ? getBlockTypeSchema(effectiveType, intl, blocksConfig) : null;

      // Clone schema and remove typeField
      let newSchema = {
        ...schema,
        fieldsets: schema.fieldsets?.map((fs) => ({
          ...fs,
          fields: fs.fields?.filter((f) => f !== typeField) || [],
        })).filter((fs) => fs.fields.length > 0 || fs.id === 'default'),
        properties: { ...schema.properties },
      };
      delete newSchema.properties[typeField];

      // Still need to update fieldMapping with valid target fields for the parent's type
      if (mappingField && newSchema.properties[mappingField]?.sourceFields && effectiveSchema?.properties) {
        const validTargetFields = Object.keys(effectiveSchema.properties);
        let effectiveMapping = formData?.[mappingField] || {};

        // Check if current mapping is empty or has invalid target fields
        const hasMapping = Object.keys(effectiveMapping).length > 0;
        const hasInvalidTargets = Object.values(effectiveMapping).some(
          (mapping) => {
            const target = getMappingTarget(mapping);
            return target && !new Set(validTargetFields).has(target);
          },
        );

        if (!hasMapping || hasInvalidTargets) {
          // Compute smart defaults for the parent's selected type
          // Use fieldMappings from child block's top-level config if available
          const childFieldMappings = blocksConfig[effectiveType]?.fieldMappings;
          effectiveMapping = computeSmartDefaults(
            newSchema.properties[mappingField].sourceFields,
            effectiveSchema,
            childFieldMappings,
          );
        }

        // Set propertyNames.enum (source fields) and additionalProperties.enum (target fields)
        const sourceFields = Object.keys(newSchema.properties[mappingField].sourceFields || {});
        newSchema = {
          ...newSchema,
          properties: {
            ...newSchema.properties,
            [mappingField]: {
              ...newSchema.properties[mappingField],
              default: effectiveMapping,
              targetType: effectiveType, // Ensure targetType is set
              propertyNames: {
                enum: sourceFields,
              },
              additionalProperties: {
                enum: validTargetFields,
              },
            },
          },
        };
      }

      return newSchema;
    }

    // If no referenced type selected, still ensure typeField is in a fieldset
    if (!referencedType) {
      // Check if typeField is already in a fieldset
      const typeFieldInFieldset = schema.fieldsets?.some(
        (fs) => fs.fields?.includes(typeField),
      );
      if (typeFieldInFieldset || !schema.properties?.[typeField]) {
        return schema;
      }
      // Add typeField to Default fieldset so it's visible
      const newSchema = {
        ...schema,
        fieldsets: schema.fieldsets?.map((fs) =>
          fs.id === 'default'
            ? { ...fs, fields: [typeField, ...(fs.fields || [])] }
            : fs,
        ) || [{ id: 'default', title: 'Default', fields: [typeField] }],
      };
      return newSchema;
    }
    const referencedSchema = getBlockTypeSchema(referencedType, intl, blocksConfig);
    if (!referencedSchema?.properties) return schema;

    // Compute smart defaults for fieldMapping based on current target type
    // We set this as the schema default so the form applies it when value is empty/invalid
    let effectiveMapping = formData?.[mappingField] || {};
    if (mappingField && schema.properties[mappingField]?.sourceFields) {
      const validTargetFields = Object.keys(referencedSchema.properties);

      // Check if current mapping is empty or has invalid target fields
      const hasMapping = Object.keys(effectiveMapping).length > 0;
      const hasInvalidTargets = Object.values(effectiveMapping).some(
        (targetField) => targetField && !new Set(validTargetFields).has(targetField),
      );

      if (!hasMapping || hasInvalidTargets) {
        // Compute smart defaults for this target type
        // Use fieldMappings from child block's top-level config if available
        const childFieldMappings = blocksConfig[referencedType]?.fieldMappings;
        effectiveMapping = computeSmartDefaults(
          schema.properties[mappingField].sourceFields,
          referencedSchema,
          childFieldMappings,
        );
      }

      // Set propertyNames.enum (source fields) and additionalProperties.enum (target fields)
      // This enables isValidValue to detect when mapping becomes invalid
      const sourceFields = Object.keys(schema.properties[mappingField].sourceFields || {});
      schema = {
        ...schema,
        properties: {
          ...schema.properties,
          [mappingField]: {
            ...schema.properties[mappingField],
            default: effectiveMapping,
            propertyNames: {
              enum: sourceFields,
            },
            additionalProperties: {
              enum: validTargetFields,
            },
          },
        },
      };
    }

    // Get mapped fields (these won't be shown - they come from external data)
    // Use effectiveMapping which includes smart defaults if computed
    const mappedFields = new Set(
      mappingField ? Object.values(effectiveMapping).map(getMappingTarget) : [],
    );

    // Use the same parent/child split that hideParentOwnedFields uses.
    // Parent's "Item Defaults" fieldset = parent-claimed fields, MINUS the
    // mapped ones (mapped values come from queried data, not defaults).
    const childConfig = blocksConfig[referencedType];
    const claimCtx = {
      mappedFields,
      parentControlled: typeFieldOptions?.parentControlled?.[referencedType],
      childOwnFields: resolveChildOwnFields(childConfig),
    };

    const inheritedFields = Object.entries(referencedSchema.properties)
      .filter(([fieldName]) => {
        if (fieldName === typeField) return false;
        if (mappedFields.has(fieldName)) return false;
        return isFieldParentClaimed(fieldName, claimCtx);
      })
      .map(([fieldName, fieldDef]) => ({
        name: `${defaultsField}_${fieldName}`,
        def: { ...fieldDef, title: fieldDef.title || fieldName },
      }));

    // Check if typeField needs to be added to a fieldset
    const typeFieldHasChoices = schema.properties[typeField]?.choices?.length > 0;
    const typeFieldInFieldset = schema.fieldsets?.some(
      (fs) => fs.fields?.includes(typeField),
    );

    // Add fieldset for inherited fields if there are any
    if (inheritedFields.length > 0) {
      const referencedTitle =
        blocksConfig[referencedType]?.title || referencedType;

      // Clone schema to avoid mutations
      const newSchema = {
        ...schema,
        fieldsets: [...schema.fieldsets],
        properties: { ...schema.properties },
      };

      // Add fieldset for inherited fields (includes typeField at the start)
      const inheritedFieldsetFields = inheritedFields.map((f) => f.name);
      if (schema.properties[typeField] && !typeFieldInFieldset) {
        inheritedFieldsetFields.unshift(typeField);
      }
      // Idempotent: this enhancer can run more than once on the same schema
      // (pathmap build + sidebar render). Replace an existing inherited fieldset
      // rather than pushing a duplicate — otherwise the parent's "… Defaults"
      // fieldset (and every field in it) renders twice in the sidebar.
      const inheritedFieldset = {
        id: 'inherited_fields',
        title: `${referencedTitle} Defaults`,
        fields: inheritedFieldsetFields,
      };
      const existingIdx = newSchema.fieldsets.findIndex(
        (fs) => fs.id === 'inherited_fields',
      );
      if (existingIdx >= 0) {
        newSchema.fieldsets[existingIdx] = inheritedFieldset;
      } else {
        newSchema.fieldsets.push(inheritedFieldset);
      }

      // Add field definitions
      for (const { name, def } of inheritedFields) {
        newSchema.properties[name] = def;
      }

      return newSchema;
    }

    // Even without inherited fields, ensure typeField is visible if it has choices
    if (typeFieldHasChoices && !typeFieldInFieldset) {
      const referencedTitle =
        blocksConfig[referencedType]?.title || referencedType;

      // Idempotent (see above): don't add a second inherited fieldset.
      if (schema.fieldsets?.some((fs) => fs.id === 'inherited_fields')) {
        return schema;
      }
      return {
        ...schema,
        fieldsets: [
          ...(schema.fieldsets || []),
          {
            id: 'inherited_fields',
            title: `${referencedTitle} Defaults`,
            fields: [typeField],
          },
        ],
      };
    }

    return schema;
  };
}

/**
 * Creates a schemaEnhancer that hides fields claimed by the parent container.
 *
 * Auto-applied to every block by `installChildBlockEnhancers()` at INIT —
 * blocks don't need to declare it. The enhancer is a no-op unless the block
 * is rendered as a child of a parent that uses schema inheritance (parent
 * has a typeField with a selected value).
 *
 * What gets hidden:
 *   1. Fields the parent's runtime `fieldMapping` widget targets — i.e.
 *      whatever the user has explicitly mapped via `mappingField`.
 *   2. Fields listed in the parent's `parentControlled[childType]` config —
 *      additional fields the parent always claims for child blocks of a
 *      given type (e.g. styling fields, alignment) that aren't typed-mapped.
 *
 * The parent declares both via its `inheritSchemaFrom` recipe:
 *
 *     schemaEnhancer: {
 *       inheritSchemaFrom: {
 *         mappingField: 'fieldMapping',
 *         parentControlled: { teaser: ['styles'], image: ['caption'] },
 *       },
 *     }
 *
 * @returns {Function} - A schemaEnhancer function
 */
export function hideParentOwnedFields() {

  return (args) => {
    const { schema, intl, blockPathMap: passedBlockPathMap, blockId: passedBlockId } = args;

    // blockPathMap/blockId come from one of two sources, both first-class:
    //
    //   - args.blockId / args.blockPathMap: set by buildBlockPathMap pass 2
    //     (no React context).
    //
    //   - hydraContext: set by HydraSchemaProvider around the sidebar
    //     render. Volto's applySchemaEnhancer / variation HOC invoke block
    //     enhancers without blockId in args, so hydraContext is how the
    //     enhancer learns which specific instance is being edited.
    const hydraContext = getHydraSchemaContext();
    const blockPathMap = passedBlockPathMap || hydraContext?.blockPathMap;
    const blockId = passedBlockId ?? hydraContext?.currentBlockId;
    const blocksConfig = hydraContext?.blocksConfig || getInjectedBlocksConfig();
    // For getLiveBlockData below: pageFormData + pathMap let getBlockById
    // resolve siblings/parents during buildBlockPathMap pass 2 (no React).
    const liveFallback = { formData: args.pageFormData, blockPathMap };

    if (!blockPathMap || !blockId) return schema;

    const pathInfo = blockPathMap?.[blockId];
    // Skip field hiding for top-level blocks (no parent or page is parent)
    if (!pathInfo?.parentId || pathInfo.parentId === PAGE_BLOCK_UID) return schema;

    // Only filter fields if parent uses schema inheritance (has typeField configured)
    // AND has a type selected. Otherwise children keep all their fields.
    if (blocksConfig) {
      const parentBlock = getLiveBlockData(pathInfo.parentId, liveFallback);
      if (parentBlock) {
        const parentConfig = blocksConfig[parentBlock['@type']];
        const typeField = findTypeField(parentConfig, intl);
        // If parent doesn't use schema inheritance (no typeField), or no type selected,
        // don't filter child fields - they're independent blocks
        if (!typeField || !parentBlock[typeField]) {
          return schema;
        }
      }
    }

    // Hide every field the parent claims (single source of truth via
    // isFieldParentClaimed; same rule used by inheritSchemaFrom when it
    // computes the parent's "Item Defaults" fieldset).
    const childBlock = getLiveBlockData(blockId, liveFallback);
    const childType = childBlock?.['@type'];
    const childBlockConfig = childType ? blocksConfig?.[childType] : null;
    const parentBlock = getLiveBlockData(pathInfo.parentId, liveFallback);
    const parentConfig = parentBlock ? blocksConfig?.[parentBlock['@type']] : null;

    const claimCtx = {
      mappedFields: _runtimeMappingTargets(parentConfig, parentBlock),
      parentControlled:
        parentConfig?.schemaEnhancer?.config?.parentControlled?.[childType],
      childOwnFields: resolveChildOwnFields(childBlockConfig),
    };

    const fieldsToHide = new Set();
    for (const fieldName of Object.keys(schema.properties || {})) {
      if (isFieldParentClaimed(fieldName, claimCtx)) {
        fieldsToHide.add(fieldName);
      }
    }

    if (fieldsToHide.size === 0) return schema;

    // Clone schema to avoid mutations
    const newSchema = {
      ...schema,
      fieldsets: schema.fieldsets
        .map((fieldset) => ({
          ...fieldset,
          fields: fieldset.fields.filter((f) => !fieldsToHide.has(f)),
        }))
        // Remove empty fieldsets (except 'default' which should always exist)
        .filter((fieldset) => fieldset.fields.length > 0 || fieldset.id === 'default'),
      properties: { ...schema.properties },
    };

    // Remove from properties
    for (const fieldName of fieldsToHide) {
      delete newSchema.properties[fieldName];
    }

    return newSchema;
  };
}

/**
 * Query result fields available for mapping in listing blocks.
 * These are the standard fields returned by @querystring-search.
 */
export const QUERY_RESULT_FIELDS = {
  '@id': { title: 'URL', type: 'string' },
  title: { title: 'Title', type: 'string' },
  description: { title: 'Description', type: 'string' },
  image: { title: 'Lead Image', type: 'image' },
  created: { title: 'Created', type: 'date' },
  effective: { title: 'Published', type: 'date' },
  Creator: { title: 'Author', type: 'string' },
  review_state: { title: 'State', type: 'string' },
  // The keyword index behind tags/topics — a LIST, so `array`: the `string`
  // conversion joins ['a','b'] into "a, b", and a renderer that draws one pill
  // per category then draws none. Without this entry the widget offered no way
  // to map categories at all, so a block whose recipe declared the mapping had
  // one nobody could change, and every other block had none.
  Subject: { title: 'Categories', type: 'array' },
};

/**
 * Compute smart default field mappings based on field types.
 *
 * If declaredMappings is provided (from block's top-level fieldMappings config),
 * those are used as the base. Otherwise, smart defaults are computed by matching
 * source field types to target field types:
 * - title → first link field (href/target for navigation)
 * - description → first textarea field
 * - image → first image field (object_browser with mode='image')
 * - @id → first link field (object_browser with mode='link')
 *
 * @param {Object} sourceFields - Source field definitions (e.g., QUERY_RESULT_FIELDS)
 * @param {Object} targetSchema - Target block schema with properties
 * @param {Object} declaredMappings - Optional declared mappings from block's fieldMappings config
 * @returns {Object} - Field mapping { sourceField: targetField | { field, type }, ... }
 */

/**
 * Determine the hydra type of a field from its schema definition.
 * Returns 'link', 'image', or the JSON Schema type (string, number, etc.)
 */
export function getFieldType(fieldDef) {
  if (!fieldDef) return 'string';
  if (fieldDef.widget === 'object_browser' && fieldDef.mode === 'link') return 'link';
  if (fieldDef.widget === 'url') return 'link';
  if (fieldDef.widget === 'object_browser' && fieldDef.mode === 'image') return 'image';
  if (fieldDef.widget === 'image') return 'image';
  return fieldDef.type || 'string';
}

/**
 * Extract the target field name from a fieldMapping value.
 * Handles both legacy string format and new { field, type } format.
 */
export function getMappingTarget(mapping) {
  return typeof mapping === 'string' ? mapping : mapping?.field;
}

/**
 * Get the set of target field names from a block config's fieldMappings['@default'].
 * These are the fields the child block uses to receive mapped data (i.e., child-editable fields).
 * Returns a Set of field names, or null if no @default mapping exists.
 */
export function getDefaultMappingTargets(blockConfig) {
  const defaultMapping = blockConfig?.fieldMappings?.['@default'];
  if (!defaultMapping || Object.keys(defaultMapping).length === 0) return null;
  return new Set(Object.values(defaultMapping).map(getMappingTarget).filter(Boolean));
}

/**
 * Set of field names targeted by a parent block's runtime `fieldMapping`
 * widget value. These are the fields parent has explicitly mapped to
 * source data — claimed regardless of any other rules.
 *
 * @param {Object} parentConfig  blocksConfig entry for the parent block type
 * @param {Object} parentBlockData  the parent block's runtime data (for
 *   reading the mappingField value)
 * @returns {Set<string>}
 * @private
 */
function _runtimeMappingTargets(parentConfig, parentBlockData) {
  const targets = new Set();
  const mappingField = parentConfig?.schemaEnhancer?.config?.mappingField;
  const fieldMapping = mappingField ? parentBlockData?.[mappingField] : null;
  if (!fieldMapping) return targets;
  for (const mapping of Object.values(fieldMapping)) {
    const target = getMappingTarget(mapping);
    if (target) targets.add(target);
  }
  return targets;
}

/**
 * Resolve which fields belong to the child block (child-editable). Used
 * by inheritSchemaFrom to skip child-owned fields when computing the
 * parent's defaults fieldset. Returns the targets of the child type's
 * fieldMappings['@default'], or null if none declared.
 *
 * @returns {Set<string>|null}
 */
export function resolveChildOwnFields(childBlockConfig) {
  return getDefaultMappingTargets(childBlockConfig);
}

// Target types whose value must be CONVERTED, not copied: a mapping onto one of
// these keeps its `{ field, type }` form so expandListingBlocks converts. Plain
// strings and numbers are copied as they are, and stay in the short form.
const CONVERTED_TARGET_TYPES = new Set(['link', 'image', 'image_link', 'array']);

/**
 * Single source of truth for the parent/child split.
 *
 * Given a parent and child config + the runtime context, decide whether a
 * given field on the child is "parent-claimed" (i.e., parent owns it; hide
 * on child sidebar; include in parent's itemDefaults / fieldMapping).
 *
 * Used by:
 *   - hideParentOwnedFields: per-field, decides what to hide on the child.
 *   - inheritSchemaFrom: per-field on the referenced child schema, decides
 *     what goes into the parent's "Item Defaults" fieldset.
 *
 * Rules (in order):
 *   1. If field is in parent's runtime fieldMapping targets → claimed
 *      (parent's mappingField widget already drives the value from data).
 *   2. If parent declares an explicit `parentControlled[childType]` list →
 *      claimed iff in that list.
 *   3. Else (no override): claimed iff NOT in child's
 *      `fieldMappings['@default']` targets. Default split is "child owns
 *      what its @default declares; parent owns the rest."
 *   4. If child has no `fieldMappings['@default']` and no parent override →
 *      nothing is claimed (block isn't opted into the inheritance system).
 *
 * @param {string} fieldName
 * @param {Object} ctx
 * @param {Set<string>} [ctx.mappedFields]    Targets of parent.fieldMapping
 * @param {string[]}    [ctx.parentControlled] Parent's explicit per-childType list
 * @param {Set<string>} [ctx.childOwnFields]   Child's fieldMappings['@default'] targets
 * @returns {boolean}
 */
export function isFieldParentClaimed(
  fieldName,
  { mappedFields, parentControlled, childOwnFields } = {},
) {
  if (mappedFields?.has(fieldName)) return true;
  if (Array.isArray(parentControlled)) return parentControlled.includes(fieldName);
  if (childOwnFields && childOwnFields.size > 0) return !childOwnFields.has(fieldName);
  return false;
}

export function computeSmartDefaults(sourceFields, targetSchema, declaredMappings) {
  if (!targetSchema?.properties) return {};

  // If declared mappings are provided, use them (merge @default + any source-specific)
  if (declaredMappings?.['@default'] || declaredMappings) {
    // If declaredMappings has a '@default' key, it's the full fieldMappings object
    // Otherwise it's just the default mapping directly
    const mappings = declaredMappings['@default'] || declaredMappings;
    // Only return mappings where the target field exists in the target schema
    // Normalize to { field, type } format with type from target schema
    const validMappings = {};
    for (const [sourceField, mapping] of Object.entries(mappings)) {
      const targetField = typeof mapping === 'string' ? mapping : mapping?.field;
      if (targetField && targetSchema.properties[targetField]) {
        const fieldType = getFieldType(targetSchema.properties[targetField]);
        const declaredType =
          typeof mapping === 'object' ? mapping?.type : undefined;
        // Keep the object format wherever the value needs CONVERTING on its way
        // to the target: a link array, an image object, or a LIST. `array`
        // belongs here — a keyword index that returns a single value has to be
        // carried as a one-item list, or a renderer drawing one pill per entry
        // draws none. A declared type is never discarded: a recipe that asked
        // for a conversion meant it.
        const type =
          declaredType ||
          (CONVERTED_TARGET_TYPES.has(fieldType) ? fieldType : undefined);
        validMappings[sourceField] = type
          ? { field: targetField, type }
          : targetField;
      }
    }
    return validMappings;
  }

  const mapping = {};
  const targetProps = targetSchema.properties;

  // Find first field of each type in target schema
  let firstLinkField = null;
  let firstImageField = null;
  let firstTextareaField = null;
  let firstStringField = null;

  for (const [fieldName, fieldDef] of Object.entries(targetProps)) {
    // Link field: object_browser with mode='link' or allowExternals
    if (
      !firstLinkField &&
      fieldDef.widget === 'object_browser' &&
      fieldDef.mode === 'link'
    ) {
      firstLinkField = fieldName;
    }

    // Image field: object_browser with mode='image' or widget='image'
    if (
      !firstImageField &&
      ((fieldDef.widget === 'object_browser' && fieldDef.mode === 'image') ||
        fieldDef.widget === 'image')
    ) {
      firstImageField = fieldName;
    }

    // Textarea field
    if (!firstTextareaField && fieldDef.widget === 'textarea') {
      firstTextareaField = fieldName;
    }

    // String field (no widget or basic string type)
    if (
      !firstStringField &&
      !fieldDef.widget &&
      fieldDef.type !== 'boolean' &&
      fieldDef.type !== 'integer'
    ) {
      firstStringField = fieldName;
    }
  }

  // Track which target fields have been used (no duplicates)
  const usedTargets = new Set();

  // Map source fields to best matching target fields by type
  // @id (URL) → link field (with type: 'link' for conversion)
  if (sourceFields['@id'] && firstLinkField && !usedTargets.has(firstLinkField)) {
    mapping['@id'] = { field: firstLinkField, type: 'link' };
    usedTargets.add(firstLinkField);
  }

  // title → first string field (not link, not textarea)
  if (sourceFields.title && firstStringField && !usedTargets.has(firstStringField)) {
    mapping.title = firstStringField;
    usedTargets.add(firstStringField);
  }

  // description → textarea field
  if (sourceFields.description && firstTextareaField && !usedTargets.has(firstTextareaField)) {
    mapping.description = firstTextareaField;
    usedTargets.add(firstTextareaField);
  }

  // image → image field (with type: 'image' for conversion)
  if (sourceFields.image && firstImageField && !usedTargets.has(firstImageField)) {
    mapping.image = { field: firstImageField, type: 'image' };
    usedTargets.add(firstImageField);
  }

  return mapping;
}


/**
 * Apply schema defaults to all blocks in formData.
 *
 * Iterates over all blocks and applies schema defaults (including those
 * computed by schemaEnhancers like inheritSchemaFrom).
 *
 * @param {Object} formData - The full form data with blocks
 * @param {Object} blocksConfig - Block configuration from config.blocks.blocksConfig
 * @param {Object} intl - React Intl object for translations
 * @returns {Object} - FormData with defaults applied to blocks (or original if no changes)
 */
/**
 * Resolve a block's EFFECTIVE schema — the base schema with its schemaEnhancer
 * applied (fieldRules visibility, hideParentOwnedFields, inheritSchemaFrom). This
 * is the schema the editor actually renders and validates against, so its
 * `required` is the DYNAMIC required set: a field hidden by a `when` rule (a
 * card's `image`, shown only when the grid enables it) is dropped from `required`.
 *
 * Recipe-object enhancers ARE converted here (via createSchemaEnhancerFromRecipe),
 * unlike buildBlockPathMap's pass which skips them — so callers get the fully
 * resolved schema for recipe-based blocks too. Enhancers that compose
 * `hideParentOwnedFields` must already be installed (installChildBlockEnhancers).
 *
 * Extracted from applySchemaDefaultsToFormData (its per-block resolution) so
 * block-sanity's offline required check can reuse the exact same resolution.
 *
 * @returns {Object|null} the enhanced schema, or null if the block has no schema.
 */
export function resolveEffectiveBlockSchema(blockId, formData, blockPathMap, blocksConfig, intl) {
  const blockData = getBlockById(formData, blockPathMap, blockId);
  if (!blockData) return null;

  // Use blockPathMap for type lookup (single source of truth).
  // Don't use blockData['@type'] as object_list items don't store @type.
  const blockType = blockPathMap?.[blockId]?.blockType;
  if (!blockType) return null;

  const blockConfig = blocksConfig?.[blockType];

  // Base schema + enhancer come from the registered block config OR — for a
  // non-typed object_list item (virtual blockType, no blocksConfig entry) — from
  // the inline `itemSchema` the pathMap recorded. This resolves an inline
  // object_list item's schema (e.g. a table cell's fieldRules) WITHOUT registering
  // virtual types into the shared blocksConfig, which would pollute block
  // discovery and the chooser.
  const itemSchema = blockPathMap?.[blockId]?.itemSchema;
  if (!blockConfig && !itemSchema) return null;

  // Get base schema + its enhancer from whichever source applies.
  let schema = null;
  let enhancer = null;
  if (blockConfig) {
    if (typeof blockConfig.blockSchema === 'function') {
      schema = blockConfig.blockSchema({ formData: blockData, intl });
    } else if (blockConfig.blockSchema) {
      schema = blockConfig.blockSchema;
    } else if (typeof blockConfig.schema === 'function') {
      schema = blockConfig.schema({ formData: blockData, intl });
    } else if (blockConfig.schema) {
      schema = blockConfig.schema;
    }
    enhancer = blockConfig.schemaEnhancer;
  } else {
    schema = itemSchema;
    enhancer = itemSchema.schemaEnhancer;
  }

  if (!schema) return null;

  // Apply schemaEnhancer if present (fieldRules/hideParentOwnedFields/inheritSchemaFrom).
  if (enhancer) {
    // schemaEnhancer can be a function or a recipe object
    if (typeof enhancer !== 'function') {
      // It's a recipe object - create enhancer from it
      enhancer = createSchemaEnhancerFromRecipe(enhancer);
    }
    if (enhancer) {
      // Set context so schemaEnhancer can access currentBlockId and blockPathMap
      // (Volto HOC call sites that pass only {schema,formData,intl}); also pass
      // them in args (the buildBlockPathMap contract) so `../` lookups resolve
      // even without an active context.
      const restoreContext = setHydraSchemaContext({
        blockPathMap,
        currentBlockId: blockId,
        blocksConfig,
        formData,
      });
      try {
        schema = enhancer({
          formData: blockData,
          schema: { ...schema, properties: { ...schema.properties } },
          intl,
          pageFormData: formData,
          blockId,
          blockPathMap,
        });
      } finally {
        restoreContext();
      }
    }
  }

  return schema;
}

/**
 * Every slate node the page's regions disallow, and what it would become (#295).
 *
 * The same walk `applySchemaDefaultsToFormData` does, but reporting instead of
 * writing — so the migration normalize-on-load performs is visible rather than
 * arriving as a surprise diff on someone's next save. Called from the editor to
 * warn, and available to an offline gate (this module loads in bare Node via
 * the injected config accessors).
 *
 * @param {Object} formData
 * @param {Object} blockPathMap
 * @param {Object} blocksConfig
 * @param {Object} intl
 * @returns {Array<{blockId, field, path, from, to, kind, configError?}>} empty when clean
 */
export function reportDisallowedSlateNodes(formData, blockPathMap, blocksConfig, intl) {
  const report = [];
  if (!blockPathMap) return report;
  const globals = getSlateStyleGlobals();
  const vocabulary = getSlateVocabulary();
  for (const blockId of Object.keys(blockPathMap)) {
    const rules = blockPathMap[blockId]?.slateRules;
    if (!rules) continue;
    const blockData = getBlockById(formData, blockPathMap, blockId);
    if (!blockData) continue;
    const schema = resolveEffectiveBlockSchema(
      blockId,
      formData,
      blockPathMap,
      blocksConfig,
      intl,
    );
    if (!schema) continue;
    const { changes } = normalizeSlateFields(blockData, schema, rules, globals);
    for (const change of changes) report.push({ blockId, ...change });

    // Types nothing renders. Judged against the LIVE registry when the addon has
    // injected it — inside the editor it always has.
    for (const [field, def] of Object.entries(schema.properties || {})) {
      if (def?.widget !== 'slate' && def?.widget !== 'slate_richtext') continue;
      for (const u of undefinedSlateTypes(blockData[field], rules, vocabulary)) {
        report.push({ blockId, field, path: u.path, from: u.type, to: null, kind: 'undefined-type' });
      }
    }
  }
  return report;
}

export function applySchemaDefaultsToFormData(formData, blockPathMap, blocksConfig, intl) {
  if (!blockPathMap) return formData;

  let result = formData;

  // Iterate over ALL blocks via blockPathMap (includes nested blocks)
  for (const blockId of Object.keys(blockPathMap)) {
    const blockData = getBlockById(result, blockPathMap, blockId);
    if (!blockData) continue;

    const schema = resolveEffectiveBlockSchema(
      blockId,
      result,
      blockPathMap,
      blocksConfig,
      intl,
    );
    if (!schema) continue;

    // Apply defaults from enhanced schema
    const updatedBlock = applySchemaDefaultsToBlock(blockData, schema);
    if (updatedBlock !== blockData) {
      result = updateBlockById(result, blockPathMap, blockId, updatedBlock);
    }

    // Downgrade slate nodes the block's REGION disallows (#295). Done here, in
    // the pass every mutation already runs, so each INITIAL_DATA / FORM_DATA
    // path gets it without its own call — and existing content migrates by
    // being opened rather than by a separate script.
    const slateRules = blockPathMap[blockId]?.slateRules;
    if (slateRules) {
      const current = getBlockById(result, blockPathMap, blockId);
      const { block: normalized } = normalizeSlateFields(
        current,
        schema,
        slateRules,
        getSlateStyleGlobals(),
      );
      if (normalized !== current) {
        result = updateBlockById(result, blockPathMap, blockId, normalized);
      }
    }

    // `@type` RULE — a position-driven type. When a typed object_list item carries
    // a `typeRule` (a `when`-based fieldRule whose `set` is a block-TYPE name),
    // re-resolve the type the item SHOULD have at its current position and, if it
    // differs from the stored `@type`, convert the item in place. This is the same
    // "run the rules, see what changed, write it back" pass that applies defaults —
    // no separate resolver, no editor plumbing. It's how a table cell flips between
    // `tableHeaderCell` (a slate value) and `tableCell` (a blocks container) when
    // its row moves to/from a header position. Deterministic by position, so it
    // settles (the target type re-resolves to itself next pass — no oscillation).
    const typeRule = blockPathMap[blockId]?.typeRule;
    if (typeRule) {
      const current = getBlockById(result, blockPathMap, blockId);
      const currentType = current?.['@type'] || blockPathMap[blockId]?.blockType;
      const targetType = evaluateFieldRule(typeRule, current, {
        blockId,
        blockPathMap,
        pageFormData: result,
      });
      if (typeof targetType === 'string' && targetType !== currentType) {
        const converted = convertValueContainer(
          current,
          currentType,
          targetType,
          blocksConfig,
          intl,
        );
        // null → no bridge for this pair; leave the item as-is (fail visibly by
        // simply not converting rather than corrupting it).
        if (converted) {
          result = updateBlockById(result, blockPathMap, blockId, converted);
        }
      }
    }
  }

  return result;
}

/**
 * TRIAL a would-be state (a candidate drop/paste result) and report every block
 * whose `@type` the rules would CHANGE — so the caller can ask before committing.
 *
 * This is the generic "sandbox the drop, see what converts" detector: it runs the
 * SAME normalization pass that commits use (`applySchemaDefaultsToFormData`, which
 * applies defaults AND `@type` rules via the container⇄value bridge) against a
 * candidate formData, then diffs each block's `@type` before vs after. A type
 * changes for ANY reason a rule fires — position (`typeRule`), a field condition,
 * anything — not just tables. The caller (DnD/paste) trials the post-move formData,
 * and if `conversions` is non-empty, confirms with the user, then commits the
 * returned `formData` (already converted); an empty list commits silently.
 *
 * Blocks REMOVED by a conversion (e.g. a container's children collapsed into a
 * value) are not "type changes" and are not reported — only surviving blocks whose
 * `@type` differs. `blockPathMap` is the candidate's map; `getBlockById` is
 * path-based, so it still resolves a converted block (same position, new `@type`).
 *
 * @returns {{ formData: object, conversions: Array<{blockId, from, to}> }}
 */
export function previewSchemaDefaultConversions(formData, blockPathMap, blocksConfig, intl) {
  const before = {};
  if (blockPathMap) {
    for (const blockId of Object.keys(blockPathMap)) {
      const b = getBlockById(formData, blockPathMap, blockId);
      if (b) before[blockId] = b['@type'];
    }
  }
  const normalized = applySchemaDefaultsToFormData(formData, blockPathMap, blocksConfig, intl);
  const conversions = [];
  for (const blockId of Object.keys(before)) {
    const b = getBlockById(normalized, blockPathMap, blockId);
    if (b && b['@type'] !== before[blockId]) {
      conversions.push({ blockId, from: before[blockId], to: b['@type'] });
    }
  }
  return { formData: normalized, conversions };
}

/**
 * Filter a container's `allowedBlocks` down to the types that are actually ADDABLE
 * at a given position, when a position `@type` rule (typeRule) governs the region.
 *
 * For each allowed type, TRIAL it: probe-insert a minimal item of that type after
 * `refBlockId`, run the schema-default pass (which applies the typeRule), and keep
 * the type only if the rule did NOT change it. A type the rule immediately rewrites
 * (e.g. `tableCell` dropped where the position forces `tableHeaderCell`) is not a
 * real choice at that spot, so it's dropped from the menu — a typeRule-driven
 * container thus offers only the rule-consistent type(s). Usually one survives, so
 * the caller's "single allowed type → add directly (no chooser)" path fires.
 *
 * Returns the filtered list (never empty — falls back to the input if the trial
 * would drop everything, so a mis-authored rule can't strand the add). A container
 * with ≤1 allowed type, or one whose items are all left unchanged, is returned as-is.
 */
export function filterAddableTypesByRule(
  allowedBlocks,
  formData,
  blockPathMap,
  refBlockId,
  containerConfig,
  blocksConfig,
  intl,
) {
  if (!Array.isArray(allowedBlocks) || allowedBlocks.length <= 1) return allowedBlocks;
  // No position `@type` rule governs this region → nothing can re-type the new
  // item, so every allowed type is addable as-is. Skip the per-type sandbox
  // entirely (the common case — only a typeRule container needs filtering). The
  // region's `typeRule` is carried onto each typed item's pathMap entry, so the
  // ref sibling carries it when the region has one.
  if (!blockPathMap?.[refBlockId]?.typeRule) return allowedBlocks;
  const idField = containerConfig?.idField || '@id';
  const filtered = allowedBlocks.filter((type) => {
    const probeId = `__probe_${type}__`;
    let sandbox;
    try {
      sandbox = insertBlockInContainer(
        formData,
        blockPathMap,
        refBlockId,
        probeId,
        { '@type': type, [idField]: probeId },
        containerConfig,
        'after',
      );
    } catch {
      return true; // couldn't probe this type → don't drop it
    }
    const map = buildBlockPathMap(sandbox, blocksConfig, intl);
    const normalized = applySchemaDefaultsToFormData(sandbox, map, blocksConfig, intl);
    const after = getBlockById(normalized, map, probeId);
    // Keep only if the position rule left this type unchanged (addable as-is).
    return !after || after['@type'] === type;
  });
  return filtered.length ? filtered : allowedBlocks;
}

/**
 * Create a schemaEnhancer function from a declarative recipe.
 *
 * New format (supports combining multiple enhancers):
 *   { inheritSchemaFrom: { typeField, defaultsField, mappingField?, parentControlled?, filterConvertibleFrom?, blocksField?, title?, default? } }
 *   { fieldRules: { fieldName: false | { set, when?, else? } | [rule, ...] } }
 *
 * Combined example:
 *   {
 *     inheritSchemaFrom: { typeField: 'variation', defaultsField: 'itemDefaults', filterConvertibleFrom: '@default' },
 *     fieldRules: { advancedOptions: { when: { mode: 'advanced' }, else: false } },
 *   }
 *
 * Legacy format (still supported):
 *   { type: 'inheritSchemaFrom', config: { ... } }
 *
 * The returned function has a `config` property attached with the original config,
 * so parent blocks can read the recipe's inheritSchemaFrom options (e.g.
 * parentControlled) when computing which fields they claim from children.
 *
 * @param {Object|Array} recipe - Recipe object or array of recipes
 * @returns {Function|null} - schemaEnhancer function or null if invalid
 */
/**
 * @param {Object} recipe - Declarative recipe from frontend
 * @param {Function} [existingEnhancer] - Admin-side enhancer already registered for this block.
 *   If its .config.enhancerType matches a recipe type (e.g., both are 'inheritSchemaFrom'),
 *   that recipe type is skipped (the admin enhancer already calls it internally).
 *   The existing enhancer's .config is updated with the frontend's values (frontend wins).
 */
export function createSchemaEnhancerFromRecipe(recipe, existingEnhancer) {
  // Plain functions pass through (used in arrays like [existingEnhancer, { recipe }])
  if (typeof recipe === 'function') return recipe;
  if (!recipe || typeof recipe !== 'object') return existingEnhancer || null;

  // Handle array of recipes/functions - compose them
  if (Array.isArray(recipe)) {
    const parts = recipe.map((r) => createSchemaEnhancerFromRecipe(r)).filter(Boolean);
    if (parts.length === 0) return existingEnhancer || null;
    if (parts.length === 1) {
      parts[0]._parts = parts;
      return parts[0];
    }
    const composedFn = (args) =>
      parts.reduce((schema, fn) => fn({ ...args, schema }), args.schema);
    composedFn.config = parts.reduce((acc, fn) => ({ ...acc, ...fn.config }), {});
    composedFn._parts = parts;
    return composedFn;
  }

  // Legacy format: { type: 'x', config: {...} }
  if (recipe.type && recipe.config) {
    return createSingleEnhancerLegacy(recipe);
  }

  // Recognised recipe keys. Only these are converted to enhancer functions;
  // any other key on the recipe object is ignored (and, if it's the ONLY key,
  // the block is left with a raw object as its schemaEnhancer, which Volto then
  // crashes on with "schemaEnhancer is not a function"). NOTE: `childBlockConfig`
  // is NOT a recipe key — it was removed in the #213 schema-inheritance redesign.
  // Container children no longer declare per-child field ownership; instead
  // `installChildBlockEnhancers` auto-applies `hideParentOwnedFields` to every
  // block, and the parent claims fields via `inheritSchemaFrom.parentControlled`.
  const enhancerTypes = ['inheritSchemaFrom', 'fieldRules'];

  // If the existing enhancer has _parts, check each part for type overlap.
  // When the frontend sends a recipe matching an existing part's type,
  // replace that part with the frontend's version (frontend wins).
  const existingParts = existingEnhancer?._parts;

  const enhancers = [];
  let mergedConfig = {};
  const handledTypes = new Set();

  for (const type of enhancerTypes) {
    if (!recipe[type]) continue;

    // Check if existing enhancer already has a part with this type
    if (existingParts) {
      const matchIdx = existingParts.findIndex((p) => p.config?.enhancerType === type);
      if (matchIdx >= 0) {
        // Replace the existing part with the frontend's version
        const replacement = createEnhancerByType(type, recipe[type]);
        if (replacement) {
          existingParts[matchIdx] = replacement;
        }
        handledTypes.add(type);
        continue;
      }
    } else if (existingEnhancer?.config?.enhancerType === type) {
      // Single existing enhancer (no _parts) — replace its config
      const replacement = createEnhancerByType(type, recipe[type]);
      if (replacement) {
        enhancers.push(replacement);
        mergedConfig = { ...mergedConfig, ...replacement.config };
      }
      handledTypes.add(type);
      continue;
    }

    const enhancer = createEnhancerByType(type, recipe[type]);
    if (enhancer) {
      enhancers.push(enhancer);
      if (enhancer.config) {
        mergedConfig = { ...mergedConfig, ...enhancer.config };
      }
    }
  }

  // If existing had _parts and we replaced within them, recompose
  if (existingParts && handledTypes.size > 0) {
    // Add any new (non-replaced) enhancers to the parts
    const allParts = [...existingParts, ...enhancers];
    if (allParts.length === 1) {
      allParts[0]._parts = allParts;
      return allParts[0];
    }
    const composedFn = (args) =>
      allParts.reduce((schema, fn) => fn({ ...args, schema }), args.schema);
    composedFn.config = allParts.reduce((acc, fn) => ({ ...acc, ...fn.config }), {});
    composedFn._parts = allParts;
    return composedFn;
  }

  // If existing enhancer handled everything, return it
  if (enhancers.length === 0) return existingEnhancer || null;

  // Chain existing enhancer before new ones if present
  if (existingEnhancer) {
    enhancers.unshift(existingEnhancer);
    mergedConfig = { ...existingEnhancer.config, ...mergedConfig };
  }

  if (enhancers.length === 1) {
    return enhancers[0];
  }

  // Compose multiple enhancers
  const composedFn = (args) =>
    enhancers.reduce((schema, fn) => fn({ ...args, schema }), args.schema);
  composedFn.config = mergedConfig;
  composedFn._parts = enhancers;
  return composedFn;
}

/**
 * Create an enhancer by type name and config.
 * @private
 */
function createEnhancerByType(type, config) {
  let enhancer = null;

  switch (type) {
    case 'inheritSchemaFrom': {
      const { typeField, mappingField, defaultsField = 'itemDefaults', filterConvertibleFrom, blocksField, title, default: defaultValue, parentControlled } = config;
      // typeField is optional — if not in recipe, inheritSchemaFrom reads
      // blocksConfig[blockType].itemTypeField at call time.
      // parentControlled: { childType: ['fieldA', 'fieldB'] } — fields the
      // parent always claims for child blocks of a given type, beyond what
      // runtime fieldMapping captures. Read by hideParentOwnedFields (auto-
      // applied to every block by installChildBlockEnhancers) and also by
      // this enhancer's own inherited-fields filter so parentControlled
      // fields appear in the parent's "Item Defaults" fieldset.
      const typeFieldOptions = (filterConvertibleFrom || blocksField || title || defaultValue || parentControlled)
        ? { filterConvertibleFrom, blocksField, title, default: defaultValue, parentControlled }
        : {};
      enhancer = inheritSchemaFrom(typeField || null, mappingField || null, defaultsField, typeFieldOptions);
      enhancer.config = { ...config, enhancerType: 'inheritSchemaFrom' };
      break;
    }
    case 'fieldRules': {
      enhancer = createFieldRulesEnhancer(config);
      if (enhancer) enhancer.config = { ...enhancer.config, enhancerType: 'fieldRules' };
      break;
    }
    default:
      console.warn(`Unknown schemaEnhancer type: ${type}`);
      return null;
  }

  return enhancer;
}

/**
 * Create a fieldRules schemaEnhancer that adds, removes, or conditionally
 * modifies field definitions in the schema.
 *
 * Config format: { fieldPath: rule, ... }
 *
 * Rule formats:
 *   false                          — always hide the field
 *   { set: <definition|false> }    — always set/hide
 *   { when: <condition>, else?: <definition|false> }
 *                                  — show when condition met, else hide/keep
 *   { when: <condition>, set: <definition>, else?: <definition|false> }
 *                                  — conditional definition override
 *   [ rule, rule, ... ]            — switch: first matching rule wins
 *
 * Condition format (when) — every operator is driven by the field's declared
 * type (its SURFACE) and throws when used off-surface; see resolveWhenField /
 * evaluateOperators for the full table:
 *   { fieldName: value }           — equality (bare value ≡ { is: value })
 *   { fieldName: { isNot: v } }    — inequality (arrays: set-equality)
 *   { fieldName: { isSet: true } } — presence ('' / [] / unset are not set)
 *   { fieldName: { oneOf: [a,b] } }— scalar (string/number) value ∈ set
 *   { fieldName: { contains: v } } — STRING: substring; ARRAY: membership (a
 *                                    multiselect value, or a region's block TYPE)
 *   { fieldName: { containsAny: [a,b] } } — ARRAY shares any / (All) holds all
 *   { fieldName: { regex: 're' } } — STRING (incl. slate plaintext) matches a
 *                                    pattern ('re' or { pattern, flags })
 *   { fieldName: { gte: n } }      — NUMBER compares; ARRAY (multiselect / a
 *                                    region, named by its field) COUNTS its items
 *                                    (one region only, never a cross-region total)
 *   { '../field': value }          — parent/root field path
 *
 * Field definitions can include a `fieldset` property to specify placement:
 *   { title: '...', widget: '...', fieldset: { id: 'fs', title: 'FS' } }
 *   { title: '...', widget: '...', fieldset: 'existing-fieldset-id' }
 *
 * Nested field paths (e.g., 'querystring.b_size') target fields inside
 * a widget's inner schema by adding a schemaEnhancer to the parent property.
 *
 * @private
 */
function createFieldRulesEnhancer(rulesConfig) {
  const enhancer = (args) => {
    const { schema, formData } = args;
    if (!schema?.properties) return schema;

    const fieldsToHide = new Set();
    const fieldsToSet = {};    // fieldName → { definition, fieldset? }
    const nestedHides = {};    // parentField → Set of child fields to hide

    for (const [fieldPath, rule] of Object.entries(rulesConfig)) {
      // Handle nested field paths (e.g., 'querystring.b_size')
      if (fieldPath.includes('.')) {
        const [parentField, childField] = fieldPath.split('.', 2);
        if (!schema.properties[parentField]) continue;
        const result = evaluateFieldRule(rule, formData, args);
        if (result === false) {
          if (!nestedHides[parentField]) nestedHides[parentField] = new Set();
          nestedHides[parentField].add(childField);
        }
        continue;
      }

      const result = evaluateFieldRule(rule, formData, args);

      if (result === false) {
        fieldsToHide.add(fieldPath);
      } else if (result && typeof result === 'object') {
        const { fieldset, ...fieldDef } = result;
        fieldsToSet[fieldPath] = { definition: fieldDef, fieldset };
      }
      // result === undefined → no change (keep current)
    }

    // No changes needed
    if (fieldsToHide.size === 0 && Object.keys(fieldsToSet).length === 0 && Object.keys(nestedHides).length === 0) {
      return schema;
    }

    let newProperties = { ...schema.properties };
    let newFieldsets = schema.fieldsets.map((fs) => ({
      ...fs,
      fields: [...fs.fields],
    }));

    // Apply nested hides (add schemaEnhancer to parent property)
    for (const [parentField, childFields] of Object.entries(nestedHides)) {
      const existingEnhancer = newProperties[parentField]?.schemaEnhancer;
      newProperties[parentField] = {
        ...newProperties[parentField],
        schemaEnhancer: (innerArgs) => {
          const innerSchema = existingEnhancer ? existingEnhancer(innerArgs) : innerArgs.schema;
          return {
            ...innerSchema,
            fieldsets: innerSchema.fieldsets.map((fs) => ({
              ...fs,
              fields: fs.fields.filter((f) => !childFields.has(f)),
            })),
          };
        },
      };
    }

    // Hide fields
    if (fieldsToHide.size > 0) {
      newFieldsets = newFieldsets
        .map((fs) => ({
          ...fs,
          fields: fs.fields.filter((f) => !fieldsToHide.has(f)),
        }))
        .filter((fs) => fs.fields.length > 0 || fs.id === 'default');
      for (const f of fieldsToHide) {
        delete newProperties[f];
      }
    }

    // Add/replace fields
    for (const [fieldName, { definition, fieldset }] of Object.entries(fieldsToSet)) {
      newProperties[fieldName] = { ...(newProperties[fieldName] || {}), ...definition };

      if (fieldset) {
        // Remove from any existing fieldset first (to avoid duplicates)
        for (const fs of newFieldsets) {
          fs.fields = fs.fields.filter((f) => f !== fieldName);
        }

        if (typeof fieldset === 'object') {
          // Create or find fieldset
          const existing = newFieldsets.find((fs) => fs.id === fieldset.id);
          if (existing) {
            existing.fields.push(fieldName);
          } else {
            newFieldsets.push({
              id: fieldset.id,
              title: fieldset.title || fieldset.id,
              fields: [fieldName],
            });
          }
        } else if (typeof fieldset === 'string') {
          const existing = newFieldsets.find((fs) => fs.id === fieldset);
          if (existing) {
            existing.fields.push(fieldName);
          }
        }
      } else if (!newFieldsets.some((fs) => fs.fields.includes(fieldName))) {
        // New field without explicit fieldset — add to default
        const defaultFs = newFieldsets.find((fs) => fs.id === 'default');
        if (defaultFs) {
          defaultFs.fields.push(fieldName);
        }
      }
    }

    // Clean up empty fieldsets (except default)
    newFieldsets = newFieldsets.filter((fs) => fs.fields.length > 0 || fs.id === 'default');

    return {
      ...schema,
      properties: newProperties,
      fieldsets: newFieldsets,
      // A hidden field can't be required — the editor can't supply a value it
      // can't see, and a required-but-absent property would wedge the form. So
      // drop any hidden field from `required`. This also gives *conditional*
      // required for free: declare a field required in the base schema, gate it
      // with a `when` rule, and it's required exactly when the rule shows it
      // (e.g. a card's `image` is required only when the grid enables the image
      // element).
      required: (schema.required || []).filter((f) => !fieldsToHide.has(f)),
    };
  };

  enhancer.config = { fieldRules: rulesConfig };
  return enhancer;
}

/**
 * Evaluate a field rule and return the resulting field definition.
 *
 * Rule shapes:
 *   false                                  → always hide
 *   { when, set?, else? }                  → single conditional: when-matches ? set : else
 *   { ...fieldDef }                        → plain definition, always applied
 *   [ { when, set? }, …, { set? }, false ] → switch: first matching entry wins.
 *                                             Bare `false` acts as a catch-all hide
 *                                             (equivalent to `{ set: false }`).
 *
 * Returns: false (hide), object (field definition), or undefined (no change).
 * @private
 */
/**
 * What a MATCHED rule yields: its `set` definition, carrying any `error` or
 * `warning` it also declares.
 *
 * An ERROR is refused — a registered validator turns `hydraRuleError` into a
 * form error, so the save does not go through. A WARNING is said, not refused:
 * it is deliberately NOT a validator, because advice ("this SVG is not drawn to
 * the 48×48 grid") must not block a save over artwork that may be a little off
 * and still be the right artwork. The sidebar renders it; nothing blocks.
 *
 * Shared by both rule forms — a single `{ when, … }` and an entry in a switch —
 * so `error` and `warning` mean the same thing wherever they are written.
 * @private
 */
function matchedRuleResult(rule) {
  const set = 'set' in rule ? rule.set : undefined;
  if (!('error' in rule || 'warning' in rule) || set === false) return set;
  return {
    ...(set && typeof set === 'object' ? set : {}),
    ...('error' in rule ? { hydraRuleError: rule.error } : {}),
    ...('warning' in rule ? { hydraRuleWarning: rule.warning } : {}),
  };
}

function evaluateFieldRule(rule, formData, args) {
  // false → always hide
  if (rule === false) return false;

  // Array → switch: first matching rule wins
  if (Array.isArray(rule)) {
    for (const r of rule) {
      // Bare false acts as a catch-all "hide" (matches with no condition)
      if (r === false) return false;
      if (!r.when || evaluateWhenCondition(r.when, formData, args)) {
        if ('set' in r || 'error' in r || 'warning' in r) {
          return matchedRuleResult(r);
        }
        return undefined; // matched but says nothing → keep current
      }
    }
    return undefined; // no match → keep current
  }

  // Object with 'when', 'set', 'error' or 'warning' → single rule
  if (
    rule &&
    typeof rule === 'object' &&
    ('when' in rule || 'set' in rule || 'error' in rule || 'warning' in rule)
  ) {
    if (!rule.when || evaluateWhenCondition(rule.when, formData, args)) {
      // Condition met (or no condition)
      // Keyed on the field, which is why a rule spanning two fields is written
      // on the field that should show the message rather than needing a
      // block-level address of its own.
      return matchedRuleResult(rule);
    }
    // Condition not met → use else (default: undefined = keep current)
    return 'else' in rule ? rule.else : undefined;
  }

  // Plain object without 'when'/'set' → it's a field definition (always apply)
  if (rule && typeof rule === 'object') {
    return rule;
  }

  return undefined;
}

/**
 * Reduce a `when` field path to a comparison SURFACE — the single abstraction the
 * operators act on — WITHOUT sniffing the value shape. Uses the central
 * field-access API (the SAME one inline-edit / the sidebar use): the block-scope
 * resolver (`/`, `..`) → `{ blockId, fieldName }`, then `getFieldValue` /
 * `getFieldDef` / the storage-agnostic region reader.
 *
 * A surface is `{ kind, value, fieldPath }` where kind ∈:
 *   - `'string'`  — text / textarea / url / Choice → the string; a SLATE field →
 *                   its plaintext (`slateNodesText`), so contains/regex read prose.
 *   - `'number'`  — integer / float / number → the number.
 *   - `'boolean'` — boolean → true/false.
 *   - `'array'`   — a MULTISELECT (type 'array') → its selected values; a REGION
 *                   (object_list widget OR a blocks_layout region key) → the
 *                   ordered list of its child block TYPES (`getBlockType`, so
 *                   `contains: 'image'` means "has an image block").
 *
 * The virtual field `@index` is special: instead of field data it reads the
 * block's ordinal POSITION within its parent object_list region (from the
 * blockPathMap path) as a `'number'` surface — so `{ '@index': { lt: 1 } }` is
 * "first in my region" and `../@index` is the parent block's index. Distinct
 * from the region surface's numeric ops (which COUNT children); a non-object_list
 * block yields an unset number (comparisons false, never a throw).
 *
 * Only the current block carries a schema here (`args.schema`); a `../`/`/` ref
 * has none, so its non-region value defaults to the string surface.
 * @private
 */
function resolveWhenField(fieldPath, formData, args) {
  const hydraContext = getHydraSchemaContext?.();
  const blockPathMap = args?.blockPathMap || hydraContext?.blockPathMap;
  const curBlockId =
    args?.blockId ?? hydraContext?.currentBlockId ?? PAGE_BLOCK_UID;
  let { blockId: targetBlockId, fieldName } = resolveBlockFieldPath(
    fieldPath,
    curBlockId,
    blockPathMap,
  );

  // Position surface — `@index` is a block's ordinal index within its parent
  // object_list region, sourced from the blockPathMap PATH (its last element is
  // the numeric array index for an object_list item), NOT from field data. It
  // composes with the block-step grammar, so `../@index` is the parent block's
  // index (a cell reading its row's position). This is what lets a rule key off
  // POSITION rather than a field value — e.g. a table cell that is a header when
  // its row is first (`../@index` < 1) or it is first in its row (`@index` < 1).
  // It's a number surface, distinct from (and non-colliding with) the region
  // surface's numeric ops, which COUNT a region's children. A non-object_list
  // block (path with no numeric tail) yields an unset number, so comparisons are
  // false rather than throwing.
  //
  // `../@index` can still carry its leading `../` here when there was no
  // blockPathMap to resolve them — e.g. buildBlockPathMap PASS 1 computes a
  // GENERIC schema (no blockId/blockPathMap), so `resolveFieldPath` returns the
  // path verbatim. In that case the position is simply unknown → an UNSET number
  // (every comparison false), never a throw. Pass 2 re-runs the enhancer WITH the
  // blockPathMap, where `../@index` resolves to the parent block and this reads
  // its real index. So strip any unresolved leading `../` before matching.
  if (fieldName === '@index' || fieldName.replace(/^(?:\.\.\/)+/, '') === '@index') {
    const p = blockPathMap?.[targetBlockId]?.path;
    const last = Array.isArray(p) && p.length ? p[p.length - 1] : undefined;
    return {
      kind: 'number',
      value: typeof last === 'number' ? last : undefined,
      fieldPath,
    };
  }

  // Which block owns the field, and (only for the current block) its schema.
  let block;
  let schema;
  if (targetBlockId === curBlockId) {
    block = formData;
    schema = args?.schema;
  } else if (targetBlockId === PAGE_BLOCK_UID) {
    block = args?.pageFormData || hydraContext?.formData;
  } else {
    block = getLiveBlockData?.(targetBlockId, {
      formData: args?.pageFormData,
      blockPathMap,
    });
  }

  // `a.b.0.c` addresses field `a` and then walks into its value. A field's own
  // name never contains a dot, so the split is unambiguous.
  const [headField, ...valuePath] = fieldName.split('.');
  if (valuePath.length > 0) fieldName = headField;

  const def = schema ? getFieldDef(schema, fieldName) : undefined;

  // REGION → array of child block TYPES. object_list via widget, blocks_layout via
  // the shared dict (incl. empty) OR a schema-declared blocks_layout field (so a
  // region with no data yet — e.g. pass-1 resolution with formData={} — counts 0
  // rather than throwing on a numeric op, mirroring object_list). A typed
  // object_list stores its type in a `typeField`; blocks_layout children carry
  // `@type` — getBlockType handles both.
  const isObjectList = def?.widget === 'object_list';
  const isBlocksLayoutRegion =
    def?.widget === 'blocks_layout' ||
    Array.isArray(block?.blocks_layout?.[fieldName]);
  if (isObjectList || isBlocksLayoutRegion) {
    const entries = getChildBlockEntries(block, { isObjectList, region: fieldName });
    const types = entries.map((e) => getBlockType(e.block, def?.typeField));
    return { kind: 'array', value: types, fieldPath };
  }

  const raw = block ? getFieldValue(block, fieldName) : undefined;

  // A path INTO the field's value, e.g. `image_scales.image.0.content-type`.
  //
  // Some of what a rule needs to ask about is not a field at all. Volto stores
  // an image's mime type and dimensions ALONGSIDE the reference, in
  // `image_scales`, so "is this an SVG" and "is it square" are answerable from
  // data the block already carries — but only if a path can reach inside a
  // value instead of stopping at the field.
  //
  // The surface comes from the VALUE here, not from a schema: there is no field
  // definition for `image_scales.image.0.width`, so nothing else can say
  // whether it is a number. That is the one place this rule engine sniffs a
  // value, and it is because a declared type does not exist to consult.
  if (valuePath.length > 0) {
    let value = raw;
    for (const step of valuePath) {
      if (value == null) break;
      value = Array.isArray(value) ? value[Number(step)] : value[step];
    }
    // Nothing there. A declared field would still know its type from the
    // schema; a sub-path has nothing to ask, so it gets its own surface rather
    // than being guessed at as a string — which would make a numeric operator
    // throw on content that simply has no image yet.
    if (value === undefined || value === null) {
      return { kind: 'unset', value: undefined, fieldPath };
    }
    const kind =
      typeof value === 'number'
        ? 'number'
        : typeof value === 'boolean'
          ? 'boolean'
          : Array.isArray(value)
            ? 'array'
            : 'string';
    return { kind, value, fieldPath };
  }

  const typeStr = def ? getFieldTypeString(def) : undefined;
  const type = def?.type;

  // SLATE / rich text → plaintext string (checked before 'array', since slate can
  // be `array:slate`).
  if (isSlateFieldType(typeStr)) {
    return { kind: 'string', value: slateNodesText(raw), fieldPath };
  }
  if (type === 'array') {
    return { kind: 'array', value: Array.isArray(raw) ? raw : [], fieldPath };
  }
  if (['integer', 'int', 'float', 'number'].includes(type)) {
    return { kind: 'number', value: raw, fieldPath };
  }
  if (type === 'boolean') {
    return { kind: 'boolean', value: raw, fieldPath };
  }
  // Default scalar surface: text / textarea / url / Choice (and schemaless refs).
  return { kind: 'string', value: raw, fieldPath };
}

/**
 * Evaluate a 'when' condition against form data.
 * Format: { fieldPath: expectedValue, ... } or { fieldPath: { operator: value }, ... }
 * All entries must match (AND logic). A bare value is shorthand for `{ is: value }`.
 * @private
 */
function evaluateWhenCondition(when, formData, args) {
  for (const [fieldPath, expected] of Object.entries(when)) {
    const surface = resolveWhenField(fieldPath, formData, args);
    const operators =
      expected && typeof expected === 'object' && !Array.isArray(expected)
        ? expected
        : { is: expected };
    const resolved = resolveOperands(operators, formData, args);
    // A reference to a field that holds nothing cannot be compared against, and
    // must not read as "no constraint" — that would silently make the condition
    // TRUE and fire the rule on every form where the other field is not filled
    // in yet.
    if (resolved === UNCOMPARABLE) return false;
    if (!evaluateOperators(surface, resolved)) return false;
  }
  return true;
}

/**
 * Resolve `{ field: <path> }` operands to the value that field holds.
 *
 * Every operand was a literal, so a rule could only ever compare a field to a
 * constant — `{ endDate: { lt: '2026-01-01' } }`. Comparing one field to
 * ANOTHER is the ordinary case for a cross-field check (an end date before its
 * start date, a maximum below its minimum), and there was no way to say it.
 *
 * The reference goes through the same path grammar as a `when` key, so `../`
 * steps and value sub-paths work in an operand exactly as they do in a key. A
 * reference to a field holding NOTHING returns UNCOMPARABLE and the whole
 * condition is false — there is nothing to compare against, and treating that
 * as "no constraint" would fire the rule on every form where the other field is
 * not filled in yet.
 * @private
 */
const UNCOMPARABLE = Symbol('uncomparable');

function resolveOperands(operators, formData, args) {
  let resolved;
  for (const [op, operand] of Object.entries(operators)) {
    if (
      operand &&
      typeof operand === 'object' &&
      !Array.isArray(operand) &&
      typeof operand.field === 'string'
    ) {
      let value = resolveWhenField(operand.field, formData, args).value;
      if (value === undefined || value === null) return UNCOMPARABLE;
      // Basic arithmetic on the reference, so a comparison can carry a
      // tolerance: "square, within a tenth" is `width` against
      // `{ field: 'height', times: 1.1 }`. Without it a cross-field comparison
      // can only ever be exact, which no real measurement is.
      if (typeof operand.times === 'number' || typeof operand.plus === 'number') {
        if (typeof value !== 'number') return UNCOMPARABLE;
        if (typeof operand.times === 'number') value *= operand.times;
        if (typeof operand.plus === 'number') value += operand.plus;
      }
      resolved = resolved || { ...operators };
      resolved[op] = value;
    }
  }
  return resolved || operators;
}

/** Throw when an operator is used on a field surface it can't act on. @private */
function assertKind(op, surface, allowed) {
  if (!allowed.includes(surface.kind)) {
    throw new Error(
      `fieldRules: operator "${op}" is not valid for a ${surface.kind} field${
        surface.fieldPath ? ` ("${surface.fieldPath}")` : ''
      }; it applies to ${allowed.join('/')} fields`,
    );
  }
}

/** The set operand of oneOf/containsAny/… — must be an array. @private */
function requireSet(op, operand) {
  if (!Array.isArray(operand)) {
    throw new Error(`fieldRules: operator "${op}" expects an array (a set)`);
  }
  return operand;
}

/** Does the field have a meaningful value? '' / [] / null / undefined are unset. @private */
function isPresent({ kind, value }) {
  if (value === undefined || value === null) return false;
  if (kind === 'string') return value !== '';
  if (kind === 'array') return Array.isArray(value) && value.length > 0;
  return true; // number 0 and boolean false are present
}

/** Coerce a number surface's value for comparison; '' / null → NaN. @private */
function numberOf(value) {
  return value === '' || value == null ? NaN : Number(value);
}

/** Equality per surface: set-equality for arrays, numeric for numbers, === else. @private */
function surfaceEquals(surface, operand) {
  const { kind, value } = surface;
  if (kind === 'array') {
    const set = requireSet('is', operand);
    const a = new Set(value);
    const b = new Set(set);
    return a.size === b.size && [...a].every((v) => b.has(v));
  }
  if (kind === 'number') return numberOf(value) === numberOf(operand);
  return value === operand;
}

/** Compile a regex operand — `'pattern'` or `{ pattern, flags }`. @private */
function toRegExp(op, operand) {
  const pattern = typeof operand === 'string' ? operand : operand?.pattern;
  const flags = typeof operand === 'string' ? undefined : operand?.flags;
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    throw new Error(`fieldRules: operator "${op}" has an invalid pattern: ${e.message}`);
  }
}

/**
 * Evaluate operator conditions against a field SURFACE (from resolveWhenField).
 * Every operator is valid only for specific surface kinds and THROWS otherwise —
 * count-vs-compare, membership-vs-substring, etc. are driven by the surface, never
 * the value shape:
 *   is / isNot        — any surface (arrays: set-equality; numbers: numeric)
 *   isSet / isNotSet  — any surface (presence)
 *   oneOf / notOneOf  — string | number | boolean: the scalar is (not) in the set
 *   contains          — string: substring · array: membership (a value, or a
 *   / notContains       region's child block TYPE)
 *   containsAny/All   — array: the array shares any / holds all of the set
 *   (+ inverses)
 *   regex / notRegex  — string: matches a pattern (`'re'` or `{ pattern, flags }`)
 *   gt/gte/lt/lte     — number: compare · array: COUNT its items
 * @private
 */
function evaluateOperators(surface, operators) {
  const { kind, value } = surface;

  // An unset sub-path answers only the presence questions. Every comparison is
  // false: there is nothing to compare, and a rule must not fire on a block
  // whose image simply has not been chosen yet.
  if (kind === 'unset') {
    if ('isNotSet' in operators) return operators.isNotSet === true;
    if ('isSet' in operators) return operators.isSet === false;
    return false;
  }
  const {
    is,
    isNot,
    gt,
    gte,
    lt,
    lte,
    isSet,
    isNotSet,
    contains,
    notContains,
    oneOf,
    notOneOf,
    containsAny,
    notContainsAny,
    containsAll,
    notContainsAll,
    regex,
    notRegex,
  } = operators;

  // Presence (isSet/isNotSet) goes through `isPresent`, which treats an empty
  // array as unset — the array widgets (multiselect, object_browser) leave `[]`
  // behind when the last entry is removed rather than dropping the key, so a
  // field the author has just cleared must not still read as answered.
  if (isSet !== undefined && (isSet ? !isPresent(surface) : isPresent(surface)))
    return false;
  if (
    isNotSet !== undefined &&
    (isNotSet ? isPresent(surface) : !isPresent(surface))
  )
    return false;

  if (is !== undefined && !surfaceEquals(surface, is)) return false;
  if (isNot !== undefined && surfaceEquals(surface, isNot)) return false;

  if (oneOf !== undefined) {
    // Scalar set membership — the field's single value is (not) in the set.
    assertKind('oneOf', surface, ['string', 'number', 'boolean']);
    const v = kind === 'number' ? numberOf(value) : value;
    if (!requireSet('oneOf', oneOf).includes(v)) return false;
  }
  if (notOneOf !== undefined) {
    assertKind('notOneOf', surface, ['string', 'number', 'boolean']);
    const v = kind === 'number' ? numberOf(value) : value;
    if (requireSet('notOneOf', notOneOf).includes(v)) return false;
  }

  if (contains !== undefined) {
    // string → substring; array → membership (a value, or a region's block type).
    assertKind('contains', surface, ['string', 'array']);
    const hay = kind === 'array' ? value : String(value ?? '');
    if (!hay.includes(contains)) return false;
  }
  if (notContains !== undefined) {
    assertKind('notContains', surface, ['string', 'array']);
    const hay = kind === 'array' ? value : String(value ?? '');
    if (hay.includes(notContains)) return false;
  }

  if (containsAny !== undefined) {
    assertKind('containsAny', surface, ['array']);
    if (!requireSet('containsAny', containsAny).some((v) => value.includes(v)))
      return false;
  }
  if (notContainsAny !== undefined) {
    assertKind('notContainsAny', surface, ['array']);
    if (requireSet('notContainsAny', notContainsAny).some((v) => value.includes(v)))
      return false;
  }
  if (containsAll !== undefined) {
    assertKind('containsAll', surface, ['array']);
    if (!requireSet('containsAll', containsAll).every((v) => value.includes(v)))
      return false;
  }
  if (notContainsAll !== undefined) {
    assertKind('notContainsAll', surface, ['array']);
    if (requireSet('notContainsAll', notContainsAll).every((v) => value.includes(v)))
      return false;
  }

  if (regex !== undefined) {
    assertKind('regex', surface, ['string']);
    if (!toRegExp('regex', regex).test(value ?? '')) return false;
  }
  if (notRegex !== undefined) {
    assertKind('notRegex', surface, ['string']);
    if (toRegExp('notRegex', notRegex).test(value ?? '')) return false;
  }

  const hasNumericOp =
    gt !== undefined ||
    gte !== undefined ||
    lt !== undefined ||
    lte !== undefined;
  if (hasNumericOp) {
    // number → compare the value; array → COUNT its items. Unset/blank number →
    // NaN → every comparison is false (no "skip-and-match").
    assertKind('gt/gte/lt/lte', surface, ['number', 'array']);
    const n = kind === 'array' ? value.length : numberOf(value);
    if (gt !== undefined && !(n > gt)) return false;
    if (gte !== undefined && !(n >= gte)) return false;
    if (lt !== undefined && !(n < lt)) return false;
    if (lte !== undefined && !(n <= lte)) return false;
  }

  return true;
}

/**
 * Create a single schemaEnhancer from legacy recipe format.
 * Attaches config to the function for parent blocks to read.
 * @private
 */
function createSingleEnhancerLegacy(recipe) {
  if (!recipe || typeof recipe !== 'object' || !recipe.type) {
    return null;
  }

  return createEnhancerByType(recipe.type, recipe.config || {});
}

/**
 * Get valid block types for a type selection field.
 *
 * Used by inheritSchemaFrom to compute choices for the typeField.
 * Logic:
 * 1. Derive from blocksField (container's blocks field schema, or auto-discovered)
 * 2. Or fall back to parent's allowedSiblingTypes from pathMap
 * 3. Fall back to all non-restricted blocks (or all if filtering)
 * 4. Filter by filterConvertibleFrom (types with fieldMappings[source])
 *
 * @param {Object} options - Configuration options
 * @param {string} options.blocksField - Container field name to derive allowedBlocks from (e.g., 'blocks')
 * @param {string} options.filterConvertibleFrom - Source type to filter by (e.g., '@default')
 * @param {Object} blocksConfig - Block configuration registry
 * @param {Object} blockPathMap - Block path map (optional, for allowedSiblingTypes)
 * @param {string} blockId - Current block ID (optional, for allowedSiblingTypes)
 * @param {Object} formData - Current block's formData (optional, for blocksField lookup)
 * @returns {Array} - Array of [value, label] tuples for choices
 */
/**
 * Get the first blocks field name for a container block from the pathMap.
 * Only considers blocks fields (not object_list fields).
 * Returns undefined if no children found or pathMap not available.
 */
function getFirstBlocksField(blockId, blockPathMap) {
  if (!blockPathMap || !blockId) return undefined;
  // The first container field of this block — its NAME, storage-agnostic
  // (blocks-layout and object_list act the same here). getChildField hides the
  // region-vs-containerField detail.
  for (const childId of getChildBlockIds(blockId, blockPathMap)) {
    const field = getChildField(childId, blockPathMap);
    if (field) return field;
  }
  return undefined;
}

export function getBlockTypeChoices(options, blocksConfig, blockPathMap, blockId, formData, intl) {
  if (!blocksConfig) return [];

  const { blocksField, filterConvertibleFrom } = options || {};

  // Derive from container's blocks field schema
  // blocksField specifies which container field to get allowedBlocks from
  // Special value '..' means get sibling allowed types from parent container
  // If blocksField is undefined, default to the first blocks field from pathMap
  let effectiveBlocksField = blocksField;
  if (effectiveBlocksField === undefined) {
    effectiveBlocksField = getFirstBlocksField(blockId, blockPathMap);
  }

  let types;
  if (effectiveBlocksField) {
    if (effectiveBlocksField === '..') {
      // ".." means get sibling allowed types from parent container
      // This is available via blockPathMap[blockId].allowedSiblingTypes
      if (blockPathMap && blockId) {
        const pathInfo = blockPathMap[blockId];
        if (pathInfo?.allowedSiblingTypes) {
          types = pathInfo.allowedSiblingTypes;
        }
      }
    } else if (formData) {
      // Regular field name - look at container's own field
      const blockType = formData['@type'];
      const blockSchema = getBlockTypeSchema(blockType, intl, blocksConfig);
      const fieldDef = blockSchema?.properties?.[effectiveBlocksField];
      // Field def's allowedBlocks, else the block config's (implicit containers).
      const raw = fieldDef?.allowedBlocks ?? blocksConfig[blockType]?.allowedBlocks;
      // Subtract any ancestor `disallowDescendantBlocks` via the SAME helper the
      // pathMap uses, so the type picker agrees with add/DnD. No sync-narrowing
      // here (itemTypeField undefined) — the picker enumerates ALL type choices;
      // the set applying to this container's children was recorded on its entry.
      const disallow = blockPathMap?.[blockId]?.descendantDisallowedTypes;
      types = addableSiblingTypes(raw, undefined, formData, blocksConfig, disallow);
    }
  }

  // Try parent's allowedSiblingTypes from pathMap
  if (!types && blockPathMap && blockId) {
    const pathInfo = blockPathMap[blockId];
    if (pathInfo?.allowedSiblingTypes) {
      types = pathInfo.allowedSiblingTypes;
    }
  }

  // Fall back to all non-restricted blocks (or all if filtering)
  if (!types) {
    types = Object.keys(blocksConfig).filter(
      (type) => blocksConfig[type] && (filterConvertibleFrom || !blocksConfig[type].restricted),
    );
  }

  // Filter by filterConvertibleFrom (types with fieldMappings[source])
  if (filterConvertibleFrom) {
    types = types.filter((type) => {
      const blockConfig = blocksConfig[type];
      return blockConfig?.fieldMappings?.[filterConvertibleFrom];
    });
  }

  // Return as choices array [[value, label], ...]
  return types
    .filter((type) => blocksConfig[type])
    .map((type) => [type, blocksConfig[type]?.title || type]);
}

/**
 * The canonical @default virtual type fields.
 * These are the standard Plone content item fields that listing query results
 * provide (see DEFAULT_FIELD_MAPPING in expandListingBlocks).
 * A fieldMappings['@default'] entry must use only these keys.
 */
// `@default` keys are a linked content item's fields as a catalog SEARCH returns
// them (metadata_fields:'_all') — not just @id/title/description/image. A block
// pulls any of these onto its own fields (copy-from-target). The set stays an
// allowlist so genuine mistakes — this block's own field names / fieldRules keys
// (label, field, required, hidden, …) put in @default — still warn.
/**
 * Validate fieldMappings on a block config. Logs warnings for invalid entries.
 * Call during INIT to catch configuration errors early.
 */
export function validateFieldMappings(blockType, blockConfig) {
  const fieldMappings = blockConfig?.fieldMappings;
  if (!fieldMappings) return;

  const defaultMapping = fieldMappings['@default'];
  if (defaultMapping) {
    const invalidKeys = Object.keys(defaultMapping).filter(
      key => !DEFAULT_TYPE_FIELDS.has(key),
    );
    if (invalidKeys.length > 0) {
      console.warn(
        `[HYDRA] Block type "${blockType}" has fieldMappings['@default'] with ` +
        `invalid keys: ${invalidKeys.join(', ')}. @default keys are a linked ` +
        `content item's search-metadata field names (title, description, image, ` +
        `Subject, created, …) — not this block's own field names. Use explicit ` +
        `type-to-type mappings for those (e.g., fieldMappings: { otherType: { ... } }).`,
      );
    }
  }
}


/**
 * Static map { sourceType: [reachableTypes] } over the fieldMappings conversion
 * graph — the full reachable set, UNFILTERED by any container's allowedBlocks
 * (the target filters at check time). Built once and shipped to the iframe so it
 * can offer convert-reachable drop spots. Types with no reachable targets map to [].
 */
export function getConversionMap(blocksConfig) {
  const map = {};
  if (!blocksConfig) return map;
  for (const sourceType of Object.keys(blocksConfig)) {
    map[sourceType] = getConvertibleTypes(sourceType, blocksConfig).map(
      (t) => t.type,
    );
  }
  return map;
}

/**
 * Find the conversion path from source to target type.
 * Returns array of types representing the path, or null if no path exists.
 * Prefers direct mappings over default mappings.
 * Uses the same @default compatibility rules as getConvertibleTypes.
 */
function findConversionPath(sourceType, targetType, blocksConfig) {
  if (sourceType === targetType) return [sourceType];

  // BFS to find path, prioritizing direct mappings over default
  const queue = [[sourceType]];
  const visited = new Set([sourceType]);

  while (queue.length > 0) {
    const path = queue.shift();
    const currentType = path[path.length - 1];

    // Separate into direct and compatible-default targets, process direct first
    const directTargets = [];
    const defaultTargets = [];

    for (const [blockType, blockConfig] of Object.entries(blocksConfig)) {
      if (visited.has(blockType)) continue;
      if (!blockConfig.fieldMappings) continue;

      if (blockConfig.fieldMappings[currentType]) {
        directTargets.push(blockType);
      } else if (blockConfig.fieldMappings['@default'] &&
                 hasValidDefault(blockConfig) &&
                 hasValidDefault(blocksConfig[currentType])) {
        defaultTargets.push(blockType);
      }
    }

    // Process direct mappings first (higher priority)
    for (const blockType of [...directTargets, ...defaultTargets]) {
      if (visited.has(blockType)) continue;
      visited.add(blockType);

      const newPath = [...path, blockType];
      if (blockType === targetType) {
        return newPath;
      }
      queue.push(newPath);
    }
  }
  return null;
}

/**
 * Invert a field mapping (swap keys and values).
 * Used to extract data FROM a block using its default mapping.
 */
function invertMapping(mapping) {
  if (!mapping) return {};
  const inverted = {};
  for (const [sourceField, targetField] of Object.entries(mapping)) {
    inverted[targetField] = sourceField;
  }
  return inverted;
}

/**
 * Get the resolved schema for a block type from blocksConfig.
 * Handles both static objects and factory functions.
 */
function getResolvedSchema(blocksConfig, blockType, intl) {
  const cfg = blocksConfig?.[blockType];
  if (!cfg?.blockSchema) return null;
  if (typeof cfg.blockSchema !== 'function') return cfg.blockSchema;
  return cfg.blockSchema({ intl });
}

/**
 * Map a schema widget to a convertFieldValue targetType.
 * Returns null if no coercion is needed (pass-through).
 * @param {string} widget - The widget name from the schema field
 * @param {Object} fieldDef - The full field definition (to check mode, etc.)
 */
export function widgetToTargetType(widget, fieldDef) {
  if (widget === 'object_browser') {
    // object_browser in image mode: array format [{ '@id': url, image_field?, image_scales? }]
    if (fieldDef?.mode === 'image') return 'image_link';
    return 'link';
  }
  // ImageWidget: string value + sibling image_field/image_scales fields on the block
  if (widget === 'image') return 'image';
  if (widget === 'url') return 'string';
  if (widget === 'slate') return 'slate';
  if (widget === 'textarea') return 'textarea';
  return null;
}

/**
 * Resolve a fieldMapping value that names a container REGION (a `blocks_layout`
 * or `object_list` field), possibly nested under `widget:'object'` wrappers,
 * into a getChildBlockEntries/setChildBlockEntries descriptor. Segments are
 * '/'-separated: every segment but the last must be an object wrapper (→
 * regionPath), the last a region field. So `"items"` → { region:'items',
 * regionPath:[] } and `"data/items"` → { region:'items', regionPath:['data'] }.
 * Returns null when the path is NOT a region (a plain scalar mapping) — that's
 * how convertBlockType tells a region↔region mapping from a scalar one.
 */
function resolveRegionDescriptor(blockType, path, blocksConfig, intl) {
  if (typeof path !== 'string') return null;
  const segs = path.split('/');
  let schema = getResolvedSchema(blocksConfig, blockType, intl);
  const regionPath = [];
  for (let i = 0; i < segs.length; i++) {
    const fieldDef = schema?.properties?.[segs[i]];
    if (!fieldDef) return null;
    const isLast = i === segs.length - 1;
    if (isLast) {
      const base = {
        region: segs[i],
        regionPath,
        allowedBlocks: fieldDef.allowedBlocks || null,
        // The region's synced-type field, if any (e.g. a card-grid's
        // `variation`). Passed to addableSiblingTypes so a reshape resolves the
        // SAME addable set as add/DnD, narrowing a synced container to its one
        // item type rather than the raw allowedBlocks list.
        itemTypeField: fieldDef.itemTypeField || null,
      };
      if (fieldDef.widget === 'blocks_layout') {
        return { ...base, isObjectList: false };
      }
      if (fieldDef.widget === 'object_list') {
        return {
          ...base,
          isObjectList: true,
          idField: fieldDef.idField || '@id',
          typeField: fieldDef.typeField || null,
        };
      }
      return null; // last segment is a scalar, not a region
    }
    // Non-last segment must be an object wrapper to descend into.
    if (fieldDef.widget !== 'object' || !fieldDef.schema) return null;
    regionPath.push(segs[i]);
    schema = fieldDef.schema;
  }
  return null;
}

/**
 * Record a source container region's raw storage fields so convertBlockType's
 * "preserve unmapped fields" step drops them (nothing should leak the old
 * children back onto the target). A nested region lives under its wrapper
 * object (regionPath[0]); a top-level object_list is the field itself; a
 * top-level blocks_layout is the shared blocks/blocks_layout pair.
 */
function consumeSourceRegion(region, consumed) {
  if (region.regionPath.length) {
    consumed.add(region.regionPath[0]);
  } else if (region.isObjectList) {
    consumed.add(region.region);
  } else {
    consumed.add('blocks');
    consumed.add('blocks_layout');
  }
}

/**
 * Convert a block from one type to another using fieldMappings.
 *
 * Supports transitive conversions - if Image→Teaser and Teaser→Hero exist,
 * Image can convert to Hero by applying mappings through the path.
 *
 * For each conversion step:
 * 1. Use source's inverted default mapping to normalize to canonical fields
 * 2. Use target's mapping (source-specific or default) to map to target fields
 *
 * @param {Object} blockData - The source block's data
 * @param {string} newType - The target block type
 * @param {Object} blocksConfig - Block configuration registry
 * @param {string} typeFieldName - Field name for block type (default '@type')
 * @param {Object} intl - react-intl intl object for resolving blockSchema factories
 * @returns {Object} - New block data with @type set to newType and fields mapped
 */
export function convertBlockType(blockData, newType, blocksConfig, typeFieldName = '@type', intl = null) {
  const sourceType = blockData[typeFieldName];

  // Find the conversion path
  const path = findConversionPath(sourceType, newType, blocksConfig);
  if (!path || path.length < 2) {
    // No path found, just set the type (shouldn't happen if getConvertibleTypes was used)
    return { [typeFieldName]: newType };
  }

  // Pack image widget fields into canonical image format: [{ '@id': url, image_field?, image_scales? }]
  // widget:'image' can store value as string (content path) or array [{ '@id': url }],
  // with optional image_field/image_scales as separate block-level fields
  let currentData = { ...blockData };
  const sourceSchema = getResolvedSchema(blocksConfig, sourceType, intl);
  if (sourceSchema?.properties) {
    for (const [fieldName, fieldDef] of Object.entries(sourceSchema.properties)) {
      if (fieldDef.widget === 'image' && currentData[fieldName] !== undefined) {
        const val = currentData[fieldName];
        if (typeof val === 'string') {
          const packed = { '@id': val };
          if (currentData.image_field) packed.image_field = currentData.image_field;
          if (currentData.image_scales) packed.image_scales = currentData.image_scales;
          currentData[fieldName] = [packed];
        }
        break;
      }
    }
  }

  // Source fields already consumed by a region conversion — a moved region's
  // raw storage (top-level `blocks`/`blocks_layout`, a `data` wrapper, or an
  // object_list field), or a scalar value field expanded into a region.
  // Excluded from the "preserve unmapped fields" step below so nothing leaks
  // onto the target alongside the freshly converted result.
  const consumedSourceFields = new Set();

  for (let i = 1; i < path.length; i++) {
    const fromType = path[i - 1];
    const toType = path[i];
    const sourceConfig = blocksConfig?.[fromType];
    const targetConfig = blocksConfig?.[toType];

    // Step 1: Normalize source data to canonical fields using inverted default mapping
    // This extracts data FROM the source block
    const sourceInvertedDefault = invertMapping(sourceConfig?.fieldMappings?.['@default']);
    let canonicalData = {};
    for (const [blockField, canonicalField] of Object.entries(sourceInvertedDefault)) {
      if (currentData[blockField] !== undefined) {
        canonicalData[canonicalField] = currentData[blockField];
      }
    }
    // Also keep original fields for direct mappings
    canonicalData = { ...currentData, ...canonicalData };

    // Step 2: Map canonical/source fields to target using target's mappings
    // Coerce values to match target field widget types (e.g., object_browser ↔ url)
    const targetMappings = targetConfig?.fieldMappings;
    const targetSchema = getResolvedSchema(blocksConfig, toType, intl);
    const newData = { [typeFieldName]: toType };
    // Apply mappings: source-specific first, then default as fallback
    const mappings = { ...targetMappings?.['@default'], ...targetMappings?.[fromType] };
    for (const [sourceField, targetField] of Object.entries(mappings)) {
      // Value↔region: a `region/type/field` path (parseRegionPath) on one side
      // bridges a single scalar VALUE and a container region — the same bridge
      // convertValueContainer uses, via shared helpers.
      //   value → container (EXPAND): target is `region/type/field`; wrap the
      //     source scalar into one child of that type in the region.
      const targetRp = parseRegionPath(targetField);
      if (targetRp) {
        const region = resolveRegionDescriptor(
          toType,
          targetRp.region,
          blocksConfig,
          intl,
        );
        if (!region) continue;
        expandValueIntoRegion(
          newData,
          region,
          targetRp,
          canonicalData[sourceField],
        );
        consumedSourceFields.add(sourceField);
        continue;
      }
      //   container → value (COLLAPSE): source is `region/type/field`; gather
      //     the region's matching children's field into the target scalar.
      const sourceRp = parseRegionPath(sourceField);
      if (sourceRp) {
        const region = resolveRegionDescriptor(
          fromType,
          sourceRp.region,
          blocksConfig,
          intl,
        );
        if (!region) continue;
        const { value } = collapseRegionToValue(canonicalData, region, sourceRp);
        const targetFieldDef = targetSchema?.properties?.[targetField];
        newData[targetField] = convertFieldValue(
          value,
          widgetToTargetType(targetFieldDef?.widget, targetFieldDef),
        );
        consumeSourceRegion(region, consumedSourceFields);
        continue;
      }
      // NOTE: container↔container region moves + cell cascade do NOT live here —
      // they need the live blockPathMap (see reshapeContainerBlock). This pure
      // converter handles childless / value sources: scalar fields + the
      // value↔region bridge above. A container source reaches reshapeContainerBlock
      // via convertBlockInPlace, never this function.
      if (canonicalData[sourceField] !== undefined) {
        const targetFieldDef = targetSchema?.properties?.[targetField];
        const targetType = widgetToTargetType(targetFieldDef?.widget, targetFieldDef);
        // Unpack: when target is widget:'image' (string + siblings), hoist image_field/image_scales
        // from the packed array before convertFieldValue extracts just the string
        if (targetType === 'image') {
          const srcVal = canonicalData[sourceField];
          if (Array.isArray(srcVal) && srcVal.length > 0 && srcVal[0]?.['@id']) {
            if (srcVal[0].image_field) newData.image_field = srcVal[0].image_field;
            if (srcVal[0].image_scales) newData.image_scales = srcVal[0].image_scales;
          }
        }
        newData[targetField] = convertFieldValue(canonicalData[sourceField], targetType);
      }
    }
    currentData = newData;
  }

  // Preserve unmapped fields from the original block that aren't in the final result
  // This enables roundtrip conversion (hero → image → hero) to retain fields like buttonText
  // that exist in source and target but aren't explicitly mapped through intermediate types
  const { [typeFieldName]: _originalType, ...originalFields } = blockData;
  const { [typeFieldName]: finalType, ...convertedFields } = currentData;

  // Region conversions already moved/collapsed the source's children (or
  // expanded a scalar into a region); drop the consumed source fields so
  // nothing stale gets preserved back on top of the converted result.
  for (const field of consumedSourceFields) delete originalFields[field];

  // Coerce preserved fields to match target schema widget types
  // e.g., description (string from summary) → Slate array for hero
  const targetSchema = getResolvedSchema(blocksConfig, finalType, intl);
  if (targetSchema?.properties) {
    for (const [field, value] of Object.entries(originalFields)) {
      if (convertedFields[field] !== undefined) continue; // Already mapped
      const fieldDef = targetSchema.properties[field];
      const targetType = widgetToTargetType(fieldDef?.widget, fieldDef);
      if (targetType) {
        originalFields[field] = convertFieldValue(value, targetType);
      }
    }
  }

  // Merge: original fields as base, converted fields take priority
  return {
    ...originalFields,
    ...convertedFields,
    [typeFieldName]: finalType,
  };
}

/**
 * Convert a CONTAINER block to another type IN PLACE — the pathMap-aware
 * counterpart to convertBlockType (which handles childless / value sources).
 * A container's cells must land as types the target region ALLOWS, and that
 * resolution needs the live blockPathMap: a synced target narrows to its item
 * type, and an ancestor's `disallowDescendantBlocks` is subtracted. convertBlockType
 * can't know either — it has no pathMap — so container conversions route here.
 *
 * Two shapes:
 *  - container → value (collapse): the target declares no regions but a
 *    value↔region bridge exists — fold the region's children into the value
 *    field (convertValueContainer).
 *  - container → container (reshape): move each region's children across
 *    (convertContainerBlock — by-name / primary→first), then cascade-convert any
 *    cell whose type isn't in the target region's ADDABLE set (addableSiblingTypes
 *    + the pathMap's descendantDisallowedTypes) to the first allowed type its own
 *    fieldMappings can reach. Each cell converts via convertBlockType; its content
 *    (valid in both shapes) is preserved.
 *
 * @returns {Object} new formData
 */
export function reshapeContainerBlock(
  formData,
  blockPathMap,
  blockId,
  targetType,
  blocksConfig,
  intl = null,
) {
  const sourceBlock = getBlockById(formData, blockPathMap, blockId);
  if (!sourceBlock) {
    throw new Error(`reshapeContainerBlock: block ${blockId} not found`);
  }
  const sourceType = sourceBlock['@type'];

  // container → value: the target holds no regions. A value↔region bridge folds
  // the children into the value field; without one, a plain type change.
  const targetRegions = getContainerRegionDescriptors(
    targetType,
    blocksConfig,
    intl,
  );
  if (targetRegions.length === 0) {
    const collapsed = convertValueContainer(
      sourceBlock,
      sourceType,
      targetType,
      blocksConfig,
      intl,
    );
    const typeField = blockPathMap[blockId]?.typeField || '@type';
    const next =
      collapsed ||
      convertBlockType(sourceBlock, targetType, blocksConfig, typeField, intl);
    return updateBlockById(formData, blockPathMap, blockId, next);
  }

  // container → container: move the regions verbatim, then cascade the cells.
  const disallowed = blockPathMap[blockId]?.descendantDisallowedTypes;
  const moved = convertContainerBlock(
    formData,
    blockPathMap,
    blockId,
    targetType,
    blocksConfig,
    intl,
  );
  const movedMap = buildBlockPathMap(moved, blocksConfig, intl);
  const container = getBlockById(moved, movedMap, blockId);
  const regions = getContainerRegionDescriptors(
    targetType,
    blocksConfig,
    intl,
    container,
  );
  for (const region of regions) {
    // The addable set for THIS region — the SAME resolver add/DnD/type-sync use.
    const allowed = addableSiblingTypes(
      region.allowedBlocks,
      region.itemTypeField,
      container,
      blocksConfig,
      disallowed,
    );
    if (!allowed) continue; // unrestricted region: every cell is already permitted
    const entries = getChildBlockEntries(container, region);
    let changed = false;
    const next = entries.map(({ id, block }) => {
      const cellType = block?.['@type'];
      if (!cellType || allowed.includes(cellType)) return { id, block };
      // The cell's own fieldMappings decide the target — the first allowed type
      // it can reach (transitively). None ⇒ it can't legally live here ⇒ throw.
      const target = allowed.find((t) =>
        findConversionPath(cellType, t, blocksConfig),
      );
      if (!target) {
        throw new Error(
          `reshapeContainerBlock: cell "${cellType}" has no conversion to any type allowed in region "${region.region}" of "${targetType}" (allowed: ${allowed.join(', ')})`,
        );
      }
      changed = true;
      return {
        id,
        block: convertBlockType(block, target, blocksConfig, '@type', intl),
      };
    });
    if (changed) setChildBlockEntries(container, region, next);
  }
  return updateBlockById(moved, movedMap, blockId, container);
}

/**
 * Sync child blocks when parent's typeField changes.
 * Auto-derived from inheritSchemaFrom config - no extra config needed.
 *
 * If child has its own inheritSchemaFrom, changes its typeField instead of @type.
 * This handles nested containers (Grid → Listing → Items).
 *
 * @param {Object} formData - Current form data
 * @param {Object} blockPathMap - Map of blockId → path info
 * @param {string} blockId - Parent block ID that changed
 * @param {Object} oldBlockData - Previous parent block data
 * @param {Object} newBlockData - Updated parent block data
 * @param {Object} blocksConfig - Block configuration registry
 * @param {Object} intl - react-intl intl object for resolving blockSchema factories
 * @returns {Object} Updated formData with synced children
 */
export function syncChildBlockTypes(formData, blockPathMap, blockId, oldBlockData, newBlockData, blocksConfig, intl = null) {
  const blockType = newBlockData['@type'];
  const blockConfig = blocksConfig?.[blockType];

  // Resolve typeField via the standard lookup (recipe → schema walk → legacy)
  const typeField = findTypeField(blockConfig, intl);
  if (!typeField) return formData;

  // Check if typeField value changed
  const oldType = oldBlockData?.[typeField];
  const newType = newBlockData[typeField];
  if (oldType === newType || !newType) return formData;

  let result = formData;

  // Reset fieldMapping to the new type's default when variation changes
  // The new type's fieldMappings['@default'] provides the correct source→target mapping
  const newTypeConfig = blocksConfig?.[newType];
  const defaultFieldMapping = newTypeConfig?.fieldMappings?.['@default'];
  if (defaultFieldMapping) {
    // Get the current block with the new variation and reset its fieldMapping
    const currentBlock = getBlockById(result, blockPathMap, blockId);
    if (currentBlock) {
      const updatedBlock = { ...currentBlock, fieldMapping: defaultFieldMapping };
      result = updateBlockById(result, blockPathMap, blockId, updatedBlock);
    }
  }

  // Determine which blocks field to sync.
  // 1. Schema declaration: blocks field with `itemTypeField: '<typeField>'`
  // 2. Fallback: first blocks field discovered from pathMap (legacy)
  const declaredBlocksField = findBlocksFieldForTypeField(blockConfig, typeField, intl);
  const effectiveBlocksField = declaredBlocksField ?? getFirstBlocksField(blockId, blockPathMap);

  // Child block IDs in the effective container field (storage-agnostic).
  const childIds = effectiveBlocksField
    ? getChildBlockIdsInField(blockId, effectiveBlocksField, blockPathMap)
    : getChildBlockIds(blockId, blockPathMap);
  if (childIds.length === 0) return result;

  // Transform each child
  for (const childId of childIds) {
    const childBlock = getBlockById(result, blockPathMap, childId);
    if (!childBlock) continue;

    const childType = childBlock['@type'];
    const childConfig = blocksConfig?.[childType];
    const childTypeField = findTypeField(childConfig, intl);

    if (childTypeField) {
      // Child has its own inheritSchemaFrom - change its typeField, not @type
      // This handles nested containers (e.g., Grid → Listing)
      if (childBlock[childTypeField] !== newType) {
        const updatedChild = { ...childBlock, [childTypeField]: newType };
        result = updateBlockById(result, blockPathMap, childId, updatedChild);
        // Recursive: sync this child's children too
        result = syncChildBlockTypes(result, blockPathMap, childId, childBlock, updatedChild, blocksConfig, intl);
      }
    } else {
      // Child is a regular block - convert its type using fieldMappings
      if (childType !== newType) {
        const updatedChild = convertBlockType(childBlock, newType, blocksConfig, '@type', intl);
        result = updateBlockById(result, blockPathMap, childId, updatedChild);
      }
    }
  }

  return result;
}

/**
 * Re-derive a moved block's template membership from where it LANDED.
 *
 * One implementation, because there were two moves and only one of them did
 * this. MOVE_BLOCKS (drag and drop) recomputed membership from the block's new
 * neighbours; the chooser's ask-first drop (convert + move in one update) moved
 * the block and never recomputed, so a block dropped into a template region
 * through that path kept its source membership — or none — and the region it
 * landed in did not own it.
 *
 * Membership on a move is GATED ON EDIT MODE (architecture.md » "Template
 * membership"):
 *  - normal mode → the block takes on the membership of wherever it lands, so
 *    its source membership is stripped and re-derived from the destination (a
 *    slot, a template-instance container, or NOTHING → plain page content);
 *  - template edit mode → the author's slotId is EXPLICIT (you rename slots, you
 *    don't change them by dragging), so a move that stays INSIDE the template
 *    keeps its slotId. A move OUT still strips — drag out exits, even while
 *    editing.
 *
 * Fixed template blocks always keep their identity: their slot/fixed IS the
 * template. "Inside the template" means a same-instance block sits both before
 * AND after the landing gap.
 *
 * @param {Object} formData
 * @param {Object} blockPathMap - map for `formData`
 * @param {string} blockId - the block that just moved
 * @param {Object} options
 * @param {Object} options.blocksConfig
 * @param {Object} options.intl
 * @param {Array|null} [options.templateEditMode] - unlocked instance ids
 * @param {boolean} [options.insertAfter]
 * @returns {Object} formData (unchanged object identity when nothing changed)
 */
export function applyMembershipAfterMove(formData, blockPathMap, blockId, options) {
  const {
    blocksConfig,
    intl,
    templateEditMode = null,
    insertAfter,
  } = options;
  const originalBlockData = getBlockById(formData, blockPathMap, blockId);
  if (!originalBlockData) return formData;
  const targetContainerConfig = getContainerFieldConfig(
    blockId,
    blockPathMap,
    formData,
    blocksConfig,
    intl,
  );
  if (!targetContainerConfig) return formData;

  const { parentId: containerId, region: containerRegion } = targetContainerConfig;
  const containerPath =
    containerId === PAGE_BLOCK_UID ? [] : blockPathMap[containerId]?.path;
  const container = containerPath
    ? getBlockByPath(formData, containerPath)
    : formData;
  const fullLayout = container?.blocks_layout?.[containerRegion || 'items'] || [];
  // The block itself is EXCLUDED from the neighbours: it already sits in the
  // layout at this index, so a naive getNeighborData(position) returns the block
  // itself and it offers its own (stale, source) slot back to itself — keeping
  // membership it should have shed. Excluding it makes `position` the insertion
  // gap between its real prev/next neighbours.
  const position = fullLayout.indexOf(blockId);
  const layoutItems = fullLayout.filter((id) => id !== blockId);

  const instId = originalBlockData.templateInstanceId;
  const editingThisTemplate =
    !!instId && (templateEditMode || []).includes(instId);
  const inSameInstance = (id) =>
    id && formData.blocks?.[id]?.templateInstanceId === instId;
  const insideTemplate =
    editingThisTemplate &&
    layoutItems.slice(0, position).some(inSameInstance) &&
    layoutItems.slice(position).some(inSameInstance);

  let blockData = originalBlockData;
  if (!originalBlockData.fixed && !insideTemplate) {
    blockData = { ...blockData };
    delete blockData.templateId;
    delete blockData.templateInstanceId;
    delete blockData.slotId;
    delete blockData.readOnly;
  }
  const updatedBlockData = applyBlockDefaultsWithContext(blockData, {
    containerId,
    field: containerRegion,
    position,
    insertAfter,
    layoutItems,
    allBlocks: formData.blocks,
    blockPathMap,
    blocksConfig,
    intl,
  });
  // Compare against originalBlockData, not the (possibly membership-stripped)
  // copy — otherwise a stripped block whose recompute is a no-op is never
  // written back, and the stored block keeps its stale source membership.
  if (updatedBlockData === originalBlockData) return formData;
  return updateBlockById(formData, blockPathMap, blockId, updatedBlockData);
}

/**
 * Restore the invariants every structural edit owes, in the order they owe them.
 *
 * Adding, deleting, moving and dropping are different edits, but afterwards they
 * all owe the same three things — and the ORDER is the part that kept being got
 * wrong, in a different way by each caller:
 *
 *   1. a block that LANDED somewhere new takes that region's membership;
 *   2. THEN a placeholder it was dropped onto is removed — after (1), because in
 *      a forced region the placeholder is the only neighbour carrying the
 *      template, so removing it first leaves nothing to derive from;
 *   3. a region a block was taken OUT of is re-seeded if that emptied it, so a
 *      forced region always keeps a placeholder to select and add into.
 *
 * Each caller had implemented the subset it happened to need: delete re-seeded
 * but only in one of its two paths; the drag re-derived membership, the chooser's
 * drop didn't; both removed placeholders, in different places relative to (1).
 * Every one of those was a bug, and every one of them was the same bug.
 *
 * @param {Object} formData
 * @param {Object} blockPathMap - map for `formData`
 * @param {Object} what - what the edit did
 * @param {string[]} [what.landed] - blocks that arrived somewhere new
 * @param {string[]} [what.replacedPlaceholders] - 'empty' blocks that were dropped onto
 * @param {Object[]} [what.emptiedContainers] - containerConfigs a block came out of
 * @param {Object} options - blocksConfig, intl, uuidGenerator, templateEditMode,
 *   metadata, and insertAfterById for the membership recompute
 * @returns {{formData: Object, blockPathMap: Object}}
 */
export function settleBlockStructure(formData, blockPathMap, what, options) {
  const { landed = [], replacedPlaceholders = [], emptiedContainers = [] } = what;
  const {
    blocksConfig,
    intl,
    uuidGenerator,
    templateEditMode = null,
    metadata,
    insertAfterById = {},
  } = options;
  let out = formData;
  let map = blockPathMap;
  const remap = () => {
    map = buildBlockPathMap(out, blocksConfig, intl);
  };

  for (const blockId of landed) {
    const next = applyMembershipAfterMove(out, map, blockId, {
      blocksConfig,
      intl,
      templateEditMode,
      insertAfter: insertAfterById[blockId],
    });
    if (next !== out) {
      out = next;
      remap();
    }
  }

  for (const placeholderId of replacedPlaceholders) {
    const next = removeReplacedPlaceholder(out, map, placeholderId, {
      blocksConfig,
      intl,
    });
    if (next !== out) {
      out = next;
      remap();
    }
  }

  for (const containerConfig of emptiedContainers) {
    if (!containerConfig) continue;
    const next = ensureEmptyBlockIfEmpty(
      out,
      containerConfig,
      map,
      uuidGenerator,
      blocksConfig,
      { intl, metadata, properties: out },
    );
    if (next !== out) {
      out = next;
      remap();
    }
  }

  return { formData: out, blockPathMap: map };
}

/**
 * Delete blocks and settle the structure afterwards.
 *
 * ONE delete, because there were two: View.jsx's single (DELETE_BLOCK, the
 * toolbar's Remove) deleted and re-seeded; its multi (DELETE_BLOCKS,
 * multi-select) looped and never re-seeded, so whether a forced region survived
 * being emptied depended on how many blocks you had selected. The lock backstop
 * had drifted the other way — the multi path had it, the single one didn't.
 *
 * @returns {{formData, blockPathMap, deleted: string[]}}
 */
export function deleteBlocks(formData, blockPathMap, blockIds, options = {}) {
  const { blocksConfig, intl, templateEditMode = null } = options;
  let out = formData;
  let map = blockPathMap;
  const deleted = [];
  const emptiedContainers = [];
  for (const blockId of blockIds) {
    const blockData = getBlockById(out, map, blockId);
    // Missing, or locked and not being edited: leave it alone. A backstop — the
    // iframe filters first (hydra._filterMutableBlockUids).
    if (!canMutateBlock(blockData, templateEditMode)) continue;
    const containerConfig = getContainerFieldConfig(
      blockId,
      map,
      out,
      blocksConfig,
      intl,
    );
    out = deleteBlockFromContainer(out, map, blockId, containerConfig);
    map = buildBlockPathMap(out, blocksConfig, intl);
    emptiedContainers.push(containerConfig);
    deleted.push(blockId);
  }
  const settled = settleBlockStructure(out, map, { emptiedContainers }, options);
  return { ...settled, deleted };
}

/**
 * May a block be mutated in place — moved, deleted, retyped?
 *
 * The backstop behind the iframe-side filter (hydra._filterMutableBlockUids). A
 * block that is read-only, or whose position is locked, belongs to a template
 * nobody has unlocked.
 */
export function canMutateBlock(blockData, templateEditMode) {
  if (!blockData) return false;
  return (
    !isBlockReadonly(blockData, templateEditMode) &&
    !isBlockPositionLocked(blockData, templateEditMode)
  );
}

/**
 * May something be inserted next to this block?
 *
 * A different question from canMutateBlock — "put something beside it" is not
 * "change it" — but the same backstop, and paste had neither. Delete and move
 * guarded themselves and paste didn't, so pasting after locked template chrome
 * injected content into a template nobody had unlocked.
 *
 * getBlockAddability is hydra's own answer, used by the toolbar to decide
 * whether to draw a '+'. Asking it here means the mutation agrees with the UI
 * rather than re-deciding.
 */
export function canInsertBesideBlock(
  blockId,
  blockPathMap,
  blockData,
  templateEditMode,
) {
  // No target block (a paste into an empty page-level region) is for the region
  // to allow or refuse, not this guard.
  if (!blockData) return true;
  const addability = getBlockAddability(
    blockId,
    blockPathMap,
    blockData,
    templateEditMode,
  );
  return !!(addability.canInsertAfter || addability.canReplace);
}
