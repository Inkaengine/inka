/**
 * Schema-driven block path map builder — no Volto dependencies.
 *
 * This module provides the core path-building algorithm extracted from
 * packages/volto-hydra/src/utils/blockPath.js so it can be used in
 * contexts that cannot import @plone/volto (e.g. test mock parents,
 * browser-only scripts).
 *
 * blockPath.js imports from here and re-exports, so Volto code continues
 * to use it via the same import path as before.
 */

// The helpers package is pure (no @plone/volto), so importing from it keeps this
// module free of Volto deps — unlike @volto-hydra/hydra-js, which is why
// PAGE_BLOCK_UID is inlined below.
//
// Imported by RELATIVE path, not as '@volto-hydra/helpers'. Consumers import
// this file directly out of a checkout — pretagov-site's content gate runs it
// as plain node, with no install — and a bare specifier needs node_modules to
// resolve, so it failed there with ERR_MODULE_NOT_FOUND while passing anywhere
// the workspace happened to be linked. A relative path needs nothing installed.
import { getBlockType } from '../helpers/index.js';
import { foldSlateStyleRules } from './slateStyles.js';

// Same value as PAGE_BLOCK_UID in hydra.js — defined locally to avoid
// importing from @volto-hydra/hydra-js (which would pull in Volto deps).
const PAGE_BLOCK_UID = '_page';

/**
 * The block types you can ADD into a container field — the single source of
 * truth every add path reads (it becomes each child's `allowedSiblingTypes`,
 * which the block chooser, Enter-to-add and drag validation all consume).
 *
 * A plain field allows all of `allowedBlocks`. A SYNCED field — one whose
 * blocks-field def declares an `itemTypeField` (a sibling field, e.g.
 * `variation`, that drives every child's `@type`) — holds a single item type
 * chosen once on the parent. Adding must not introduce a *different*
 * convertible item type, so the addable set is:
 *   the currently-synced type  +  any structural blocks that aren't convertible
 *   item types (no `fieldMappings['@default']` — e.g. a `listing`).
 * The other convertible item types are reached by changing the parent's
 * `itemTypeField`, not by adding a foreign block into the synced container.
 *
 * An ancestor may also forbid types for its whole subtree via
 * `disallowDescendantBlocks` (see buildBlockPathMap): those are subtracted here,
 * last, so this stays the ONE place add/DnD/convert/type-sync agree on. An
 * empty/absent `disallowedTypes` leaves the result unchanged (back-compat).
 *
 * @param {string[]} allowedBlocks   the field's allowedBlocks
 * @param {string} [itemTypeField]   the field's sync field name (undefined = not synced)
 * @param {Object} [containerBlock]  the container block's data (source of the synced type)
 * @param {Object} [blocksConfig]
 * @param {Set<string>|string[]} [disallowedTypes] types an ancestor disallows in its subtree
 * @returns {string[]}
 */
export function addableSiblingTypes(
  allowedBlocks,
  itemTypeField,
  containerBlock,
  blocksConfig,
  disallowedTypes,
) {
  if (!Array.isArray(allowedBlocks)) return allowedBlocks;
  let types = allowedBlocks;

  // Synced-field narrowing: only the current item type + structural
  // (non-convertible) blocks stay addable.
  if (itemTypeField) {
    const syncedType = containerBlock?.[itemTypeField];
    if (syncedType) {
      types = types.filter(
        (type) =>
          type === syncedType ||
          !blocksConfig?.[type]?.fieldMappings?.['@default'],
      );
    }
  }

  // Ancestor restriction: drop anything an ancestor disallows in its subtree.
  // Applied last so it composes with the synced-field narrowing.
  if (disallowedTypes) {
    const deny =
      disallowedTypes instanceof Set
        ? disallowedTypes
        : new Set(disallowedTypes);
    if (deny.size > 0) {
      types = types.filter((type) => !deny.has(type));
    }
  }

  return types;
}

// Cache for getBlockTypeSchema — keyed by blockType
const _typeSchemaCache = new Map();

/**
 * Get the default schema for a block type (with empty formData).
 * Runs blockSchema + schemaEnhancer with formData={}, so enhancers that add
 * fields unconditionally are included. Cached by blockType since the inputs
 * are always the same for a given type.
 *
 * @param {string} blockType - The block type ID
 * @param {Object} intl - The intl object from react-intl (optional; only needed for i18n schemas)
 * @param {Object} blocksConfig - The blocks config from registry
 * @returns {Object|null} - The default block schema or null
 */
export function getBlockTypeSchema(blockType, intl, blocksConfig) {
  if (!blockType) return null;
  if (!blocksConfig) throw new Error('getBlockTypeSchema requires blocksConfig');

  const cached = _typeSchemaCache.get(blockType);
  if (cached) return cached;

  const blockConfig = blocksConfig[blockType];
  if (!blockConfig) return null;

  const schemaSource = blockConfig.blockSchema || blockConfig.schema;
  let schema = null;

  if (schemaSource) {
    schema = typeof schemaSource === 'function'
      ? schemaSource({ formData: {}, data: {}, intl })
      : schemaSource;
  }

  if (!schema) {
    schema = {
      fieldsets: [{ id: 'default', title: 'Default', fields: [] }],
      properties: {},
      required: [],
    };
  } else if (!schema.fieldsets) {
    // Schema declares properties but no fieldsets — auto-create a default
    // fieldset listing all property names. Without this, properties exist
    // but Volto's form renderer (which iterates fieldsets[].fields) shows
    // nothing. Authors who want explicit ordering / multiple fieldsets
    // declare them themselves.
    schema = {
      ...schema,
      fieldsets: [{
        id: 'default',
        title: 'Default',
        fields: Object.keys(schema.properties || {}),
      }],
    };
  }

  if (typeof blockConfig.schemaEnhancer === 'function') {
    schema = blockConfig.schemaEnhancer({
      schema,
      formData: {},
      intl,
    });
  }

  const result = schema?.properties && Object.keys(schema.properties).length > 0
    ? schema
    : null;

  _typeSchemaCache.set(blockType, result);
  return result;
}

/**
 * Resolve the object_list idField for every block type ONCE, so the merge can stamp item ids
 * without re-walking schemas per block. Returns { blockType: { field: idField } }. The admin
 * builds this from blocksConfig; a frontend passes the same shape as a literal hint.
 */
export function buildIdFieldMap(blocksConfig, intl) {
  const map = {};
  for (const type of Object.keys(blocksConfig || {})) {
    let schema = null;
    try { schema = getBlockTypeSchema(type, intl, blocksConfig); } catch { schema = null; }
    for (const [field, def] of Object.entries(schema?.properties || {})) {
      if (def?.widget === 'object_list') {
        (map[type] || (map[type] = {}))[field] = def.idField || '@id';
      }
    }
  }
  return map;
}

/**
 * Get the full enhanced schema for a specific block instance.
 * Runs blockSchema + schemaEnhancer with the block's actual data.
 * The result depends on formData (e.g., selected variation), so it's NOT
 * cacheable by type alone — each block instance may produce a different schema.
 *
 * @param {string} blockType - The block type ID
 * @param {Object} intl - The intl object from react-intl (optional; only needed for i18n schemas)
 * @param {Object} blocksConfig - The blocks config from registry
 * @param {Object} formData - Block instance data passed to schemaEnhancer
 * @param {Object} [pageFormData] - Full page formData (passed to enhancer for ../field lookups etc.)
 * @param {string} [blockId] - This block's ID (passed to enhancer so it can look itself up in blockPathMap)
 * @param {Object} [blockPathMap] - Block path map (passed to enhancer for parent/sibling lookups)
 * @returns {Object|null} - The enhanced block schema or null
 */
export function getBlockSchema(blockType, intl, blocksConfig, formData, pageFormData, blockId, blockPathMap) {
  if (!blockType) return null;
  if (!blocksConfig) throw new Error('getBlockSchema requires blocksConfig');

  const blockConfig = blocksConfig[blockType];
  if (!blockConfig) return null;

  const schemaSource = blockConfig.blockSchema || blockConfig.schema;
  let schema = null;
  const effectiveFormData = formData || {};

  if (schemaSource) {
    schema = typeof schemaSource === 'function'
      ? schemaSource({ formData: effectiveFormData, data: effectiveFormData, intl })
      : schemaSource;
  }

  if (!schema) {
    schema = {
      fieldsets: [{ id: 'default', title: 'Default', fields: [] }],
      properties: {},
      required: [],
    };
  } else if (!schema.fieldsets) {
    // Schema declares properties but no fieldsets — auto-create a default
    // fieldset listing all property names. Without this, properties exist
    // but Volto's form renderer (which iterates fieldsets[].fields) shows
    // nothing. Authors who want explicit ordering / multiple fieldsets
    // declare them themselves.
    schema = {
      ...schema,
      fieldsets: [{
        id: 'default',
        title: 'Default',
        fields: Object.keys(schema.properties || {}),
      }],
    };
  }

  // Ensure nested widget: 'object' schemas also have fieldsets
  if (schema?.properties) {
    for (const fieldDef of Object.values(schema.properties)) {
      if (fieldDef?.widget === 'object' && fieldDef.schema?.properties && !fieldDef.schema.fieldsets) {
        fieldDef.schema = {
          ...fieldDef.schema,
          fieldsets: [{ id: 'default', title: 'Default', fields: [] }],
        };
      }
    }
  }

  // Run schemaEnhancer with instance data (skip recipe objects — only admin converts those)
  if (typeof blockConfig.schemaEnhancer === 'function') {
    schema = blockConfig.schemaEnhancer({
      schema,
      formData: effectiveFormData,
      intl,
      pageFormData,
      blockId,
      blockPathMap,
    });
  }

  return schema?.properties && Object.keys(schema.properties).length > 0
    ? schema
    : null;
}

/**
 * Compute page-level allowed block types from blocksConfig's `restricted` property.
 * A block is allowed at page level if restricted is false or if restricted(context) returns false.
 *
 * @param {Object} blocksConfig - Block configuration from registry
 * @param {Object} context - Context for restricted functions { properties, navRoot, contentType }
 * @returns {Array} Array of block type IDs allowed at page level
 */
export function getPageAllowedBlocksFromRestricted(blocksConfig, context = {}) {
  if (!blocksConfig) return null;

  const allowedTypes = [];
  for (const [blockType, blockConfig] of Object.entries(blocksConfig)) {
    // Skip blocks without proper config
    if (!blockConfig || !blockConfig.id) continue;

    const restricted = blockConfig.restricted;
    if (restricted === undefined || restricted === false) {
      // Not restricted - allowed at page level
      allowedTypes.push(blockType);
    } else if (typeof restricted === 'function') {
      // Dynamic restriction - evaluate with context
      try {
        const isRestricted = restricted({ ...context, block: blockConfig });
        if (!isRestricted) {
          allowedTypes.push(blockType);
        }
      } catch (e) {
        // If function throws, treat as restricted
        console.warn(`[BLOCKPATH] Error evaluating restricted for ${blockType}:`, e);
      }
    }
    // If restricted === true, block is not allowed at page level
  }
  return allowedTypes.length > 0 ? allowedTypes : null;
}

/**
 * Build a map of blockId -> path for all blocks in formData.
 * Uses unified traversal for both `widget: 'blocks_layout'` and `widget: 'object_list'` containers.
 *
 * @param {Object} formData - The form data with blocks
 * @param {Object} blocksConfig - Block configuration (must have _page registered for multiple page fields)
 * @param {Object} [intl={}] - The intl object from react-intl (optional; only needed for i18n schemas)
 * @returns {Object} Map of blockId -> { path: string[], parentId: string, region: string|null, isObjectListItem?, ... }
 *
 * Path format examples:
 * - Page block: ['blocks', 'text-1']
 * - Nested block: ['blocks', 'columns-1', 'columns', 'col-1', 'blocks', 'text-1a']
 * - Object list item: ['blocks', 'slider-1', 'slides', 0]
 * - Nested object list: ['blocks', 'table-1', 'table', 'rows', 0, 'cells', 1]
 *
 * Blocks all live in the shared `blocks` dict (so paths are under 'blocks');
 * a block's `region` records which list of blocks_layout it is ordered in
 * (e.g. 'items', 'footer').
 */
/**
 * Get the resolved schema for a block from its pathInfo entry.
 * Schemas are deduplicated in pathMap._schemas by content hash.
 * @param {Object} pathInfo - The block's pathMap entry
 * @param {Object} pathMap - The full pathMap (contains _schemas)
 * @returns {Object|null} The resolved block schema, or null
 */
export function getResolvedSchema(pathInfo, pathMap) {
  if (!pathInfo?._schemaRef || !pathMap?._schemas) return null;
  return pathMap._schemas[pathInfo._schemaRef] || null;
}

/**
 * Names of a schema's blocks fields — the properties with widget 'blocks_layout'.
 *
 * A container declares one blocks field per region; the field name IS the
 * region key inside the container's shared `blocks_layout` dict (the default
 * field is named 'items', e.g. `blocks_layout: { items: [...], footer: [...] }`).
 * Each field carries its own allowedBlocks / maxLength. A block is a container
 * precisely because it declares at least one such field — nothing is synthesised.
 *
 * @param {Object} schema - A resolved block/_page schema
 * @returns {string[]} The blocks-field names (region keys)
 */
export function getBlocksFieldNames(schema) {
  if (!schema?.properties) return [];
  return Object.keys(schema.properties).filter(
    (name) => schema.properties[name]?.widget === 'blocks_layout',
  );
}

// djb2 hash for schema deduplication
function _hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
  }
  return 's' + hash.toString(36);
}

export function buildBlockPathMap(formData, blocksConfig, intl = {}) {
  const pathMap = {};
  // Deduplicated schema store — most blocks of the same type share identical
  // resolved schemas. Storing once per unique schema instead of per-block
  // reduces postMessage payload dramatically (e.g., 2.5MB → ~200KB).
  pathMap._schemas = {};
  // Store a schema in the deduplicated _schemas map, return the ref key.
  // Extract text from React elements (JSX) recursively.
  // Schemas may have JSX in description fields (e.g., Image block's
  // alt.description). These capture React context refs that create
  // circular structures in JSON.stringify.
  const reactElementToText = (el) => {
    if (!el) return '';
    if (typeof el === 'string') return el;
    if (typeof el === 'number') return String(el);
    if (Array.isArray(el)) return el.map(reactElementToText).join('');
    if (el.$$typeof && el.props) {
      const children = el.props.children;
      return reactElementToText(children);
    }
    return '';
  };

  const storeSchema = (schema) => {
    if (!schema) return undefined;
    const str = JSON.stringify(schema, (key, value) => {
      if (typeof value === 'function') return undefined;
      // Convert React elements (JSX) to plain text
      if (value?.$$typeof) return reactElementToText(value);
      return value;
    });
    const key = _hashString(str);
    if (!pathMap._schemas[key]) {
      pathMap._schemas[key] = schema;
    }
    return key;
  };
  // Track created virtual containers for template instances
  const createdTemplateInstances = new Set();

  // Get page schema from _page block type (registered at INIT time)
  // This contains the blocks_layout container field (which may declare regions)
  const rootConfig = blocksConfig?.['_page'];
  // `blockSchema || schema`, function or plain object — the same convention
  // getBlockTypeSchema uses for every other type. Reading only `schema({intl})`
  // meant a `_page` that came from JSON (the offline gates read blocksConfig out
  // of a file, where a function cannot survive) silently fell back to the bare
  // default below, hiding the page's regions from everything outside a browser.
  const pageSchemaSource = rootConfig?.blockSchema || rootConfig?.schema;
  const pageSchema = (typeof pageSchemaSource === 'function'
    ? pageSchemaSource({ intl })
    : pageSchemaSource) || {
    // Fallback before INIT (e.g. ensureAllContainersHaveBlocks runs the path map
    // before the frontend's _page schema is registered): the default blocks
    // field is named 'items', so its data lives at blocks_layout.items.
    properties: { items: { widget: 'blocks_layout' } },
  };

  // Page blocks fields (schema properties with widget 'blocks_layout'). Each
  // field's list lives at formData.blocks_layout[fieldName] (shared dict).
  const pageFieldNames = getBlocksFieldNames(pageSchema);

  // Check if any page blocks field has data
  const hasAnyPageData = pageFieldNames.some(
    fieldName => formData?.blocks_layout?.[fieldName]?.length > 0,
  );
  if (!hasAnyPageData) {
    return pathMap;
  }

  // Compute default page-level allowed blocks from restricted (used when field doesn't specify allowedBlocks)
  const defaultPageAllowedBlocks = getPageAllowedBlocksFromRestricted(blocksConfig, { properties: formData });

  // Insert restriction logic for fixed block/item boundaries.
  // Can't insert between two adjacent fixed items, or at container edges next to a fixed item.
  function getInsertRestrictions(item, index, count, prevIsFixed, nextIsFixed) {
    const isFixed = item.fixed === true;
    const atStart = index === 0;
    const atEnd = index === count - 1;
    const hasNextPlaceholder = item.nextSlotId != null;
    return {
      canInsertBefore: !(isFixed && (atStart || prevIsFixed)),
      canInsertAfter: !(isFixed && (atEnd || nextIsFixed)) || hasNextPlaceholder,
    };
  }

  // Helper to find empty required fields for starter UI
  // Returns array of { fieldName, fieldDef } for required fields that are empty
  function getEmptyRequiredFields(blockData, schema) {
    if (!schema?.required || !schema?.properties) return null;

    const emptyFields = [];
    for (const fieldName of schema.required) {
      const fieldDef = schema.properties[fieldName];
      if (!fieldDef) continue;

      // Check if field is empty
      const fieldValue = blockData[fieldName];
      const isEmpty = !fieldValue ||
        (Array.isArray(fieldValue) && fieldValue.length === 0) ||
        (typeof fieldValue === 'string' && fieldValue === '');

      if (isEmpty) {
        // Strip functions from fieldDef for postMessage serialization
        emptyFields.push({ fieldName, fieldDef });
      }
    }
    return emptyFields.length > 0 ? emptyFields : null;
  }

  // Union an ancestor-inherited disallow Set with a block's own
  // `disallowDescendantBlocks`. Returns the SAME Set when `own` adds nothing (the
  // Set is treated as immutable — only extended by cloning), so unchanged
  // subtrees don't allocate.
  function unionDisallow(inherited, own) {
    if (!own || own.length === 0) return inherited || null;
    const next = new Set(inherited || []);
    for (const t of own) next.add(t);
    return next;
  }

  /**
   * Process container fields in an item (block or object_list item).
   * Scans schema for container fields and processes each one.
   * This is the single recursion point for all container types.
   *
   * `inheritedDisallow` is the Set of block types disallowed by this item's
   * ancestors (their `disallowDescendantBlocks`). We fold in this item's own
   * declaration to get the set that applies to its descendants, thread that into
   * every container processor (so their children's `allowedSiblingTypes` exclude
   * it), and record it on this item's entry for the type picker to reuse.
   *
   * `slateRules` is the slate style allow-list inherited from the containing
   * REGION (#295). Unlike the disallow set it is folded per FIELD, not per item
   * — each container processor folds its own field def onto what it was handed
   * before stamping the children — so a region can narrow or widen for its own
   * subtree. Threaded here so the fold is transitive down the whole tree.
   */
  function processItem(item, itemId, itemPath, schema, inheritedDisallow = null, slateRules = null) {
    if (!schema?.properties) return;

    const itemType = itemId === PAGE_BLOCK_UID ? '_page' : item?.['@type'];
    const disallow = unionDisallow(
      inheritedDisallow,
      itemType ? blocksConfig?.[itemType]?.disallowDescendantBlocks : null,
    );
    // Record the subtree disallow so the type picker (getBlockTypeChoices, which
    // reads a container's own field allowedBlocks directly) applies the SAME set
    // via the SAME helper, rather than re-deriving it.
    if (disallow && disallow.size > 0 && pathMap[itemId]) {
      pathMap[itemId].descendantDisallowedTypes = [...disallow];
    }

    Object.entries(schema.properties).forEach(([fieldName, fieldDef]) => {
      // Nested object widget (e.g., slateTable.table with widget: 'object')
      // Descend into the nested schema
      if (fieldDef.widget === 'object' && fieldDef.schema?.properties) {
        if (item[fieldName]) {
          processItem(item[fieldName], itemId, [...itemPath, fieldName], fieldDef.schema, disallow, slateRules);
        }
        return;
      }

      // Nested object property (legacy: has properties but no widget/type)
      if (fieldDef.properties && !fieldDef.widget && !fieldDef.type) {
        if (item[fieldName]) {
          processItem(item[fieldName], itemId, [...itemPath, fieldName], fieldDef, disallow, slateRules);
        }
        return;
      }

      // Container field - process its contents
      if (fieldDef.widget === 'blocks_layout') {
        processBlocksContainer(item, itemId, itemPath, fieldName, fieldDef, disallow, slateRules);
      } else if (fieldDef.widget === 'object_list') {
        // Use dataPath if provided to find data in a different location
        const dataPath = fieldDef.dataPath || [fieldName];
        let fieldData = item;
        for (const key of dataPath) {
          fieldData = fieldData?.[key];
        }
        if (fieldData) {
          processObjectListContainer(item, itemId, itemPath, fieldName, fieldDef, dataPath, disallow, slateRules);
        }
      }
    });

    // Also check for the implicit default blocks field (blocks_layout.items
    // without a schema definition) — Volto's built-in container blocks like Grid.
    // The default blocks field is named 'items'.
    const firstBlockId = Object.keys(item.blocks || {})[0];
    if (item.blocks && item.blocks_layout?.items && firstBlockId && !pathMap[firstBlockId]) {
      const blockType = item['@type'];
      const blockConfig = blocksConfig?.[blockType];
      processBlocksContainer(item, itemId, itemPath, 'items', {
        allowedBlocks: blockConfig?.allowedBlocks || null,
        maxLength: blockConfig?.maxLength || null,
      }, disallow, slateRules);
    }
  }

  /**
   * Process a widget: 'blocks_layout' container field.
   * Blocks are in shared parent.blocks dict; layout is parent[fieldName].items.
   */
  function processBlocksContainer(parent, parentId, parentPath, fieldName, fieldDef, disallow = null, inheritedSlateRules = null) {
    const blocks = parent.blocks;
    // `fieldName` is a blocks field (a schema field with widget 'blocks_layout');
    // its name is the key under the container's shared `blocks_layout` dict. So
    // the container field is always 'blocks_layout' and the region is the field
    // name (the default field is named 'items').
    const region = fieldName;
    const layout = parent.blocks_layout?.[region];
    if (!blocks || !Array.isArray(layout) || layout.length === 0) return;

    // Block-relative object prefix to the shared blocks dict + blocks_layout.
    // Empty when the blocks live directly on the owning block (the ordinary
    // case); [table] etc. when the blocks_layout is nested inside a
    // widget:'object' wrapper (#245). The ops navigate here via regionPath —
    // the blocks_layout analogue of object_list's dataPath.
    const ownerPath = pathMap[parentId]?.path || [];
    const regionPath = parentPath.slice(ownerPath.length);

    // Constraints come from the blocks field's own def, falling back to the
    // block-level config (the existing convention for Volto built-ins).
    const parentBlockConfig = blocksConfig?.[parent?.['@type']];
    const effectiveAllowedBlocks =
      fieldDef.allowedBlocks ?? parentBlockConfig?.allowedBlocks ?? null;
    const effectiveMaxLength =
      fieldDef.maxLength ?? parentBlockConfig?.maxLength ?? null;
    // Slate styles this region permits (#295). One object shared by every block
    // in the region — `foldSlateStyleRules` returns the inherited object by
    // reference when this field declares nothing, so an undeclaring frontend
    // pays nothing and the postMessage payload doesn't grow a copy per block.
    const regionSlateRules = foldSlateStyleRules(inheritedSlateRules, fieldDef);

    // First pass: collect fixed status for all blocks to determine insert restrictions
    const blockFixedStatus = {};
    layout.forEach(blockId => {
      const block = blocks[blockId];
      if (block) {
        blockFixedStatus[blockId] = block.fixed === true;
      }
    });

    layout.forEach((blockId, index) => {
      const block = blocks[blockId];
      if (!block) return;

      const blockPath = [...parentPath, 'blocks', blockId];
      const blockType = block['@type'];
      // Pass 1 uses the cached, GENERIC type schema (formData={}, enhancer
      // run with no instance context). One resolve per blockType — reused
      // across every instance — so a page with 150 slate blocks does the
      // slate schema work once rather than 150 times.
      //
      // Assumption: container-field metadata (widget: 'blocks_layout' /
      // 'object_list', their allowedBlocks / maxLength / idField / typeField
      // / dataPath / addMode) is STATIC per blockType — independent of the
      // instance's formData and of enhancer runs. Pass 1 only reads container
      // metadata; if an enhancer or a blockSchema factory varied container
      // fields based on instance data, pass 1 would miss it. Volto's blocks
      // honor this convention.
      //
      // Future optimization opportunities (left as TODOs since current cost
      // is acceptable):
      //   - Tag pathmap-aware enhancers (inheritSchemaFrom,
      //     hideParentOwnedFields, fieldRules-with-../) and have pass 2 skip
      //     untagged ones. Saves the per-block enhancer re-run for blocks
      //     whose enhancer doesn't actually depend on blockId/blockPathMap
      //     (e.g. slate's value-field enhancer).
      //   - Sync `_hideFields` from parent → child during data sync so
      //     hideParentOwnedFields becomes a pure formData enhancer with no
      //     pathmap dependency. Combined with the tag above, would drop
      //     pass 2 to a near-no-op.
      const blockSchema = getBlockTypeSchema(blockType, intl, blocksConfig);

      // Check Volto's standard block properties
      const isFixed = block.fixed === true;        // Volto standard: position locked
      const isReadonly = block.readOnly === true;  // Volto standard: content locked

      // Insert restrictions based on fixed block boundaries
      const prevBlockId = layout[index - 1];
      const nextBlockId = layout[index + 1];
      const { canInsertBefore, canInsertAfter } = getInsertRestrictions(
        block, index, layout.length,
        prevBlockId ? blockFixedStatus[prevBlockId] : false,
        nextBlockId ? blockFixedStatus[nextBlockId] : false,
      );

      // Template instance virtual container
      // Only FIRST-LEVEL template blocks get the virtual instance as parent
      // Nested blocks (inside containers that are part of the template) keep their actual parent
      let effectiveParentId = parentId;
      if (block.templateInstanceId) {
        const instanceId = block.templateInstanceId;

        // Check if parent container is also part of this template instance
        // If so, this is a nested block - keep actual parent
        const parentInSameInstance = parent.templateInstanceId === instanceId;

        if (!parentInSameInstance) {
          // First-level template block - create/use virtual instance as parent
          if (!createdTemplateInstances.has(instanceId)) {
            createdTemplateInstances.add(instanceId);

            // Derive display name from templateId path (e.g., "/templates/test-layout" -> "test-layout")
            const templatePath = block.templateId || '';
            const templateName = templatePath.split('/').filter(Boolean).pop() || 'unknown';

            // Nested: parent container belongs to the same template (different instanceId
            // because merge assigns new IDs to top-level but children keep original)
            const isNestedInTemplate = parent.templateId === block.templateId;

            const instanceBlockType = isNestedInTemplate
              ? 'Template blocks'
              : `Template: ${templateName}`;
            pathMap[instanceId] = {
              path: null, // Virtual - no actual storage path
              parentId, // Template instance's parent is the original container
              region, // The container field (region) this instance lives in
              blockType: instanceBlockType, // Virtual type for sidebar display
              isTemplateInstance: true,
              ...(isNestedInTemplate && { isNestedTemplateInstance: true }),
              templateId: block.templateId,
              // Virtual block data for components that need blockData (e.g., ParentBlocksWidget)
              blockData: { '@type': instanceBlockType, '@uid': instanceId },
              // Template instances can be moved/deleted as a unit (TODO: implement group operations)
            };
          }

          // Block's parent is the template instance, not the original container
          effectiveParentId = instanceId;
        }
      }

      pathMap[blockId] = {
        path: blockPath,
        parentId: effectiveParentId,
        region, // The container field (region) this block lives in
        ...(regionPath.length > 0 && { regionPath }), // object prefix to the blocks dict (#245)
        blockType, // Block type for uniform lookups (single source of truth)
        _schemaRef: storeSchema(blockSchema), // Deduplicated schema reference
        // A field's own allowedBlocks is authoritative at every level (same as the object_list
        // path). We deliberately do NOT intersect page-level fields against a page-wide allowed
        // set: that set is the UNION of all page regions' allowedBlocks, so it can't express
        // per-region restrictions (footer vs items may allow different blocks). effectiveAllowedBlocks
        // already IS the region's field def; the old intersection was a no-op (region ⊆ union).
        allowedSiblingTypes: addableSiblingTypes(
          effectiveAllowedBlocks || defaultPageAllowedBlocks,
          fieldDef.itemTypeField,
          parent,
          blocksConfig,
          disallow,
        ),
        allowedTemplates: fieldDef.allowedTemplates || null,
        ...(regionSlateRules && { slateRules: regionSlateRules }),
        maxSiblings: effectiveMaxLength,
        siblingCount: layout.length, // Total siblings in this container
        emptyRequiredFields: getEmptyRequiredFields(block, blockSchema),
        ...(isFixed && { isFixed: true }), // Fixed template blocks can't be moved/deleted
        ...(isReadonly && { isReadonly: true }), // Readonly template blocks can't be edited
        // Insert restrictions for fixed block boundaries
        ...(!canInsertBefore && { canInsertBefore: false }),
        ...(!canInsertAfter && { canInsertAfter: false }),
      };

      // RECURSE: process this block's container fields. `disallow` is the set
      // from this block's ancestors (parent + up); processItem folds in the
      // block's own disallowDescendantBlocks for its descendants.
      if (blockSchema) {
        processItem(block, blockId, blockPath, blockSchema, disallow, regionSlateRules);
      }
    });
  }

  /**
   * Process a widget: 'object_list' container field.
   * Items are stored as array with configurable ID field.
   * @param {Array} dataPath - Path to actual data location (defaults to [fieldName])
   */
  function processObjectListContainer(parent, parentId, parentPath, fieldName, fieldDef, dataPath = null, disallow = null, inheritedSlateRules = null) {
    // Navigate to actual data location using dataPath
    const effectiveDataPath = dataPath || [fieldName];
    let items = parent;
    for (const key of effectiveDataPath) {
      items = items?.[key];
    }

    // Handle both arrays and objects (Volto's form state can convert arrays to objects)
    let itemsArray;
    if (Array.isArray(items)) {
      itemsArray = items;
    } else if (items && typeof items === 'object') {
      // Convert object with numeric keys to array (e.g., {"0": {...}, "1": {...}})
      itemsArray = Object.values(items);
    } else {
      return;
    }

    const regionSlateRules = foldSlateStyleRules(inheritedSlateRules, fieldDef);
    const idField = fieldDef.idField || '@id';
    const itemSchema = fieldDef.schema;
    const typeField = fieldDef.typeField || null; // e.g., '@type' - which attribute stores the item's type
    const hasAllowedBlocks = !!fieldDef.allowedBlocks; // Typed items mode (multi-type container)

    // Compute virtual type for items in this container (used when no typeField/allowedBlocks)
    // Parent type is either a real block type or a virtual type (for nested object_list)
    const parentPathInfo = pathMap[parentId];
    const parentType = parentPathInfo?.blockType || parent['@type'];
    const virtualType = `${parentType}:${fieldName}`;

    // Track addMode for table-aware behavior
    // addMode comes from block config (e.g., blocksConfig.slateTable.addMode = 'table')
    // or from the field definition (e.g., fieldDef.addMode = 'table' on rows field)
    // - First-level items (rows) get addMode from block config or field def
    // - Second-level items (cells) get parentAddMode from their parent row
    const parentAddMode = parentPathInfo?.addMode || parentPathInfo?.parentAddMode || null;

    // Get addMode from block config or field definition
    // Check field definition first (works when nested inside widget: 'object' where parent['@type'] is absent)
    let addMode = fieldDef.addMode || null;
    if (!addMode && !parentPathInfo?.isObjectListItem) {
      // Parent is a real block - check its config for addMode
      const blockType = parent['@type'];
      const blockConfig = blocksConfig?.[blockType];
      addMode = blockConfig?.addMode || null;
    }

    // Block-relative path from the enclosing block to this array — what the mutation
    // ops navigate. The region's object-key PREFIX (the `/`-path object hops):
    // [] when the array is directly on the parent, ['table'] when it's inside a
    // `table` object wrapper (#245). Uniform with the blocks_layout regionPath —
    // the array itself is at [...regionPath, region]. A nested object_list item
    // (cells inside a row) is parent-relative, so its prefix is [].
    const regionPath = parentPathInfo?.isObjectListItem
      ? []
      : parentPath.slice((parentPathInfo?.path || []).length);

    itemsArray.forEach((item, index) => {
      const itemId = item[idField];
      if (!itemId) return;

      // Build path using numeric index (not string key) so getBlockByPath traversal works on arrays
      const itemPath = [...parentPath, ...effectiveDataPath, index];

      // Determine block type:
      // - If typeField is set, read type from item[typeField] (typed object_list)
      // - If typed mode and type missing, fall back to defaultBlockType (e.g., old data without @type)
      // - Otherwise, use virtual type like 'slateTable:rows' (single-schema object_list)
      const itemBlockType = typeField
        ? (getBlockType(item, typeField) || (hasAllowedBlocks && fieldDef.defaultBlockType) || virtualType)
        : virtualType;

      // Determine schema for this item:
      // - If allowedBlocks is set (typed mode), use blocksConfig schema (looked up via blockType)
      // - Otherwise, use shared itemSchema from field definition
      const effectiveItemSchema = hasAllowedBlocks
        ? null // Schema comes from blocksConfig via getBlockSchema(itemBlockType)
        : itemSchema;

      // Get block schema for typed items (for emptyRequiredFields check).
      // Same as the blocks_layout path: cached generic schema for pass 1
      // traversal; pass 2 below re-runs the enhancer with full args
      // (blockId/blockPathMap/instance formData) for the canonical schema.
      const blockSchema = hasAllowedBlocks
        ? getBlockTypeSchema(itemBlockType, intl, blocksConfig)
        : itemSchema;

      // Compute available actions based on table mode
      // Primary remove is hardcoded in DropdownMenu based on addDirection
      // These are ADDITIONAL actions beyond the primary
      let actions = null;
      if (addMode === 'table') {
        // First-level items in table mode (rows): insert row before/after
        // Primary remove (Remove Row) is hardcoded based on addDirection
        actions = {
          toolbar: ['addRowBefore', 'addRowAfter'],
          dropdown: [],
        };
      } else if (parentAddMode === 'table') {
        // Second-level items in table mode (cells): all insert actions + delete row
        // Primary remove (Remove Column) is hardcoded based on addDirection
        actions = {
          toolbar: ['addColumnBefore', 'addColumnAfter', 'addRowBefore', 'addRowAfter'],
          dropdown: ['deleteRow'], // Additional action: delete parent row
        };
      }

      // Check template properties on the item itself (same as regular blocks)
      const itemIsFixed = item.fixed === true;
      const itemIsReadonly = item.readOnly === true;

      // Insert restrictions based on fixed item boundaries
      const { canInsertBefore, canInsertAfter } = getInsertRestrictions(
        item, index, itemsArray.length,
        itemsArray[index - 1]?.fixed === true,
        itemsArray[index + 1]?.fixed === true,
      );

      pathMap[itemId] = {
        path: itemPath,
        parentId,
        region: fieldName, // The container field (region) — same concept as blocks fields
        blockType: itemBlockType, // Real type (from typeField) or virtual type (from parent:field)
        isObjectListItem: true,
        // `parent:field` is a SIDEBAR DISPLAY name, not a block type: nothing
        // registers it in blocksConfig and nothing renders it. Flag it so
        // consumers that treat `blockType` as a real `@type` (coverage
        // discovery) can tell the two apart — an untyped object_list item
        // (a table row/cell) only ever gets this label.
        ...(itemBlockType === virtualType && { isVirtualBlockType: true }),
        idField,
        ...(typeField && { typeField }), // Only set if typed object_list
        // A region-level `@type` RULE: a `when`-based fieldRule whose `set` is a
        // block-TYPE name, deciding each item's `@type` by position (e.g. a table
        // cell in a header row → `tableHeaderCell`). Carried onto every item so the
        // normalization pass can re-resolve + convert the item when its position
        // changes. Only meaningful for typed object_lists (an item must have an
        // `@type` to rewrite).
        ...(typeField && fieldDef.typeRule && { typeRule: fieldDef.typeRule }),
        ...(itemIsFixed && { isFixed: true }),
        ...(itemIsReadonly && { isReadonly: true }),
        ...(!canInsertBefore && { canInsertBefore: false }),
        ...(!canInsertAfter && { canInsertAfter: false }),
        _schemaRef: storeSchema(blockSchema), // Deduplicated schema reference
        itemSchema: effectiveItemSchema, // null for typed items (schema from blocksConfig)
        ...(regionPath.length > 0 && { regionPath }), // object prefix to the array (#245); array at [...regionPath, region]
        allowedSiblingTypes: hasAllowedBlocks
          ? addableSiblingTypes(
              fieldDef.allowedBlocks,
              fieldDef.itemTypeField,
              parent,
              blocksConfig,
              disallow,
            )
          : [virtualType],
        ...(regionSlateRules && { slateRules: regionSlateRules }),
        maxSiblings: fieldDef.maxLength || null,
        siblingCount: itemsArray.length,
        addMode, // Table mode for this container (e.g., rows)
        parentAddMode, // Inherited from parent (e.g., cells inherit 'table' from rows)
        actions, // Available actions for toolbar/dropdown
        emptyRequiredFields: getEmptyRequiredFields(item, blockSchema),
      };

      // RECURSE: process this item's container fields (same pattern!). Thread
      // the ancestor disallow set through, like the blocks_layout path.
      const recurseSchema = hasAllowedBlocks ? blockSchema : itemSchema;
      if (recurseSchema) {
        processItem(item, itemId, itemPath, recurseSchema, disallow, regionSlateRules);
      }
    });
  }

  // Add entry for the page itself (PAGE_BLOCK_UID virtual block)
  // This allows getBlockById, getParentChain, etc. to handle PAGE_BLOCK_UID consistently
  pathMap[PAGE_BLOCK_UID] = {
    path: [],
    parentId: null, // Page has no parent
    region: null, // Page is not itself a container child
    blockType: '_page',
    _schemaRef: storeSchema(pageSchema),
  };

  // PASS 1: structural traversal
  // Walks the tree using the cached, GENERIC type schema (`getBlockTypeSchema`,
  // formData={}) for every block. That's enough to find container fields and
  // seed pathMap entries (parentId, path, blockType, allowedSiblingTypes,
  // canInsertBefore/After, _schemaRef, emptyRequiredFields). Pass 2 below
  // overwrites _schemaRef and emptyRequiredFields with instance-aware
  // schemas for blocks that have a schemaEnhancer.
  processItem(formData, PAGE_BLOCK_UID, [], pageSchema);

  // PASS 2: re-enhance schemas with full blockId + blockPathMap context
  // Now that pass 1 has built the structural pathMap, run each block's
  // schemaEnhancer again with { blockId, blockPathMap, pageFormData } in args.
  // This lets enhancers like inheritSchemaFrom and hideParentOwnedFields
  // resolve parent/sibling state from the pathMap directly — without falling
  // back to the global hydraContext singleton.
  //
  // Skip entries that don't have a real blocksConfig entry (template
  // instances, virtual object_list types, _page) — pass 1's schema is
  // authoritative for those.
  for (const [blockId, pathInfo] of Object.entries(pathMap)) {
    if (blockId === '_schemas') continue;
    if (blockId === PAGE_BLOCK_UID) continue;
    if (pathInfo.isTemplateInstance) continue;
    if (!pathInfo.path) continue;

    const { blockType } = pathInfo;
    const blockConfig = blocksConfig?.[blockType];
    // No config or no enhancer → nothing to re-do. A non-typed object_list item's
    // virtual type is REGISTERED into blocksConfig at mint time (see
    // registerVirtualType), so its inline schemaEnhancer is found here by name —
    // the same path as a real typed block.
    if (!blockConfig || typeof blockConfig.schemaEnhancer !== 'function') continue;

    // Look up block data via path
    let blockData = formData;
    for (const key of pathInfo.path) {
      if (blockData == null) break;
      blockData = blockData[key];
    }
    if (!blockData) continue;

    const enhancedSchema = getBlockSchema(
      blockType,
      intl,
      blocksConfig,
      blockData,
      formData, // pageFormData
      blockId, // blockId in enhancer args
      pathMap, // full pathMap in enhancer args
    );
    if (!enhancedSchema) continue;

    pathInfo._schemaRef = storeSchema(enhancedSchema);
    pathInfo.emptyRequiredFields = getEmptyRequiredFields(blockData, enhancedSchema);
  }

  return pathMap;
}
