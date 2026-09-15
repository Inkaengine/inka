/**
 * Utilities for working with nested block paths in Volto Hydra.
 * Supports container blocks where blocks can be nested inside other blocks.
 */

import {
  getApplyBlockDefaults,
  getDefaultBlockType,
} from './injectedVoltoConfig.js';
import { PAGE_BLOCK_UID } from '@volto-hydra/hydra-js';
import {
  isBlockReadonly,
  isBlockPositionLocked,
  getChildBlockEntries,
  setChildBlockEntries,
  getBlockType,
  setBlockType,
  clearBlockType,
  getAtPath,
  ensureMutablePath,
} from '@volto-hydra/helpers';
import {
  buildBlockPathMap as _buildBlockPathMap,
  getBlockTypeSchema,
  getBlockSchema,
  getPageAllowedBlocksFromRestricted,
  getResolvedSchema,
  buildIdFieldMap,
} from '../../../hydra-js/buildBlockPathMap.js';
// From the dep-free slateMerge (NOT slateTransforms) so the offline block-path
// evaluator's esbuild bundle stays free of @plone/volto-slate / registry.
import { mergeBlockValues } from './slateMerge.js';

/**
 * Extract text content from a React element (JSX).
 * React elements have $$typeof: Symbol(react.element), props.children contains content.
 * Returns the concatenated text of all children, recursively.
 */
function jsxToText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(jsxToText).join('');
  if (
    typeof node === 'object' &&
    node.$$typeof &&
    typeof node.$$typeof === 'symbol'
  ) {
    return jsxToText(node.props?.children);
  }
  return '';
}

/**
 * Strip non-serializable values from an object for postMessage.
 * Removes functions, Symbols, and React elements ($$typeof: Symbol).
 * ONLY call this when sending data to the iframe — never for local storage.
 * @param {any} obj - Object to strip
 * @param {WeakSet} seen - Set of already-seen objects (circular reference detection)
 * @returns {any} - Object with non-serializable values removed
 */
function stripFunctionsFromSchema(obj, seen = new WeakSet()) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'function') return undefined;
  if (typeof obj === 'symbol') return undefined;
  if (typeof obj !== 'object') return obj;

  // React elements ($$typeof: Symbol(react.element)) — convert to text content
  // instead of removing, so field descriptions survive as plain strings
  if (obj.$$typeof && typeof obj.$$typeof === 'symbol') return jsxToText(obj);

  // Handle circular references
  if (seen.has(obj)) return undefined;
  seen.add(obj);

  if (Array.isArray(obj)) {
    return obj
      .map((item) => stripFunctionsFromSchema(item, seen))
      .filter((item) => item !== undefined);
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const stripped = stripFunctionsFromSchema(value, seen);
    if (stripped !== undefined) {
      result[key] = stripped;
    }
  }
  return result;
}

/**
 * Strip non-serializable values from a blockPathMap before sending via postMessage.
 * Call this ONLY at the point of sending to the iframe, not when building/storing the map.
 * @param {Object} blockPathMap - The blockPathMap to strip
 * @returns {Object} - New blockPathMap with non-serializable values removed from schemas
 */
export function stripBlockPathMapForPostMessage(blockPathMap) {
  // Strip functions from schemas and re-hash since stripping changes content.
  // The _schemas store was built with pre-stripped schemas in buildBlockPathMap;
  // after stripping, identical schemas may hash differently, so we rebuild.
  const strippedSchemas = {};
  const refMap = {}; // old ref → new ref

  // First pass: strip and re-hash all schemas
  if (blockPathMap._schemas) {
    for (const [oldRef, schema] of Object.entries(blockPathMap._schemas)) {
      const stripped = stripFunctionsFromSchema(schema);
      const str = JSON.stringify(stripped);
      // djb2 hash
      let hash = 5381;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
      }
      const newRef = 's' + hash.toString(36);
      refMap[oldRef] = newRef;
      if (!strippedSchemas[newRef]) {
        strippedSchemas[newRef] = stripped;
      }
    }
  }

  // Second pass: strip entries and update refs
  const result = { _schemas: strippedSchemas };
  for (const [key, value] of Object.entries(blockPathMap)) {
    if (key === '_schemas') continue;
    const stripped = stripFunctionsFromSchema(value);
    if (stripped?._schemaRef && refMap[stripped._schemaRef]) {
      stripped._schemaRef = refMap[stripped._schemaRef];
    }
    result[key] = stripped;
  }
  return result;
}

// getBlockTypeSchema, getBlockSchema, getPageAllowedBlocksFromRestricted are imported
// from buildBlockPathMap.js (Volto-free shared module) above.
export {
  getBlockTypeSchema,
  getBlockSchema,
  getResolvedSchema,
  buildIdFieldMap,
};

/**
 * Get items array from a container (works for both object_list and blocks containers).
 *
 * Thin shim over the public reader getChildBlockEntries so there is ONE storage-agnostic
 * read implementation shared by the admin and the template merge. Preserves this
 * function's return shape: block OBJECTS for object_list, block IDs for blocks_layout.
 *
 * @param {Object} parentBlock - The parent block containing the container
 * @param {Object} containerConfig - Container configuration with fieldName, isObjectList, dataPath
 * @returns {Array} The items array (copy for object_list, items array for blocks)
 */
export function getContainerItems(parentBlock, containerConfig) {
  const entries = getChildBlockEntries(parentBlock, containerConfig);
  return containerConfig.isObjectList
    ? entries.map((e) => e.block)
    : entries.map((e) => e.id);
}

/**
 * Reorder items in a container by ID list.
 * For object_list: finds items by idField and returns them in new order
 * For blocks: just returns the newOrder as-is (IDs are the items)
 * @param {Array} items - Current items from getContainerItems
 * @param {Array<string>} newOrder - New order of item IDs
 * @param {Object} containerConfig - Container configuration
 * @returns {Array} Reordered items
 */
function reorderContainerItems(items, newOrder, containerConfig) {
  if (containerConfig.isObjectList) {
    const idField = containerConfig.idField || '@id';
    return newOrder
      .map((id) => items.find((item) => item[idField] === id))
      .filter(Boolean);
  }
  return newOrder;
}

/**
 * Set items array on a container (returns updated parent block — immutable).
 *
 * Thin shim over the public writer setChildBlockEntries so there is ONE storage-agnostic
 * write implementation shared by the admin and the template merge. For blocks_layout the
 * admin owns the shared dict (blocksObj already reflects adds/deletes), so items are ids
 * and `block` is omitted — the writer just sets this region's id list and preserves
 * sibling regions. For object_list, items are the block objects.
 *
 * @param {Object} parentBlock - The parent block containing the container
 * @param {Object} containerConfig - Container configuration
 * @param {Array} items - New items array (block objects for object_list, ids for blocks)
 * @param {Object} [blocksObj] - For blocks containers, the blocks object to set
 * @returns {Object} Updated parent block
 */
/**
 * Navigate to the object that actually holds a blocks_layout region's shared
 * `blocks` dict + `blocks_layout`. Usually the parent block itself; for a
 * blocks_layout nested inside a widget:'object' wrapper (#245) it's the object
 * at `regionPath` (e.g. parentBlock.table). Read-only — returns the live node.
 */
function getRegionContainer(parentBlock, regionPath) {
  return getAtPath(parentBlock, regionPath) || parentBlock;
}

function setContainerItems(
  parentBlock,
  containerConfig,
  items,
  blocksObj = null,
) {
  const { isObjectList, idField = '@id', regionPath } = containerConfig;
  const updatedParent = { ...parentBlock };
  if (!isObjectList) {
    // Full-dict replace at the region's blocks dict, which may live under a
    // widget:'object' wrapper (regionPath, e.g. [table]). Clone each level;
    // setChildBlockEntries below re-navigates the same path and spreads this
    // clone, so the dict written here survives alongside the blocks_layout.
    const container = ensureMutablePath(updatedParent, regionPath);
    container.blocks = blocksObj || container.blocks;
  }
  const entries = isObjectList
    ? items.map((block) => ({ id: block[idField], block }))
    : items.map((id) => ({ id }));
  setChildBlockEntries(updatedParent, containerConfig, entries);
  return updatedParent;
}

/**
 * List the children of a container as storage-agnostic descriptors.
 *
 * The single read accessor for "what blocks are in this container" — callers
 * pass a containerConfig descriptor (from getContainerFieldConfig /
 * getAllContainerFields) and get back ordered `{ id, type, data }` entries,
 * without knowing whether the container is a blocks_layout region (ids in a
 * shared `blocks` dict) or an object_list (inline item array), or which region
 * / dataPath the items live at. Storage shape stays inside this module.
 *
 * Presentation (titles, icons) is intentionally left to the caller.
 *
 * @param {Object} parentBlock - The block (or page formData) holding the container
 * @param {Object} containerConfig - { fieldName, region?, isObjectList?, dataPath?, idField?, typeField? }
 * @returns {Array<{id: string, type: string, data: Object}>}
 */
export function listContainerChildren(parentBlock, containerConfig) {
  const items = getContainerItems(parentBlock, containerConfig);

  if (containerConfig.isObjectList) {
    const idField = containerConfig.idField || '@id';
    const typeField = containerConfig.typeField || null;
    return items.map((item) => ({
      id: (idField && item[idField]) || item.key || item['@id'],
      type: getBlockType(item, typeField) || 'object_list_item',
      data: item,
    }));
  }

  const blocksData = parentBlock?.blocks || {};
  return items.map((id) => ({
    id,
    type: blocksData[id]?.['@type'] || 'unknown',
    data: blocksData[id],
  }));
}

/**
 * Build a map of blockId -> path for all blocks in formData.
 * Delegates to the Volto-free implementation in buildBlockPathMap.js,
 * forwarding the intl object for i18n schema support.
 *
 * @param {Object} formData - The form data with blocks
 * @param {Object} blocksConfig - Block configuration from registry
 * @param {Object} intl - The intl object from react-intl (required for i18n schemas)
 * @returns {Object} Map of blockId -> { path: string[], parentId: string, region: string|null, isObjectListItem?, ... }
 */
export function buildBlockPathMap(formData, blocksConfig, intl) {
  if (!intl) {
    throw new Error('buildBlockPathMap requires intl parameter');
  }
  return _buildBlockPathMap(formData, blocksConfig, intl);
}

/**
 * Get a block by its path.
 * @param {Object} formData - The form data
 * @param {Array} path - Path array like ['blocks', 'columns-1', 'columns', 'col-1']
 *                       Empty path returns formData (for page-level access)
 * @returns {Object|undefined} The block data or undefined if not found
 */
export function getBlockByPath(formData, path) {
  // Empty path means page-level (return formData itself)
  if (!path || path.length === 0) return formData;

  let current = formData;
  for (const key of path) {
    if (current === undefined || current === null) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Set a block value by its path, returning new formData (immutable update).
 * @param {Object} formData - The form data
 * @param {Array} path - Path array like ['blocks', 'columns-1', 'columns', 'col-1']
 * @param {Object} value - New block value
 * @returns {Object} New formData with the block updated
 */
export function setBlockByPath(formData, path, value) {
  // Empty path means replace root - return value directly
  if (!path || path.length === 0) return value;

  // Immutable deep-set with structural sharing (dep-free — no immer): clone each
  // node along the path (so the tree keeps referential identity everywhere the
  // update didn't touch) and assign the leaf. Intermediate nodes are expected to
  // exist (paths come from blockPathMap); a missing one surfaces loudly.
  const root = Array.isArray(formData) ? [...formData] : { ...formData };
  let current = root;
  for (const key of path.slice(0, -1)) {
    const next = current[key];
    if (next === undefined || next === null) {
      // Same failure immer's produce raised implicitly (set-on-undefined) — a
      // path from blockPathMap should always exist; surface the bad path.
      throw new Error(
        `[HYDRA] setBlockByPath: missing intermediate '${key}' in path ${path.join('.')}`,
      );
    }
    current[key] = Array.isArray(next) ? [...next] : { ...next };
    current = current[key];
  }
  current[path[path.length - 1]] = value;
  return root;
}

/**
 * Get a block using blockPathMap lookup with fallback.
 * @param {Object} formData - The form data
 * @param {Object} blockPathMap - Map of blockId -> { path, parentId }
 * @param {string} blockId - Block ID to find
 * @returns {Object|undefined} Block data or undefined
 */
export function getBlockById(formData, blockPathMap, blockId) {
  const pathInfo = blockPathMap?.[blockId];
  if (!pathInfo?.path) {
    // Virtual blocks (like template instances) have blockData in pathMap instead of formData
    return pathInfo?.blockData;
  }
  const block = getBlockByPath(formData, pathInfo.path);
  // For typed object_list items missing @type (e.g., old slider data without @type
  // that resolves via defaultBlockType), inject the resolved blockType so that
  // consumers like withBlockExtensions can find the correct block config.
  if (
    block &&
    !block['@type'] &&
    pathInfo.isObjectListItem &&
    pathInfo.typeField
  ) {
    return { ...block, '@type': pathInfo.blockType };
  }
  return block;
}

/**
 * Update a block using blockPathMap lookup with fallback.
 * @param {Object} formData - The form data
 * @param {Object} blockPathMap - Map of blockId -> { path, parentId }
 * @param {string} blockId - Block ID to update
 * @param {Object} newBlockData - New block data
 * @returns {Object} New formData with block updated
 */
export function updateBlockById(formData, blockPathMap, blockId, newBlockData) {
  const pathInfo = blockPathMap?.[blockId];
  if (!pathInfo?.path) {
    throw new Error(`Block ${blockId} not found in blockPathMap`);
  }
  return setBlockByPath(formData, pathInfo.path, newBlockData);
}

/**
 * Get all child block IDs whose parent is the given block.
 * Uses blockPathMap's parentId tracking to find direct children.
 *
 * @param {string} parentId - The parent block ID
 * @param {Object} blockPathMap - Map of blockId -> { path, parentId, ... }
 * @returns {string[]} Array of child block IDs
 */
export function getChildBlockIds(parentId, blockPathMap) {
  const childIds = [];
  for (const [blockId, pathInfo] of Object.entries(blockPathMap || {})) {
    if (pathInfo.parentId === parentId) {
      childIds.push(blockId);
    }
  }
  return childIds;
}

/**
 * The container field (region) a child block lives in.
 *
 * blocks-layout fields and object_list fields are the same concept — a named
 * "region" (the schema field name) holding an ordered list of blocks. Both
 * record it in `region`; storage (the shared blocks_layout dict vs an inline
 * array) is an orthogonal detail the funnel handles. Callers should never
 * branch on storage — use this for "which region is this child in".
 *
 * @param {string} blockId
 * @param {Object} blockPathMap
 * @returns {string|undefined} The region (schema field name), or undefined
 */
export function getChildField(blockId, blockPathMap) {
  return blockPathMap?.[blockId]?.region;
}

/**
 * Child block IDs of `parentId` that live in a specific region (container
 * field), regardless of blocks-layout vs object_list storage.
 *
 * @param {string} parentId
 * @param {string} region - The region / container-field name (schema property)
 * @param {Object} blockPathMap
 * @returns {string[]}
 */
export function getChildBlockIdsInField(parentId, region, blockPathMap) {
  return getChildBlockIds(parentId, blockPathMap).filter(
    (id) => getChildField(id, blockPathMap) === region,
  );
}

/**
 * Get the container field configuration for a nested block.
 * Returns the allowedBlocks, defaultBlockType, etc. from the parent's schema.
 *
 * @param {string} blockId - The block ID to check
 * @param {Object} blockPathMap - Map of blockId -> { path, parentId }
 * @param {Object} formData - The form data
 * @param {Object} blocksConfig - Block configuration from registry
 * @param {Object} intl - The intl object from react-intl
 * @returns {Object|null} Container field config { fieldName, allowedBlocks, defaultBlockType, maxLength, parentId } or null if page-level
 */
export function getContainerFieldConfig(
  blockId,
  blockPathMap,
  formData,
  blocksConfig,
  intl,
) {
  const pathInfo = blockPathMap?.[blockId];
  if (!pathInfo) {
    return null;
  }

  let parentId = pathInfo.parentId;
  // The container field (region) this block lives in — same concept for blocks
  // and object_list. It is the schema property name.
  const region = pathInfo.region || 'items';
  // Object prefix to the region's blocks dict when the blocks_layout is nested
  // inside a widget:'object' wrapper (#245); [] for the ordinary block-root case.
  const regionPath = pathInfo.regionPath || [];

  // If parent is a virtual template instance, use the instance's parent for storage operations
  // Template blocks are stored flat, so the actual container is the instance's parent
  const parentPathInfo = blockPathMap[parentId];
  if (parentPathInfo?.isTemplateInstance) {
    parentId = parentPathInfo.parentId;
  }

  const schema = getResolvedSchema(blockPathMap[parentId], blockPathMap);
  const fieldDef = schema?.properties?.[region];

  // For object_list items, we already have most info in pathInfo
  if (pathInfo.isObjectListItem) {
    return {
      region,
      parentId,
      allowedBlocks: pathInfo.allowedSiblingTypes,
      defaultBlockType: pathInfo.blockType,
      maxLength: pathInfo.maxSiblings,
      isObjectList: true,
      itemSchema: pathInfo.typeField ? null : pathInfo.itemSchema, // stored on pathInfo (nesting-safe); null for typed items
      itemIndex: pathInfo.path[pathInfo.path.length - 1], // Last element is index
      idField: pathInfo.idField,
      typeField: pathInfo.typeField || null, // Attribute name for item type (typed object_list)
      regionPath: pathInfo.regionPath || [], // object prefix; array at [...regionPath, region]
      addMode: pathInfo.addMode || null, // Table mode for this container
      parentAddMode: pathInfo.parentAddMode || null, // Inherited from parent
    };
  }

  // For standard blocks (including page-level), look up container config from schema
  const parentBlock =
    parentId === PAGE_BLOCK_UID
      ? formData
      : getBlockById(formData, blockPathMap, parentId);

  if (!parentBlock) {
    console.log(
      '[BLOCKPATH] getContainerFieldConfig: parentBlock not found for',
      parentId,
    );
    return null;
  }

  const parentType = blockPathMap[parentId]?.blockType;
  const parentConfig = blocksConfig?.[parentType];

  // Check schema-defined blocks field (looked up by region = schema field name).
  // For a blocks_layout nested in a widget:'object', walk the schema through the
  // object wrappers (regionPath) before the region lookup, and carry regionPath
  // so the ops navigate to the object's own blocks dict.
  if (schema?.properties) {
    let regionSchema = schema;
    for (const key of regionPath) {
      regionSchema = regionSchema?.properties?.[key]?.schema;
    }
    const regionFieldDef = regionSchema?.properties?.[region];
    if (regionFieldDef?.widget === 'blocks_layout') {
      return {
        region,
        parentId,
        ...(regionPath.length > 0 && { regionPath }),
        ...resolveRegionConstraints(
          regionFieldDef,
          parentConfig,
          getPageDefaults(blocksConfig, formData),
        ),
      };
    }
  }

  // Fallback: Check for implicit container (blocks/blocks_layout)
  // This handles blocks like gridBlock that have a schema but use implicit blocks/blocks_layout
  const hasBlocks = !!parentBlock.blocks;
  const includesBlock = parentBlock.blocks_layout?.[region]?.includes(blockId);
  if (hasBlocks && includesBlock) {
    return {
      region,
      parentId,
      ...resolveRegionConstraints(
        null,
        parentConfig,
        getPageDefaults(blocksConfig, formData),
      ),
    };
  }

  return null;
}

/**
 * Get the ID of the adjacent sibling to select after deleting a block from its container.
 * Returns previous sibling if available, otherwise next sibling, otherwise the parent.
 *
 * Works consistently for both page-level blocks and container children.
 *
 * @param {string} blockId - The block being deleted
 * @param {Object} containerConfig - Container config from getContainerFieldConfig
 * @param {Object} blockPathMap - Map of blockId -> { path, parentId }
 * @param {Object} formData - The form data
 * @returns {string|null} ID of the block to select after deletion
 */
export function getSelectAfterDelete(
  blockId,
  containerConfig,
  blockPathMap,
  formData,
) {
  if (!containerConfig) return null;

  const { parentId, isObjectList } = containerConfig;

  const parentPath =
    parentId === PAGE_BLOCK_UID ? [] : blockPathMap[parentId]?.path;
  const parentBlock = getBlockByPath(formData, parentPath);
  if (!parentBlock) return parentId !== PAGE_BLOCK_UID ? parentId : null;

  const items = getContainerItems(parentBlock, containerConfig);

  if (isObjectList) {
    const idField = containerConfig.idField || '@id';
    const index = items.findIndex((item) => item[idField] === blockId);
    if (index === -1) return parentId !== PAGE_BLOCK_UID ? parentId : null;
    // If more than one item, pick adjacent sibling
    if (items.length > 1) {
      const adjacentItem = index > 0 ? items[index - 1] : items[index + 1];
      return adjacentItem[idField];
    }
    // Last item — select parent (unless page-level)
    return parentId !== PAGE_BLOCK_UID ? parentId : null;
  }

  // blocks_layout container: items are string IDs
  const index = items.indexOf(blockId);
  if (index === -1) return parentId !== PAGE_BLOCK_UID ? parentId : null;
  if (items.length > 1) {
    return index > 0 ? items[index - 1] : items[index + 1];
  }
  return parentId !== PAGE_BLOCK_UID ? parentId : null;
}

/**
 * Get ALL container fields for a block (supports multiple container fields).
 * Returns both schema-defined container fields (widget: 'blocks_layout') and implicit containers.
 *
 * @param {string} blockId - The block ID to check
 * @param {Object} blockPathMap - Map of blockId -> { path, parentId }
 * @param {Object} formData - The form data
 * @param {Object} blocksConfig - Block configuration from registry
 * @param {Object} intl - The intl object from react-intl
 * @param {string[]} templateEditMode - The unlocked template instance ids
 * @returns {Array} Array of container field configs [{ fieldName, title, allowedBlocks, allowedTemplates, defaultBlockType, maxLength, currentCount, canAdd }]
 */
export function getAllContainerFields(
  blockId,
  blockPathMap,
  formData,
  blocksConfig,
  intl,
  templateEditMode = [],
) {
  const pathInfo = blockPathMap?.[blockId];

  // Special handling for virtual template instances
  // Template instances don't have a schema, but they contain child blocks
  // tracked via parentId in the pathMap
  if (pathInfo?.isTemplateInstance) {
    // Find all direct children of this template instance
    const childIds = Object.entries(blockPathMap)
      .filter(([, info]) => info.parentId === blockId)
      .map(([id]) => id);

    if (childIds.length > 0) {
      return [
        {
          region: 'blocks', // Virtual region for template children
          title: 'Blocks',
          isTemplateInstance: true,
          // Template children are managed specially - no add button for now
          allowedBlocks: null,
          defaultBlockType: null,
          maxLength: null,
          currentCount: childIds.length,
          canAdd: false, // Template instances don't support adding via sidebar
        },
      ];
    }
    return [];
  }

  // For page-level (blockId is PAGE_BLOCK_UID), use _page schema and formData as the block
  const block =
    blockId === PAGE_BLOCK_UID
      ? formData
      : getBlockById(formData, blockPathMap, blockId);
  if (!block) return [];

  // Check if parent block is readonly (can't add to readonly containers)
  const parentIsReadonly = isBlockReadonly(block, templateEditMode);

  const blockType = blockId === PAGE_BLOCK_UID ? '_page' : pathInfo?.blockType;
  if (!blockType) return [];
  const schema = getResolvedSchema(pathInfo, blockPathMap);

  // Compute default allowed blocks (used when field doesn't specify allowedBlocks)
  const blockConfig = blocksConfig?.[blockType];
  const defaultAllowedBlocks = getPageAllowedBlocksFromRestricted(
    blocksConfig,
    { properties: formData },
  );
  // Page-level defaultBlockType — used as the empty-block fallback when a
  // container inherits its allowedBlocks from page-level (i.e. doesn't
  // restrict types). Without this a generic section would auto-fill its
  // empty state with the 'empty' picker placeholder, even though the
  // container is happy to accept the page's typing-friendly default.
  const pageDefaultBlockType = getDefaultBlockType();

  // Helper to get current count for a container field
  const getFieldCount = (region, isObjectList = false, regionPath = []) => {
    if (isObjectList) {
      // object_list: the array lives at [...regionPath, region]
      const data = getAtPath(block, [...regionPath, region]);
      return Array.isArray(data) ? data.length : 0;
    }
    // blocks container: the region is a key in the shared blocks_layout dict
    // on the node at regionPath (block root when empty).
    return getAtPath(block, regionPath)?.blocks_layout?.[region]?.length || 0;
  };

  const containerFields = [];

  // A block's container fields are its schema-declared blocks_layout / object_list fields. If it
  // declares none but is still a container (implicit — has blocks/blocks_layout, or its config
  // carries allowedBlocks/defaultBlockType), the default region is a blocks_layout named 'items'.
  // Synthesize that single field so it flows through the SAME loop below — the implicit case is
  // a default region, not a different code path.
  // Collect container fields, descending transparently through widget:'object'
  // wrappers (the same way buildBlockPathMap's processItem does). A container
  // nested inside an object — e.g. `rows` inside a `table` object — is block-
  // relative at [...objectPath, fieldName], exactly the dataPath the pathMap
  // stores, so the ops navigate it without any config-level dataPath.
  // Title-case a schema field name for display (the object wrapper's own label
  // when it declares no title): 'table' → 'Table'.
  const titleize = (name) =>
    name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
  const collectContainerFields = (properties, objectPath, titlePath) => {
    const out = [];
    for (const [fieldName, fd] of Object.entries(properties || {})) {
      if (fd.widget === 'object' && fd.schema?.properties) {
        out.push(
          ...collectContainerFields(
            fd.schema.properties,
            [...objectPath, fieldName],
            [...titlePath, fd.title || titleize(fieldName)],
          ),
        );
      } else if (fd.widget === 'blocks_layout' || fd.widget === 'object_list') {
        out.push([fieldName, fd, objectPath, titlePath]);
      }
    }
    return out;
  };
  let fieldEntries = collectContainerFields(schema?.properties, [], []);
  if (fieldEntries.length === 0) {
    const isImplicitContainer =
      (block.blocks && block.blocks_layout?.items) ||
      blockConfig?.allowedBlocks ||
      blockConfig?.defaultBlockType;
    if (isImplicitContainer)
      fieldEntries = [['items', { widget: 'blocks_layout' }, [], []]];
  }

  // Prefix a nested container's display title with its object path so the
  // sidebar shows the nesting (e.g. "Table / Rows", "Content / Body"). Top-level
  // fields (empty titlePath) are shown as-is.
  const prefixTitle = (baseTitle, titlePath) =>
    titlePath.length > 0 ? [...titlePath, baseTitle].join(' / ') : baseTitle;

  for (const [fieldName, fieldDef, objectPath, titlePath] of fieldEntries) {
    if (fieldDef.widget === 'blocks_layout') {
      // A blocks field. Its name IS the region key inside the shared
      // blocks_layout dict; the data container field is always 'blocks_layout'.
      // Each blocks field has its own allowedBlocks / maxLength.
      const region = fieldName;
      // The blocks dict + blocks_layout live under the object wrapper when this
      // region is nested (objectPath, e.g. [table]); [] for the block-root case.
      const regionContainer = objectPath.reduce(
        (node, key) => node?.[key],
        block,
      );
      const layoutList = regionContainer?.blocks_layout?.[region];
      const currentCount = Array.isArray(layoutList) ? layoutList.length : 0;
      // Same field → block → page precedence as getContainerFieldConfig (a container that
      // restricts nothing inherits the page's allowed list + default block type).
      const rc = resolveRegionConstraints(fieldDef, blockConfig, {
        allowedBlocks: defaultAllowedBlocks,
        defaultBlockType: pageDefaultBlockType,
      });
      const maxLengthOk = !rc.maxLength || currentCount < rc.maxLength;
      containerFields.push({
        region,
        ...(objectPath.length > 0 && { regionPath: objectPath }),
        title: prefixTitle(
          fieldDef.title || (region === 'items' ? 'Blocks' : region),
          titlePath,
        ),
        allowedBlocks: rc.allowedBlocks,
        allowedTemplates: fieldDef.allowedTemplates || null,
        allowedLayouts: fieldDef.allowedLayouts || null,
        defaultBlockType: rc.defaultBlockType,
        maxLength: rc.maxLength,
        currentCount,
        canAdd: !parentIsReadonly && maxLengthOk,
      });
    } else if (fieldDef.widget === 'object_list') {
      // object_list: items stored as array
      // Two modes:
      //   1. allowedBlocks set: typed items, each can have a different type via typeField
      //   2. schema set (no allowedBlocks): single-schema items, virtual type blockType:fieldName
      const hasAllowedBlocks = !!fieldDef.allowedBlocks;
      const itemType = `${blockType}:${fieldName}`;
      // Object prefix to the array (the `/`-path object hops): [] at the block
      // root, [table] when nested in a `table` object. The array is at
      // [...regionPath, fieldName].
      const maxLength = fieldDef.maxLength || null;
      const currentCount = getFieldCount(fieldName, true, objectPath);
      const maxLengthOk = !maxLength || currentCount < maxLength;
      containerFields.push({
        region: fieldName,
        ...(objectPath.length > 0 && { regionPath: objectPath }),
        title: prefixTitle(fieldDef.title || fieldName, titlePath),
        allowedBlocks: hasAllowedBlocks ? fieldDef.allowedBlocks : [itemType],
        allowedTemplates: fieldDef.allowedTemplates || null,
        defaultBlockType:
          fieldDef.defaultBlockType || (hasAllowedBlocks ? null : itemType),
        maxLength,
        currentCount,
        canAdd: !parentIsReadonly && maxLengthOk,
        isObjectList: true,
        itemSchema: hasAllowedBlocks ? null : fieldDef.schema, // null for typed (schema from blocksConfig)
        idField: fieldDef.idField || '@id', // ID field name for items
        typeField: fieldDef.typeField || null, // Attribute name for item type (e.g., '@type')
      });
    }
  }

  return containerFields;
}

/**
 * Insert a block into a container after a specified block.
 * Treats the page itself as a container when containerConfig is null.
 *
 * @param {Object} formData - The form data
 * @param {Object} blockPathMap - Map of blockId -> { path, parentId }
 * @param {string} refBlockId - Reference block ID for positioning
 * @param {string} newBlockId - New block's ID
 * @param {Object} newBlockData - New block's data
 * @param {Object|null} containerConfig - Container config from getContainerFieldConfig, or PAGE_BLOCK_UID for page-level
 * @param {'before'|'after'|'inside'} action - Where to insert relative to refBlockId
 * @returns {Object} New formData with block inserted
 */
export function insertBlockInContainer(
  formData,
  blockPathMap,
  refBlockId,
  newBlockId,
  newBlockData,
  containerConfig,
  action = 'after',
) {
  if (!containerConfig) {
    throw new Error(
      `[HYDRA] insertBlockInContainer: containerConfig required for block ${refBlockId}`,
    );
  }

  // Helper to compute insert index based on action
  const getInsertIndex = (items, refIndex) => {
    if (action === 'before') return Math.max(0, refIndex);
    if (action === 'after') return refIndex + 1;
    if (action === 'inside') return items.length; // append at end
    return refIndex + 1; // default to after
  };

  const { parentId, isObjectList } = containerConfig;

  // parentPath is [] for page-level (parentId === PAGE_BLOCK_UID)
  const parentPath =
    parentId === PAGE_BLOCK_UID ? [] : blockPathMap[parentId]?.path;
  const parentBlock = getBlockByPath(formData, parentPath);

  if (!parentBlock) {
    throw new Error(
      `[HYDRA] Could not find parent block ${parentId} for container insertion`,
    );
  }

  const items = getContainerItems(parentBlock, containerConfig);
  let updatedParentBlock;

  // A block added into a container that is part of a template instance joins that
  // instance (inherit from the ref sibling, else the container) — otherwise it renders
  // read-only in template edit mode, the same failure as unstamped seeded auto-content.
  if (isObjectList) {
    const idField = containerConfig.idField || '@id';
    const refIndex = items.findIndex((item) => item[idField] === refBlockId);
    const insertIndex = getInsertIndex(items, refIndex);
    const stamped = inheritTemplateMembership(
      newBlockData,
      items[refIndex] || parentBlock,
      { inheritFixed: !!parentBlock?.templateInstanceId },
    );
    items.splice(insertIndex, 0, { [idField]: newBlockId, ...stamped });
    updatedParentBlock = setContainerItems(parentBlock, containerConfig, items);
  } else {
    // Standard container: shared blocks dict + layout field. The dict may live
    // under an object wrapper (regionPath) — read + rebuild it there.
    const regionContainer = getRegionContainer(
      parentBlock,
      containerConfig.regionPath,
    );
    const stamped = inheritTemplateMembership(
      newBlockData,
      regionContainer.blocks?.[refBlockId] || parentBlock,
      { inheritFixed: !!parentBlock?.templateInstanceId },
    );
    const newContainerBlocks = {
      ...regionContainer.blocks,
      [newBlockId]: stamped,
    };
    const refIndex = items.indexOf(refBlockId);
    const insertIndex = getInsertIndex(items, refIndex);
    items.splice(insertIndex, 0, newBlockId);
    updatedParentBlock = setContainerItems(
      parentBlock,
      containerConfig,
      items,
      newContainerBlocks,
    );
  }

  return setBlockByPath(formData, parentPath, updatedParentBlock);
}

/**
 * Wrap a set of selected blocks in a new container of `newContainerType`.
 *
 * All selected blocks must share the same parent container. The new container
 * is inserted where the first selected block was, and becomes the parent of
 * all selected blocks in their original order. Selected blocks are removed
 * from the original parent.
 *
 * Requires newContainerType's schema to declare a blocks_layout child field
 * (the standard container pattern).
 *
 * @param {Object} formData
 * @param {Object} blockPathMap
 * @param {string[]} selectedIds     Block IDs to wrap (must share parent)
 * @param {string} newContainerType  @type of the container to create
 * @param {Object} blocksConfig
 * @param {Object} intl
 * @param {Object} [options]
 * @param {Function} [options.uuidGenerator]  Override for deterministic tests
 * @returns {{formData: Object, newContainerId: string}}
 */
export function wrapBlocksInContainer(
  formData,
  blockPathMap,
  selectedIds,
  newContainerType,
  blocksConfig,
  intl,
  options = {},
) {
  if (!selectedIds || selectedIds.length === 0) {
    throw new Error(
      '[HYDRA] wrapBlocksInContainer: selectedIds is required and non-empty',
    );
  }
  const uuidGen =
    options.uuidGenerator ||
    (() =>
      globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));

  // All selected blocks must share the same parent container.
  const firstCC = getContainerFieldConfig(
    selectedIds[0],
    blockPathMap,
    formData,
    blocksConfig,
    intl,
  );
  if (!firstCC) {
    throw new Error(
      `[HYDRA] wrapBlocksInContainer: no container config for ${selectedIds[0]}`,
    );
  }
  for (const id of selectedIds.slice(1)) {
    const cc = getContainerFieldConfig(
      id,
      blockPathMap,
      formData,
      blocksConfig,
      intl,
    );
    if (
      !cc ||
      cc.parentId !== firstCC.parentId ||
      (cc.region || 'items') !== (firstCC.region || 'items')
    ) {
      throw new Error(
        `[HYDRA] wrapBlocksInContainer: all selected blocks must share a parent field and region (offender: ${id})`,
      );
    }
  }

  if (firstCC.isObjectList) {
    // Selecting items that live INSIDE an object_list to wrap them is the unreachable
    // dimension (no object_list lists a container in allowedBlocks). The reachable case is
    // wrapping page/blocks_layout children INTO a container whose OWN child field is an
    // object_list (e.g. a slider) — that's handled below via the child-field descriptor.
    throw new Error(
      '[HYDRA] wrapBlocksInContainer: object_list parents not yet supported',
    );
  }

  // Sort selectedIds in DOM order by reading the parent's current layout.
  const parentPath =
    firstCC.parentId === PAGE_BLOCK_UID
      ? []
      : blockPathMap[firstCC.parentId]?.path;
  const parentBlock = getBlockByPath(formData, parentPath);
  if (!parentBlock) {
    throw new Error(
      `[HYDRA] wrapBlocksInContainer: missing parent ${firstCC.parentId}`,
    );
  }
  const layoutItems = getContainerItems(parentBlock, firstCC);
  const sortedIds = layoutItems.filter((id) => selectedIds.includes(id));
  if (sortedIds.length !== selectedIds.length) {
    throw new Error(
      '[HYDRA] wrapBlocksInContainer: some selected ids not found in parent layout',
    );
  }

  // Collect block data for the children (shared blocks dict on parent).
  const nestedBlocks = {};
  for (const id of sortedIds) {
    const data = parentBlock.blocks?.[id];
    if (data === undefined) {
      throw new Error(
        `[HYDRA] wrapBlocksInContainer: parent.blocks missing ${id}`,
      );
    }
    nestedBlocks[id] = data;
  }

  // Build the new container block. Its children go into whatever storage the container's own
  // child field uses — blocks_layout (section, columns) or object_list (a slider's `slides`) —
  // resolved once as a descriptor and written through the funnel, so there is no branch here.
  const newContainerId = uuidGen();
  const newContainer = { '@type': newContainerType };
  setChildBlockEntries(
    newContainer,
    getContainerRegionDescriptors(newContainerType, blocksConfig, intl)[0],
    sortedIds.map((id) => ({ id, block: nestedBlocks[id] })),
  );

  // Remove selectedIds from parent's blocks dict and splice in the new container
  // at the first selected id's position.
  const remainingBlocks = { ...parentBlock.blocks };
  for (const id of sortedIds) delete remainingBlocks[id];
  remainingBlocks[newContainerId] = newContainer;

  const newItems = [];
  let inserted = false;
  for (const id of layoutItems) {
    if (selectedIds.includes(id)) {
      if (!inserted) {
        newItems.push(newContainerId);
        inserted = true;
      }
      // Skip the selected id itself — now lives inside the new container.
    } else {
      newItems.push(id);
    }
  }

  const updatedParent = setContainerItems(
    parentBlock,
    firstCC,
    newItems,
    remainingBlocks,
  );
  const newFormData = setBlockByPath(formData, parentPath, updatedParent);
  return { formData: newFormData, newContainerId };
}

/**
 * Unwrap a container block: promote its children to the parent at the
 * container's position, then remove the container.
 *
 * Caller is responsible for confirming the parent's allowedBlocks accepts
 * each child type before calling (UI button should be disabled otherwise).
 * Throws if the container isn't a blocks_layout-style parent or if the
 * parent can't be located.
 *
 * @param {Object} formData
 * @param {Object} blockPathMap
 * @param {string} containerId      The container block to unwrap
 * @param {Object} blocksConfig
 * @param {Object} intl
 * @returns {{formData: Object, promotedIds: string[]}}
 */
export function unwrapContainer(
  formData,
  blockPathMap,
  containerId,
  blocksConfig,
  intl,
) {
  const containerInfo = blockPathMap?.[containerId];
  if (!containerInfo) {
    throw new Error(`[HYDRA] unwrapContainer: no pathInfo for ${containerId}`);
  }

  // Load the container and find its child field (first blocks_layout field).
  const containerBlock = getBlockById(formData, blockPathMap, containerId);
  if (!containerBlock) {
    throw new Error(
      `[HYDRA] unwrapContainer: cannot read block ${containerId}`,
    );
  }
  // Read the container's children from ALL its regions through the funnel — blocks_layout AND
  // object_list, schema AND data — so a multi-region or mixed container promotes everything, not
  // just its default region. No branch on storage; each region carries its own.
  const childEntries = getContainerRegionDescriptors(
    containerBlock['@type'],
    blocksConfig,
    intl,
    containerBlock,
  ).flatMap((desc) => getChildBlockEntries(containerBlock, desc));
  const childIds = childEntries.map((e) => e.id);
  const childData = Object.fromEntries(
    childEntries.map((e) => [e.id, e.block]),
  );

  // Get the parent container config where `containerId` lives.
  const containerCC = getContainerFieldConfig(
    containerId,
    blockPathMap,
    formData,
    blocksConfig,
    intl,
  );
  if (!containerCC) {
    throw new Error(
      `[HYDRA] unwrapContainer: no parent config for ${containerId}`,
    );
  }
  // Unwrapping a container whose PARENT is an object_list is the unreachable dimension (a
  // container can't be an object_list item — none list one in allowedBlocks). The reachable
  // case — a container with object_list CHILDREN (a slider) sitting in a blocks_layout parent —
  // is handled by the promotion below; childEntries above already read its children uniformly.
  if (containerCC.isObjectList) {
    throw new Error(
      '[HYDRA] unwrapContainer: object_list parents not yet supported',
    );
  }

  const parentPath =
    containerCC.parentId === PAGE_BLOCK_UID
      ? []
      : blockPathMap[containerCC.parentId]?.path;
  const parentBlock = getBlockByPath(formData, parentPath);
  if (!parentBlock) {
    throw new Error(
      `[HYDRA] unwrapContainer: cannot find parent ${containerCC.parentId}`,
    );
  }

  const parentItems = getContainerItems(parentBlock, containerCC);
  const containerIdx = parentItems.indexOf(containerId);
  if (containerIdx < 0) {
    throw new Error(
      `[HYDRA] unwrapContainer: ${containerId} not in parent layout`,
    );
  }

  // Build the new parent layout: replace containerId with its child ids.
  const newParentItems = [
    ...parentItems.slice(0, containerIdx),
    ...childIds,
    ...parentItems.slice(containerIdx + 1),
  ];

  // Merge the container's children into the parent's blocks dict.
  const newParentBlocks = { ...parentBlock.blocks };
  delete newParentBlocks[containerId];
  for (const id of childIds) {
    if (id in newParentBlocks) {
      throw new Error(
        `[HYDRA] unwrapContainer: child id ${id} collides with parent blocks`,
      );
    }
    newParentBlocks[id] = childData[id];
  }

  const updatedParent = setContainerItems(
    parentBlock,
    containerCC,
    newParentItems,
    newParentBlocks,
  );
  const newFormData = setBlockByPath(formData, parentPath, updatedParent);
  return { formData: newFormData, promotedIds: [...childIds] };
}

/**
 * Convert a container block's @type while preserving its children. The
 * source's layout field items are remapped to the target's layout field,
 * and the shared blocks dict is carried over verbatim.
 *
 * Does NOT validate target.allowedBlocks; caller should have already
 * confirmed compatibility (the UI surfaces only valid targets).
 *
 * @param {Object} formData
 * @param {Object} blockPathMap
 * @param {string} blockId
 * @param {string} targetType
 * @param {Object} blocksConfig
 * @param {Object} intl
 * @returns {Object} new formData
 */
export function convertContainerBlock(
  formData,
  blockPathMap,
  blockId,
  targetType,
  blocksConfig,
  intl,
) {
  const sourceBlock = getBlockById(formData, blockPathMap, blockId);
  if (!sourceBlock) {
    throw new Error(
      `[HYDRA] convertContainerBlock: block ${blockId} not found`,
    );
  }
  const sourceType = sourceBlock['@type'];

  // Regions are per-field, each with its own storage (object_list or blocks_layout) — a
  // container may mix them. Carry each source region's children through the funnel; the region's
  // storage lives in its descriptor, so nothing here branches on it. Mapping source region →
  // target region: prefer the SAME-NAMED target region (preserve `items`/`footer`/… by name,
  // even regions the target doesn't declare); the PRIMARY region falls back to the target's
  // first region to cover a rename/re-storage (a blocks_layout `items` → an object_list
  // `slides`); anything else is preserved as-is with its own descriptor.
  // Source regions come from the schema AND the data (schema-derived containers hold regions
  // only in block.blocks_layout); target regions from the schema (a type, no instance yet).
  const sourceRegions = getContainerRegionDescriptors(
    sourceType,
    blocksConfig,
    intl,
    sourceBlock,
  );
  const targetRegions = getContainerRegionDescriptors(
    targetType,
    blocksConfig,
    intl,
  );

  // Strip the source's child storage from the carried-over block (shared blocks dict + every
  // object_list region field); keep non-container fields. Target storage is rebuilt below.
  const cleaned = { ...sourceBlock };
  delete cleaned.blocks;
  delete cleaned.blocks_layout;
  for (const r of sourceRegions) {
    if (r.isObjectList) delete cleaned[r.region];
    // A region nested under an object wrapper (e.g. accordion `data/items`)
    // stores its blocks/blocks_layout inside that wrapper — drop the wrapper so
    // the old children don't ride along (the wrapper holds only its region).
    if (r.regionPath?.length) delete cleaned[r.regionPath[0]];
  }

  const newBlock = { ...cleaned, '@type': targetType };
  const perTargetRegion = new Map();
  sourceRegions.forEach((sourceRegion, i) => {
    const targetRegion =
      targetRegions.find((t) => t.region === sourceRegion.region) ||
      (i === 0 ? targetRegions[0] : null) ||
      sourceRegion;
    const acc = perTargetRegion.get(targetRegion.region) || {
      descriptor: targetRegion,
      entries: [],
    };
    acc.entries.push(...getChildBlockEntries(sourceBlock, sourceRegion));
    perTargetRegion.set(targetRegion.region, acc);
  });
  for (const { descriptor, entries } of perTargetRegion.values()) {
    setChildBlockEntries(newBlock, descriptor, entries);
  }

  return updateBlockById(formData, blockPathMap, blockId, newBlock);
}

/**
 * A region-crossing path `<region>/<type|*>/<field>` — targets the `<field>` of a
 * container region's children. Returns { region, type, field } (type null for `*`,
 * i.e. any child that exposes the field), or null for a plain scalar / object path.
 * @private
 */
export function parseRegionPath(path) {
  if (typeof path !== 'string') return null;
  const parts = path.split('/');
  if (parts.length !== 3) return null; // <region>/<type|*>/<field>
  const [region, type, field] = parts;
  if (!region || !type || !field) return null;
  return { region, type: type === '*' ? null : type, field };
}

// Fold slate values left-to-right into one (lossless join via core-Volto's merge).
function mergeSlateValues(values) {
  return values.reduce(
    (acc, v) =>
      acc == null ? v : v == null ? acc : mergeBlockValues(acc, v).mergedValue,
    null,
  );
}

/**
 * Wrap a scalar VALUE into ONE child block inside a container region — the
 * value→container ("expand") half of the value/container bridge, shared by
 * convertValueContainer and convertBlockType so there is one implementation.
 * The child is `<rp.type | region default | slate>` carrying the value at
 * `<rp.field>`. blocks_layout regions key children by a minted uid; object_list
 * regions carry that id in their idField (setChildBlockEntries handles both).
 *
 * Throws if the resolved child type is not one the region allows: a
 * `region/type/field` mapping that names a type the region forbids is a config
 * bug, and a silently-invalid child is worse than a loud failure.
 */
export function expandValueIntoRegion(targetBlock, region, rp, value, uuidGen) {
  const childType = rp.type || region.allowedBlocks?.[0] || 'slate';
  if (region.allowedBlocks && !region.allowedBlocks.includes(childType)) {
    throw new Error(
      `expandValueIntoRegion: child type "${childType}" is not allowed in region "${region.region}" (allowed: ${region.allowedBlocks.join(', ')})`,
    );
  }
  const child = { '@type': childType, [rp.field]: value };
  const gen =
    uuidGen ||
    (() =>
      globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
  setChildBlockEntries(targetBlock, region, [
    { id: child['@id'] || gen(), block: child },
  ]);
}

/**
 * Gather a container region's matching children's `<rp.field>` into a single
 * scalar — the container→value ("collapse") half of the bridge. Slate values
 * are merged; otherwise the first is kept. Returns { value, dropped } where
 * `dropped` counts non-slate values discarded (so the caller can warn).
 */
export function collapseRegionToValue(sourceBlock, region, rp) {
  const values = getChildBlockEntries(sourceBlock, region)
    .filter(
      (e) => !rp.type || getBlockType(e.block, region.typeField) === rp.type,
    )
    .map((e) => e.block?.[rp.field])
    .filter((v) => v != null);
  if (values.length === 0) return { value: undefined, dropped: 0 };
  if (values.every((v) => Array.isArray(v))) {
    return { value: mergeSlateValues(values), dropped: 0 };
  }
  return { value: values[0], dropped: values.length - 1 };
}

/**
 * Convert a block between a CONTAINER shape (a region of child blocks) and a VALUE
 * shape (a scalar field) via a region-crossing `fieldMappings` path.
 *
 * The bridge is declared ONCE on the VALUE block and serves BOTH directions:
 *   tableHeaderCell: { fieldMappings: { tableCell: { value: 'items/slate/value' } } }
 *   - container -> value (COLLAPSE): gather the region's matching children's <field>,
 *     merge (slate) into the value field.
 *   - value -> container (EXPAND): wrap the value in ONE child of <type> in the region.
 *
 * Returns the converted block, or null when no such bridge applies (the caller then
 * falls back to convertContainerBlock's region funnel).
 */
export function convertValueContainer(
  sourceBlock,
  sourceType,
  targetType,
  blocksConfig,
  intl,
) {
  const findBridge = (valueType, containerType) => {
    const m = blocksConfig?.[valueType]?.fieldMappings?.[containerType];
    for (const [valueField, path] of Object.entries(m || {})) {
      const rp = parseRegionPath(path);
      if (rp) return { valueField, rp };
    }
    return null;
  };

  // container -> value: the TARGET is the value block. value -> container: the SOURCE is.
  let bridge = findBridge(targetType, sourceType);
  let mode = 'collapse';
  if (!bridge) {
    bridge = findBridge(sourceType, targetType);
    mode = 'expand';
  }
  if (!bridge) return null;
  const { valueField, rp } = bridge;

  if (mode === 'collapse') {
    const descriptors = getContainerRegionDescriptors(
      sourceType,
      blocksConfig,
      intl,
      sourceBlock,
    );
    const region = descriptors.find((r) => r.region === rp.region);
    if (!region) return null;
    // Carry over scalar fields (key, width, …); drop the region storage.
    const newBlock = { ...sourceBlock, '@type': targetType };
    delete newBlock.blocks;
    delete newBlock.blocks_layout;
    for (const r of descriptors) if (r.isObjectList) delete newBlock[r.region];

    const { value, dropped } = collapseRegionToValue(sourceBlock, region, rp);
    newBlock[valueField] = value;
    if (dropped) {
      // eslint-disable-next-line no-console
      console.warn(
        `[HYDRA] convertValueContainer: collapse dropped ${dropped} non-slate value(s) for "${valueField}"`,
      );
    }
    return newBlock;
  }

  // expand: the value block is the source.
  const descriptors = getContainerRegionDescriptors(
    targetType,
    blocksConfig,
    intl,
  );
  const region = descriptors.find((r) => r.region === rp.region);
  if (!region) return null;
  const newBlock = { ...sourceBlock, '@type': targetType };
  delete newBlock[valueField];
  expandValueIntoRegion(newBlock, region, rp, sourceBlock[valueField]);
  return newBlock;
}

/**
 * ALL child regions of a container, in schema order — the storage-agnostic unit for every
 * container op. Storage (object_list vs blocks_layout) is a property of each REGION, not the
 * container: one container may mix object_list and blocks_layout regions. Returns a LIST of
 * per-region descriptors that getChildBlockEntries / setChildBlockEntries understand; callers
 * iterate regions and never branch on a container-level storage — there is no such thing.
 *
 * Pass `block` (an instance) to ALSO include blocks_layout regions present only in the DATA — a
 * schema-DERIVED container (e.g. a gridBlock via inheritSchemaFrom) holds its regions in
 * block.blocks_layout, not as static schema fields. Omit it for a type with no instance yet (a
 * convert/wrap TARGET). `[0]` is the default region (what wrap fills).
 *
 *   object_list region  → { region, isObjectList: true, idField, typeField, allowedBlocks }
 *   blocks_layout region → { region, isObjectList: false, allowedBlocks }  (region = field name)
 */
export function getContainerRegionDescriptors(
  blockType,
  blocksConfig,
  intl,
  block = null,
) {
  const schema = getBlockTypeSchema(blockType, intl, blocksConfig);
  const regions = [];
  // Descend transparently through widget:'object' wrappers (the SAME way the
  // pathMap does — buildBlockPathMap.processItem / getAllContainerFields), so a
  // region nested under an object (e.g. accordion's `data/items`) is surfaced
  // with its `regionPath`. Top-level regions omit regionPath, so their
  // descriptor shape is unchanged for existing callers.
  const collect = (properties, regionPath) => {
    for (const [fieldName, fieldDef] of Object.entries(properties || {})) {
      if (fieldDef?.widget === 'object' && fieldDef.schema?.properties) {
        collect(fieldDef.schema.properties, [...regionPath, fieldName]);
      } else if (fieldDef?.widget === 'object_list') {
        regions.push({
          region: fieldName,
          ...(regionPath.length > 0 && { regionPath }),
          isObjectList: true,
          idField: fieldDef.idField || '@id',
          typeField: fieldDef.typeField || null,
          itemTypeField: fieldDef.itemTypeField || null,
          allowedBlocks: fieldDef.allowedBlocks || null,
        });
      } else if (fieldDef?.widget === 'blocks_layout') {
        regions.push({
          region: fieldName,
          ...(regionPath.length > 0 && { regionPath }),
          isObjectList: false,
          itemTypeField: fieldDef.itemTypeField || null,
          allowedBlocks: fieldDef.allowedBlocks || null,
        });
      }
    }
  };
  collect(schema?.properties, []);
  // Instance-only: blocks_layout regions present in the DATA but not the (unresolved) schema.
  if (block) {
    const known = new Set(regions.map((r) => r.region));
    for (const r of Object.keys(block.blocks_layout || {})) {
      if (Array.isArray(block.blocks_layout[r]) && !known.has(r)) {
        regions.push({ region: r, isObjectList: false });
      }
    }
  }
  return regions;
}

/**
 * Delete a block from a container.
 * Treats the page itself as a container when containerConfig is null.
 *
 * @param {Object} formData - The form data
 * @param {Object} blockPathMap - Map of blockId -> { path, parentId }
 * @param {string} blockId - Block ID to delete
 * @param {Object|null} containerConfig - Container config from getContainerFieldConfig, or PAGE_BLOCK_UID for page-level
 * @returns {Object} New formData with block removed
 */
export function deleteBlockFromContainer(
  formData,
  blockPathMap,
  blockId,
  containerConfig,
) {
  if (!containerConfig) {
    throw new Error(
      `[HYDRA] deleteBlockFromContainer: containerConfig required for block ${blockId}`,
    );
  }

  const { parentId, isObjectList } = containerConfig;

  // parentPath is [] for page-level (parentId === PAGE_BLOCK_UID)
  const parentPath =
    parentId === PAGE_BLOCK_UID ? [] : blockPathMap[parentId]?.path;
  const parentBlock = getBlockByPath(formData, parentPath);

  if (!parentBlock) {
    throw new Error(
      `[HYDRA] Could not find parent block ${parentId} for container deletion`,
    );
  }

  let updatedParentBlock;
  const items = getContainerItems(parentBlock, containerConfig);

  if (isObjectList) {
    const idField = containerConfig.idField || '@id';
    const filteredItems = items.filter((item) => item[idField] !== blockId);
    updatedParentBlock = setContainerItems(
      parentBlock,
      containerConfig,
      filteredItems,
    );
  } else {
    // Standard container: remove from shared blocks dict and layout. The dict
    // may live under an object wrapper (regionPath).
    const regionContainer = getRegionContainer(
      parentBlock,
      containerConfig.regionPath,
    );
    const { [blockId]: removed, ...remainingBlocks } = regionContainer.blocks;
    const filteredItems = items.filter((id) => id !== blockId);
    updatedParentBlock = setContainerItems(
      parentBlock,
      containerConfig,
      filteredItems,
      remainingBlocks,
    );
  }

  return setBlockByPath(formData, parentPath, updatedParentBlock);
}

/**
 * Strip all @type:'empty' slot blocks from formData before saving.
 * Uses blockPathMap to locate empty blocks at any nesting level.
 *
 * @param {Object} formData - The form data
 * @param {Object} blocksConfig - Block configuration from registry
 * @param {Object} intl - The intl object from react-intl
 * @returns {Object} New formData with empty blocks removed
 */
export function stripEmptyBlocks(formData, blocksConfig, intl) {
  const pathMap = buildBlockPathMap(formData, blocksConfig, intl);

  const emptyIds = [];
  for (const [blockId, pathInfo] of Object.entries(pathMap)) {
    if (pathInfo.isTemplateInstance) continue;
    const block = getBlockById(formData, pathMap, blockId);
    if (block?.['@type'] === 'empty') {
      emptyIds.push(blockId);
    }
  }

  if (emptyIds.length === 0) return formData;

  let result = formData;
  for (const blockId of emptyIds) {
    const containerConfig = getContainerFieldConfig(
      blockId,
      pathMap,
      result,
      blocksConfig,
      intl,
    );
    result = deleteBlockFromContainer(
      result,
      pathMap,
      blockId,
      containerConfig,
    );
  }
  return result;
}

/**
 * Ensure every container block has at least one child.
 * Inverse of stripEmptyBlocks — restores slot blocks on page load
 * for containers that were saved empty (after stripping).
 *
 * @param {Object} formData - The form data
 * @param {Object} blocksConfig - Block configuration from registry
 * @param {Object} intl - The intl object from react-intl
 * @param {Function} uuidGenerator - Function to generate UUIDs
 * @returns {Object} New formData with empty containers populated
 */
export function ensureAllContainersHaveBlocks(
  formData,
  blocksConfig,
  intl,
  uuidGenerator,
) {
  const pathMap = buildBlockPathMap(formData, blocksConfig, intl);

  let result = formData;
  for (const [blockId, pathInfo] of Object.entries(pathMap)) {
    if (pathInfo.isTemplateInstance) continue;
    const containerFields = getAllContainerFields(
      blockId,
      pathMap,
      result,
      blocksConfig,
      intl,
    );
    for (const field of containerFields) {
      if (field.isTemplateInstance) continue;
      result = ensureEmptyBlockIfEmpty(
        result,
        { parentId: blockId, ...field },
        pathMap,
        uuidGenerator,
        blocksConfig,
        { intl },
      );
    }
  }
  return result;
}

/**
 * Remove a template instance from the page.
 * - Fixed blocks are deleted entirely
 * - Non-fixed (slot) blocks have template fields stripped and become regular blocks
 *
 * @param {Object} formData - The form data
 * @param {Object} blockPathMap - Map of blockId -> { path, parentId, isTemplateInstance, ... }
 * @param {string} templateInstanceId - The templateInstanceId to remove
 * @returns {Object} New formData with template instance removed
 */
export function removeTemplateInstance(
  formData,
  blockPathMap,
  templateInstanceId,
) {
  // Find the template instance entry in pathMap to get container info
  const instanceInfo = blockPathMap[templateInstanceId];
  if (!instanceInfo?.isTemplateInstance) {
    throw new Error(
      `[HYDRA] removeTemplateInstance: ${templateInstanceId} is not a template instance`,
    );
  }

  const { parentId, region = 'items' } = instanceInfo;

  // Get the parent container
  const parentPath =
    parentId === PAGE_BLOCK_UID ? [] : blockPathMap[parentId]?.path;
  const parentBlock = getBlockByPath(formData, parentPath);
  if (!parentBlock) {
    throw new Error(
      `[HYDRA] removeTemplateInstance: could not find parent block ${parentId}`,
    );
  }

  // Get current layout for the instance's region. Blocks are in shared
  // parent.blocks; the layout list lives at blocks_layout[region]. (Template
  // instances are always blocks-layout containers.) Dep-free direct access — no
  // lodash `get`: the offline evaluator bundles this module, so it must not pull
  // heavy deps (see the DI-refactor).
  const layout = parentBlock.blocks_layout?.[region] ?? [];
  const blocks = parentBlock.blocks ?? {};

  // Separate blocks into: fixed (to delete), slot (to keep but strip), and unrelated
  const newLayout = [];
  const newBlocks = { ...blocks };

  for (const blockId of layout) {
    const block = blocks[blockId];
    if (!block) {
      newLayout.push(blockId);
      continue;
    }

    // Check if this block belongs to the template instance being removed
    if (block.templateInstanceId === templateInstanceId) {
      if (block.fixed) {
        // Fixed blocks are deleted - don't add to newLayout, remove from newBlocks
        delete newBlocks[blockId];
      } else {
        // Non-fixed blocks: strip template fields and keep them
        const {
          templateId,
          templateInstanceId: _,
          slotId,
          fixed,
          readOnly,
          ...cleanBlock
        } = block;
        newBlocks[blockId] = cleanBlock;
        newLayout.push(blockId);
      }
    } else {
      // Block doesn't belong to this template instance - keep as-is
      newLayout.push(blockId);
    }
  }

  // Build updated parent block — shared parent.blocks + the region's list in
  // the shared blocks_layout dict (siblings preserved).
  const updatedParentBlock = {
    ...parentBlock,
    blocks: newBlocks,
    blocks_layout: { ...parentBlock.blocks_layout, [region]: newLayout },
  };

  return setBlockByPath(formData, parentPath, updatedParentBlock);
}

/**
 * Insert a column into a table (add cell to ALL rows at the same position).
 * Used when adding a cell in table mode (parentAddMode === 'table').
 *
 * @param {Object} formData - The form data
 * @param {Object} blockPathMap - Map of blockId -> { path, parentId }
 * @param {string} refCellId - Reference cell ID for positioning
 * @param {Object} cellTemplate - Template for new cell data (without ID) - should have defaults already applied
 * @param {'before'|'after'} action - Where to insert relative to refCellId
 * @param {Function} uuidGenerator - Function to generate UUIDs
 * @returns {Object} { formData, insertedCellId } - Updated formData and the ID of the cell in the reference row
 */
export function insertTableColumn(
  formData,
  blockPathMap,
  refCellId,
  cellTemplate,
  action,
  uuidGenerator,
) {
  const cellPathInfo = blockPathMap[refCellId];
  if (!cellPathInfo || !cellPathInfo.parentAddMode) {
    throw new Error('[HYDRA] insertTableColumn: cell is not in table mode');
  }

  // Get the row containing this cell
  const rowId = cellPathInfo.parentId;
  const rowPathInfo = blockPathMap[rowId];
  if (!rowPathInfo) {
    throw new Error('[HYDRA] insertTableColumn: could not find row for cell');
  }

  // Get the table block (grandparent of the cell)
  const tableId = rowPathInfo.parentId;
  const tablePathInfo = blockPathMap[tableId];
  if (!tablePathInfo) {
    throw new Error('[HYDRA] insertTableColumn: could not find table for row');
  }

  // Get table block data
  const tableBlock = getBlockByPath(formData, tablePathInfo.path);
  if (!tableBlock) {
    throw new Error('[HYDRA] insertTableColumn: table block not found');
  }

  // Get rows using dataPath
  const dataPath = [...(rowPathInfo.regionPath || []), rowPathInfo.region || 'rows'];
  let rows = tableBlock;
  for (const key of dataPath) {
    rows = rows?.[key];
  }
  if (!Array.isArray(rows)) {
    throw new Error('[HYDRA] insertTableColumn: could not find rows array');
  }

  // Find the cell index in its row
  const cellIdField = cellPathInfo.idField || 'key';
  const currentRow = rows.find(
    (row) => row[rowPathInfo.idField || 'key'] === rowId,
  );
  if (!currentRow || !currentRow.cells) {
    throw new Error(
      '[HYDRA] insertTableColumn: could not find current row or cells',
    );
  }

  const cellIndex = currentRow.cells.findIndex(
    (cell) => cell[cellIdField] === refCellId,
  );
  if (cellIndex === -1) {
    throw new Error('[HYDRA] insertTableColumn: cell not found in row');
  }

  // Calculate insert index based on action
  const insertIndex = action === 'before' ? cellIndex : cellIndex + 1;

  // Track the cell ID we'll insert in the reference row (for selection)
  let insertedCellId = null;

  // Insert a new cell into EACH row at the same position
  const updatedRows = rows.map((row) => {
    const newCellId = uuidGenerator();

    // Track the cell in the reference row for selection
    if (row[rowPathInfo.idField || 'key'] === rowId) {
      insertedCellId = newCellId;
    }

    const cells = [...(row.cells || [])];
    cells.splice(insertIndex, 0, {
      [cellIdField]: newCellId,
      ...cellTemplate,
    });

    return { ...row, cells };
  });

  // Update the table block with new rows
  let updatedTableBlock = { ...tableBlock };
  let current = updatedTableBlock;
  for (let i = 0; i < dataPath.length - 1; i++) {
    current[dataPath[i]] = { ...current[dataPath[i]] };
    current = current[dataPath[i]];
  }
  current[dataPath[dataPath.length - 1]] = updatedRows;

  const newFormData = setBlockByPath(
    formData,
    tablePathInfo.path,
    updatedTableBlock,
  );

  return { formData: newFormData, insertedCellId };
}

/**
 * Delete a column from a table (remove cell at same index from ALL rows).
 *
 * @param {Object} formData - The form data
 * @param {Object} blockPathMap - Map of blockId -> { path, parentId }
 * @param {string} cellId - Cell ID to delete (determines column index)
 * @returns {Object} Updated formData with column removed
 */
export function deleteTableColumn(formData, blockPathMap, cellId) {
  const cellPathInfo = blockPathMap[cellId];
  if (!cellPathInfo || !cellPathInfo.parentAddMode) {
    throw new Error('[HYDRA] deleteTableColumn: cell is not in table mode');
  }

  // Get the row containing this cell
  const rowId = cellPathInfo.parentId;
  const rowPathInfo = blockPathMap[rowId];
  if (!rowPathInfo) {
    throw new Error('[HYDRA] deleteTableColumn: could not find row for cell');
  }

  // Get the table block (grandparent of the cell)
  const tableId = rowPathInfo.parentId;
  const tablePathInfo = blockPathMap[tableId];
  if (!tablePathInfo) {
    throw new Error('[HYDRA] deleteTableColumn: could not find table for row');
  }

  // Get table block data
  const tableBlock = getBlockByPath(formData, tablePathInfo.path);
  if (!tableBlock) {
    throw new Error('[HYDRA] deleteTableColumn: table block not found');
  }

  // Get rows using dataPath
  const dataPath = [...(rowPathInfo.regionPath || []), rowPathInfo.region || 'rows'];
  let rows = tableBlock;
  for (const key of dataPath) {
    rows = rows?.[key];
  }
  if (!Array.isArray(rows)) {
    throw new Error('[HYDRA] deleteTableColumn: could not find rows array');
  }

  // Find the cell index in its row
  const cellIdField = cellPathInfo.idField || 'key';
  const currentRow = rows.find(
    (row) => row[rowPathInfo.idField || 'key'] === rowId,
  );
  if (!currentRow || !currentRow.cells) {
    throw new Error(
      '[HYDRA] deleteTableColumn: could not find current row or cells',
    );
  }

  const cellIndex = currentRow.cells.findIndex(
    (cell) => cell[cellIdField] === cellId,
  );
  if (cellIndex === -1) {
    throw new Error('[HYDRA] deleteTableColumn: cell not found in row');
  }

  // Remove cell at this index from EACH row
  const updatedRows = rows.map((row) => {
    const cells = [...(row.cells || [])];
    if (cellIndex < cells.length) {
      cells.splice(cellIndex, 1);
    }
    return { ...row, cells };
  });

  // Update the table block with new rows
  let updatedTableBlock = { ...tableBlock };
  let current = updatedTableBlock;
  for (let i = 0; i < dataPath.length - 1; i++) {
    current[dataPath[i]] = { ...current[dataPath[i]] };
    current = current[dataPath[i]];
  }
  current[dataPath[dataPath.length - 1]] = updatedRows;

  return setBlockByPath(formData, tablePathInfo.path, updatedTableBlock);
}

/**
 * Mutate a block in a container (replace its data).
 * Treats the page itself as a container when containerConfig is null.
 *
 * @param {Object} formData - The form data
 * @param {Object} blockPathMap - Map of blockId -> { path, parentId }
 * @param {string} blockId - Block ID to mutate
 * @param {Object} newBlockData - New block data
 * @param {Object|null} containerConfig - Container config from getContainerFieldConfig, or PAGE_BLOCK_UID for page-level
 * @returns {Object} New formData with block mutated
 */
export function mutateBlockInContainer(
  formData,
  blockPathMap,
  blockId,
  newBlockData,
  containerConfig,
) {
  if (!containerConfig) {
    throw new Error(
      `[HYDRA] mutateBlockInContainer: containerConfig required for block ${blockId}`,
    );
  }

  const { parentId, isObjectList } = containerConfig;

  // parentPath is [] for page-level (parentId === PAGE_BLOCK_UID)
  const parentPath =
    parentId === PAGE_BLOCK_UID ? [] : blockPathMap[parentId]?.path;
  const parentBlock = getBlockByPath(formData, parentPath);

  if (!parentBlock) {
    throw new Error(
      `[HYDRA] Could not find parent block ${parentId} for container mutation`,
    );
  }

  const items = getContainerItems(parentBlock, containerConfig);
  let updatedParentBlock;

  if (isObjectList) {
    const idField = containerConfig.idField || '@id';
    const updatedItems = items.map((item) =>
      item[idField] === blockId
        ? { [idField]: blockId, ...newBlockData }
        : item,
    );
    updatedParentBlock = setContainerItems(
      parentBlock,
      containerConfig,
      updatedItems,
    );
  } else {
    // Standard container: update block in shared blocks dict
    const blocksObj = { ...parentBlock.blocks, [blockId]: newBlockData };
    updatedParentBlock = setContainerItems(
      parentBlock,
      containerConfig,
      items,
      blocksObj,
    );
  }

  return setBlockByPath(formData, parentPath, updatedParentBlock);
}

/**
 * Determine the block type to use for an empty container.
 * Fallback chain:
 *   1. containerConfig.defaultBlockType (set by getAllContainerFields —
 *      either explicit on the field/blockConfig, or inherited from the
 *      page when the container doesn't restrict allowedBlocks)
 *   2. Single allowedBlocks entry (only one choice)
 *   3. 'empty' (placeholder — opens BlockChooser on click, REPLACED on DnD)
 *
 * Containers with explicit multi-entry allowedBlocks fall through to (3):
 * the author opted into the picker, so the user picks. Containers with
 * NO allowedBlocks restriction get a meaningful default via (1) because
 * getAllContainerFields fills defaultBlockType from page-level when
 * allowedBlocks itself was inherited from page.
 *
 * @param {Object|null} containerConfig - Container config with allowedBlocks/defaultBlockType
 * @returns {string} Block type to create
 */
export function getEmptyBlockType(containerConfig) {
  if (containerConfig?.defaultBlockType) {
    return containerConfig.defaultBlockType;
  }
  if (containerConfig?.allowedBlocks?.length === 1) {
    return containerConfig.allowedBlocks[0];
  }
  return 'empty';
}

/**
 * Page-level fallback constraints — the allowed list + default block type a container
 * inherits when it restricts nothing.
 */
function getPageDefaults(blocksConfig, formData) {
  return {
    allowedBlocks: getPageAllowedBlocksFromRestricted(blocksConfig, {
      properties: formData,
    }),
    defaultBlockType: getDefaultBlockType(),
  };
}

/**
 * The single field → block → page precedence for a container region's constraints, shared by
 * getContainerFieldConfig (the per-block add/insert path) and getAllContainerFields (the
 * sidebar enumeration) so the two can't diverge. They used to: only getAllContainerFields
 * inherited the page default, so getEmptyBlockType seeded a different empty-block type
 * depending on which builder ran. When neither the field nor the block restricts
 * allowedBlocks, the region inherits the page's allowed list — and its defaultBlockType
 * inherits the page default too.
 *
 * @param {Object|null} fieldDef - the blocks_layout schema field def, or null (implicit container)
 * @param {Object|null} blockConfig - the parent block's blocksConfig entry
 * @param {{ allowedBlocks?: Array, defaultBlockType?: string|null }} [pageDefaults]
 * @returns {{ allowedBlocks: Array|null, defaultBlockType: string|null, maxLength: number|null }}
 */
export function resolveRegionConstraints(
  fieldDef,
  blockConfig,
  pageDefaults = {},
) {
  const ownAllowed =
    fieldDef?.allowedBlocks ?? blockConfig?.allowedBlocks ?? null;
  const inherited = !ownAllowed; // neither field nor block restricts → inherit the page
  return {
    allowedBlocks: ownAllowed || pageDefaults.allowedBlocks || null,
    defaultBlockType:
      fieldDef?.defaultBlockType ??
      blockConfig?.defaultBlockType ??
      (inherited ? pageDefaults.defaultBlockType ?? null : null),
    maxLength: fieldDef?.maxLength ?? blockConfig?.maxLength ?? null,
    // A FORCED region's layout is a constraint like the rest, and dropping it
    // here quietly unmade the region. ensureEmptyBlockIfEmpty stamps a seeded
    // placeholder with the template membership it reads off
    // `containerConfig.allowedLayouts`; a config resolved through here carried
    // none, so a region re-seeded after a delete came back as ordinary page
    // content. The author then filled it and had nothing to lock — the
    // placeholder they filled was no longer the template's.
    allowedLayouts: fieldDef?.allowedLayouts ?? blockConfig?.allowedLayouts ?? null,
  };
}

/**
 * Stamp a block being seeded/added into a container with that container's template
 * membership. When a container is part of a template instance, a block added into it must
 * join the same instance — otherwise the flat readonly check
 * (isBlockReadonly: block.templateInstanceId === templateEditMode) treats the new block as
 * read-only in template edit mode, so no add-after "+" appears and you can't build it out.
 * Centralized so every add/seed path stamps consistently. No-op when the source block
 * isn't part of a template instance.
 *
 * When the added block is TEMPLATE CONTENT (a block added after a template sibling, or the
 * default child of a template container), pass `inheritFixed: true` so it also inherits
 * `fixed`/`readOnly` from the source. That makes it real template content: captured by the
 * reverse merge and propagated to other pages (it stays editable in template edit mode via
 * the templateInstanceId, and is read-only in normal mode like any template block). Slot
 * placeholders (the in-slot-empty seed) must NOT inherit fixed — they're user-fillable
 * regions — so they call this without the flag.
 *
 * @param {Object} childBlock - the block being added/seeded
 * @param {Object} sourceBlock - the container (or a template sibling) to inherit from
 * @param {Object} [opts]
 * @param {boolean} [opts.inheritFixed=false] - also inherit fixed/readOnly (template content)
 * @returns {Object} childBlock, stamped when the source is a template instance
 */
export function inheritTemplateMembership(
  childBlock,
  sourceBlock,
  { inheritFixed = false } = {},
) {
  if (!sourceBlock?.templateInstanceId) return childBlock;
  return {
    ...childBlock,
    templateInstanceId: sourceBlock.templateInstanceId,
    ...(sourceBlock.templateId ? { templateId: sourceBlock.templateId } : {}),
    ...(inheritFixed
      ? {
          fixed: sourceBlock.fixed || false,
          readOnly: sourceBlock.readOnly || false,
        }
      : {}),
  };
}

/**
 * Ensure a container has at least one block (empty block if container is empty).
 * Call this after deleting a block to ensure empty containers get an empty block.
 *
 * @param {Object} formData - The form data
 * @param {Object|null} containerConfig - Container config (PAGE_BLOCK_UID for page-level)
 * @param {Object} blockPathMap - Map of blockId -> { path, parentId }
 * @param {Function} uuidGenerator - Function to generate UUIDs
 * @param {Object} blocksConfig - Block configuration from registry
 * @param {Object} options - Options for block initialization
 * @param {Object} options.intl - Intl object for i18n
 * @param {Object} options.metadata - Metadata from form
 * @param {Object} options.properties - Form properties
 * @param {string} options.pageField - For page-level, which page field to check (default: 'blocks')
 * @returns {Object} formData with empty block added if container was empty, or original formData
 */
export function ensureEmptyBlockIfEmpty(
  formData,
  containerConfig,
  blockPathMap,
  uuidGenerator,
  blocksConfig,
  options = {},
) {
  const { intl, metadata, properties } = options;

  if (!containerConfig) {
    throw new Error(
      '[HYDRA] ensureEmptyBlockIfEmpty: containerConfig required',
    );
  }

  // If no region given, process all container fields for this block
  if (!containerConfig.region) {
    const containerFields = getAllContainerFields(
      containerConfig.parentId,
      blockPathMap,
      formData,
      blocksConfig,
      intl,
    );
    let result = formData;
    for (const field of containerFields) {
      result = ensureEmptyBlockIfEmpty(
        result,
        { parentId: containerConfig.parentId, ...field },
        blockPathMap,
        uuidGenerator,
        blocksConfig,
        options,
      );
    }
    return result;
  }

  const { parentId, isObjectList } = containerConfig;

  // parentPath is [] for page-level (parentId === PAGE_BLOCK_UID)
  const parentPath =
    parentId === PAGE_BLOCK_UID ? [] : blockPathMap[parentId]?.path;
  const parentBlock = getBlockByPath(formData, parentPath);

  if (!parentBlock) {
    return formData;
  }

  const items = getContainerItems(parentBlock, containerConfig);

  // [slot-aware] A fixed block carrying `nextSlotId` marks a template slot region
  // that follows it. If the block immediately after it does not carry that slotId,
  // the slot is empty and needs a clickable empty placeholder — the same parity a
  // container gets when its region empties (otherwise there is nothing in the slot
  // to click, and adding falls back to a path that hangs). Seed it in place,
  // carrying the slot membership. Idempotent: a slot that already has content
  // (including a previously-seeded empty) is skipped.
  if (!isObjectList && Array.isArray(items) && items.length > 0) {
    const blocksObj = parentBlock.blocks || {};
    let newItems = null;
    let newBlocks = null;
    const seedEmpty = (anchor, slot) => {
      let emptyBlock = { '@type': 'empty' };
      if (intl && blocksConfig) {
        emptyBlock = getApplyBlockDefaults()(
          { data: emptyBlock, intl, metadata, properties },
          blocksConfig,
        );
      }
      return { ...inheritTemplateMembership(emptyBlock, anchor), slotId: slot };
    };
    for (let i = 0; i < items.length; i++) {
      const cur = blocksObj[items[i]];
      // Trailing slot: a fixed block's `nextSlotId` names the slot region AFTER it. If
      // the block after it isn't in that slot, the slot is empty — seed a placeholder.
      const nextSlot = cur?.nextSlotId;
      if (nextSlot && blocksObj[items[i + 1]]?.slotId !== nextSlot) {
        const emptyId = uuidGenerator();
        newItems = newItems || [...items];
        newBlocks = newBlocks || { ...blocksObj };
        newItems.splice(newItems.indexOf(items[i]) + 1, 0, emptyId);
        newBlocks[emptyId] = seedEmpty(cur, nextSlot);
      }
      // Leading slot (mirror): a fixed block's `prevSlotId` names the slot region BEFORE
      // it — a bottom-anchored layout (slots above a fixed footer). If the block before it
      // isn't in that slot, the leading slot is empty — seed a placeholder in front of it.
      const prevSlot = cur?.prevSlotId;
      if (prevSlot && blocksObj[items[i - 1]]?.slotId !== prevSlot) {
        const emptyId = uuidGenerator();
        newItems = newItems || [...items];
        newBlocks = newBlocks || { ...blocksObj };
        newItems.splice(newItems.indexOf(items[i]), 0, emptyId);
        newBlocks[emptyId] = seedEmpty(cur, prevSlot);
      }
    }
    if (newItems) {
      const updated = setContainerItems(
        parentBlock,
        containerConfig,
        newItems,
        newBlocks,
      );
      return setBlockByPath(formData, parentPath, updated);
    }
  }

  if (items.length > 0) {
    return formData;
  }

  // Container is empty - create a new empty item
  const newBlockId = uuidGenerator();

  if (isObjectList) {
    const idField = containerConfig.idField || 'key';
    const typeFieldName = containerConfig.typeField || null;
    const childType = getEmptyBlockType(containerConfig);

    // Seed through the SAME shared path as initializeContainerBlock and the blocks_layout
    // branch below (seedTemplateChild): applyBlockDefaults for typed items, the field's item
    // schema for single-schema items, plus initialValue, template membership, and nested-
    // container init. This branch used to inline a bare { [idField] } and apply NONE of that,
    // so a re-seeded object_list item silently lost its type's defaults (the blocks_layout
    // branch already applied them — the divergence this collapses).
    let blockData = seedTemplateChild(
      { [idField]: newBlockId, '@type': childType },
      childType,
      newBlockId,
      parentBlock,
      blocksConfig,
      uuidGenerator,
      {
        intl,
        metadata,
        properties,
        itemSchema: typeFieldName ? null : containerConfig.itemSchema,
      },
    );
    // Typed object_list stores the type in its typeField; single-schema items store no type.
    blockData = typeFieldName
      ? setBlockType(blockData, childType, typeFieldName)
      : clearBlockType(blockData);

    const updatedParentBlock = setContainerItems(parentBlock, containerConfig, [
      blockData,
    ]);
    return setBlockByPath(formData, parentPath, updatedParentBlock);
  }

  // Standard blocks container — seed through the SAME shared seedTemplateChild as the
  // object_list branch and initializeContainerBlock. inheritFixed:false because this is a
  // load-time PLACEHOLDER, not an add: a blocks_layout block is edited inline, so inheriting
  // readOnly would freeze editing a template directly (template-edit-mode "a template page
  // loads + edits like a normal page"). Add-time seeds (initializeContainerBlock) DO inherit.
  const blockType = getEmptyBlockType(containerConfig);
  let blockData = seedTemplateChild(
    { '@type': blockType },
    blockType,
    newBlockId,
    parentBlock,
    blocksConfig,
    uuidGenerator,
    { intl, metadata, properties, inheritFixed: false },
  );
  // A FORCED region (allowedLayouts) is template-controlled: its default empty must
  // be a LOCKED template member so it can't be filled per-page — you unlock the
  // template first (like the footer). A fully-empty forced template has no anchor
  // block to inherit from, so derive the membership from the forced layout id
  // (forced layouts use templateInstanceId === templateId; templateId is the
  // allowedLayouts entry — see helpers/index.js forced-apply). Reuse the SAME
  // inheritTemplateMembership the slot-seed path uses; view-mode merge is untouched
  // (this only runs in the editor's empty-seeding).
  const forcedLayout = containerConfig.allowedLayouts?.find(Boolean);
  if (forcedLayout) {
    blockData = inheritTemplateMembership(
      blockData,
      {
        templateInstanceId: forcedLayout,
        templateId: forcedLayout,
        fixed: true,
        readOnly: true,
      },
      { inheritFixed: true },
    );
  }
  const blocksObj = { ...parentBlock.blocks, [newBlockId]: blockData };
  const updatedParentBlock = setContainerItems(
    parentBlock,
    containerConfig,
    [newBlockId],
    blocksObj,
  );
  return setBlockByPath(formData, parentPath, updatedParentBlock);
}

/**
 * Initialize a container block with default child blocks (recursively).
 * Call this when creating a new block to pre-populate containers.
 *
 * For example, when creating a 'columns' block:
 * - columns has allowedBlocks: ['column'], so creates a column inside
 * - column has defaultBlockType: 'slate', so creates a slate inside that column
 *
 * @param {Object} blockData - The block data (with at least '@type')
 * @param {Object} blocksConfig - Block configuration from registry
 * @param {Function} uuidGenerator - Function to generate UUIDs
 * @param {Object} options - Options for block initialization
 * @param {Object} options.intl - Intl object for i18n
 * @param {Object} options.metadata - Metadata from form
 * @param {Object} options.properties - Form properties
 * @returns {Object} Block data with container fields initialized (if applicable)
 */
export function initializeContainerBlock(
  blockData,
  blocksConfig,
  uuidGenerator,
  options = {},
  schema,
) {
  const { intl, siblingData, blockType } = options;

  // Get schema from block type if not provided (e.g., recursing into widget: 'object')
  // Use type-level cache since we're initializing an empty new block — no instance data yet.
  if (!schema) {
    schema = getBlockTypeSchema(blockType, intl, blocksConfig);
  }

  if (!schema?.properties) {
    return blockData;
  }

  // Find ALL container fields (widget: 'blocks_layout') and initialize each one
  let result = { ...blockData };

  for (const [fieldName, fieldDef] of Object.entries(schema.properties)) {
    // Descend into nested object fields (e.g., accordion's `data` wrapper)
    if (fieldDef.widget === 'object' && fieldDef.schema?.properties) {
      if (!result[fieldName]) result[fieldName] = {};
      result[fieldName] = initializeContainerBlock(
        result[fieldName],
        blocksConfig,
        uuidGenerator,
        options,
        fieldDef.schema,
      );
      continue;
    }

    // Respect an already-populated container field — object_list OR blocks_layout — e.g. a
    // field-level `default` applied by applyBlockDefaults (the codeExample block's `tabs`
    // defaults to one JavaScript tab). Both seed branches below overwrite unconditionally, so
    // this ONE guard (not per-branch) leaves a populated field alone. Storage shapes differ:
    // object_list stores an item array; blocks_layout stores { items: [ids] }.
    if (
      fieldDef.widget === 'object_list' ||
      fieldDef.widget === 'blocks_layout'
    ) {
      const existing =
        fieldDef.widget === 'object_list'
          ? result[fieldName]
          : result[fieldName]?.items;
      if (Array.isArray(existing) && existing.length > 0) {
        continue;
      }
    }

    // Handle object_list containers (like cells in a row)
    if (fieldDef.widget === 'object_list') {
      const idField = fieldDef.idField || '@id';
      const typeFieldName = fieldDef.typeField || null;
      const hasAllowedBlocks = !!fieldDef.allowedBlocks;

      // Determine child type. Typed mode (allowedBlocks): the SAME centralized decision as
      // the blocks_layout branch below — getEmptyBlockType (default → single allowed →
      // 'empty' picker). Presuming allowedBlocks[0] here silently seeded the first allowed
      // type instead of letting the author choose. Single-schema mode (no allowedBlocks): a
      // synthetic per-field type so applyBlockDefaults can find the item schema.
      const childType = hasAllowedBlocks
        ? getEmptyBlockType(fieldDef)
        : `${blockType}:${fieldName}`;

      // For table mode: copy child count from sibling rows
      // siblingData is passed when adding a new row to a table-mode container
      let childCount = 1;
      if (siblingData?.length > 0 && siblingData[0]?.[fieldName]) {
        // Count children in first sibling row's same field
        const siblingField = siblingData[0][fieldName];
        childCount = Array.isArray(siblingField) ? siblingField.length : 1;
      }

      const children = [];
      for (let i = 0; i < childCount; i++) {
        const childId = uuidGenerator();
        // Seed via the shared storage-agnostic path (defaults → initialValue → membership →
        // recurse); this branch then stores the child's type + pushes it into the array.
        let childData = seedTemplateChild(
          { [idField]: childId, '@type': childType },
          childType,
          childId,
          blockData,
          blocksConfig,
          uuidGenerator,
          options,
        );

        if (hasAllowedBlocks && typeFieldName) {
          // Typed object_list: store the type in the typeField (dropping @type).
          childData = setBlockType(childData, childType, typeFieldName);
        } else {
          // Single-schema object_list: items store no type — drop the @type used for defaults.
          childData = clearBlockType(childData);
        }

        children.push(childData);
      }

      result = {
        ...result,
        [fieldName]: children,
      };
      continue;
    }

    if (fieldDef.widget !== 'blocks_layout') {
      continue;
    }

    // The SAME centralized type decision as the object_list branch above (getEmptyBlockType):
    // default → single allowed → 'empty'. Here 'empty' means "no determinable type" → seed
    // an empty list; ensureEmptyBlockIfEmpty seeds the 'empty' placeholder on demand.
    const childBlockType = getEmptyBlockType(fieldDef);

    // No determinable child type - initialize an empty list for this blocks
    // field (a key in the shared blocks_layout dict; preserve sibling fields).
    if (childBlockType === 'empty') {
      result = {
        ...result,
        blocks: { ...(result.blocks || {}) },
        blocks_layout: { ...(result.blocks_layout || {}), [fieldName]: [] },
      };
      continue;
    }

    // Create + seed the child via the SAME storage-agnostic path as the object_list branch
    // above (defaults → initialValue → membership → recurse); this branch then places it in the
    // shared blocks dict + the field's layout list.
    const childBlockId = uuidGenerator();
    const childBlockData = seedTemplateChild(
      { '@type': childBlockType },
      childBlockType,
      childBlockId,
      blockData,
      blocksConfig,
      uuidGenerator,
      options,
    );

    // Add child to shared blocks dict + this blocks field's list inside the
    // shared blocks_layout dict (key = field name; preserve sibling fields).
    result = {
      ...result,
      blocks: {
        ...(result.blocks || {}),
        [childBlockId]: childBlockData,
      },
      blocks_layout: {
        ...(result.blocks_layout || {}),
        [fieldName]: [childBlockId],
      },
    };
  }

  return result;
}

/**
 * Seed ONE default child of a container — STORAGE-AGNOSTIC. The object_list (array) and
 * blocks_layout (shared dict) branches of initializeContainerBlock used to duplicate this exact
 * sequence; now they share it and differ only in how they PLACE the result (array push vs dict +
 * layout) and store the child's id/type. The sequence: schema defaults → the block's initialValue
 * → inherit the container's template membership → recurse to seed grandchildren.
 *
 * Membership is stamped CONTAINER-DIRECT (from the container's own templateInstanceId) via
 * inheritTemplateMembership — deliberately NOT via the ADD path's applyBlockDefaultsWithContext,
 * which derives it from the container's childSlotIds. A freshly-added container has no childSlotIds
 * yet, so routing seeds through that initializer would leave them unstamped and the merge would
 * drop them (the "field disappears" bug). Stamped before the recursion so grandchildren inherit.
 *
 * @param {Object} childData - initial child data ({ [idField]/@type } already set by the caller)
 * @param {string} childType - the child's block type (used for defaults + initialValue + recursion)
 * @param {string} childId - the child's id (passed to initialValue)
 * @param {Object} container - the parent container block (source of template membership)
 * @returns {Object} the fully seeded child
 */
function seedTemplateChild(
  childData,
  childType,
  childId,
  container,
  blocksConfig,
  uuidGenerator,
  options,
) {
  // inheritFixed defaults to deriving from the container (add-time seeds join fixed content).
  // A caller may force it off — e.g. ensureEmptyBlockIfEmpty seeding an editable *placeholder*
  // in a template being edited directly, where inheriting readOnly would freeze inline editing.
  const { intl, metadata, properties, inheritFixed } = options;
  if (intl) {
    childData = getApplyBlockDefaults()(
      { data: childData, intl, metadata, properties },
      blocksConfig,
    );
  }
  const childConfig = blocksConfig?.[childType];
  if (childConfig?.initialValue) {
    // Full initialValue signature (id + value + intl). No block's initialValue reads intl
    // today (verified), so intl here is alignment/future-proofing, not a behaviour change —
    // but it means every seed path (object_list + blocks_layout) drives initialValue the same.
    childData = childConfig.initialValue({
      id: childId,
      value: childData,
      formData: undefined,
      intl,
    });
  }
  childData = inheritTemplateMembership(childData, container, {
    inheritFixed: inheritFixed ?? !!container?.templateInstanceId,
  });
  return initializeContainerBlock(childData, blocksConfig, uuidGenerator, {
    ...options,
    blockType: childType,
  });
}

/**
 * Reorder blocks within a container by providing the new order array.
 * Used by the sidebar ChildBlocksWidget for drag-and-drop reordering.
 *
 * @param {Object} formData - The form data
 * @param {Object} blockPathMap - Map of blockId -> { path, parentId }
 * @param {string|null} parentBlockId - Parent block ID (PAGE_BLOCK_UID for page-level)
 * @param {string} fieldName - Container field name (e.g., 'blocks', 'columns')
 * @param {Array<string>} newOrder - New order of block IDs
 * @param {Object} blocksConfig - Block configuration from registry
 * @param {Object} intl - The intl object from react-intl
 * @returns {Object} New formData with blocks reordered
 */
export function reorderBlocksInContainer(
  formData,
  blockPathMap,
  parentBlockId,
  region,
  newOrder,
  blocksConfig = null,
  intl = null,
) {
  // If parent is a virtual template instance, resolve to the instance's actual parent
  let effectiveParentId = parentBlockId;
  if (blockPathMap[parentBlockId]?.isTemplateInstance) {
    effectiveParentId = blockPathMap[parentBlockId].parentId;
  }

  // parentPath is [] for page-level (parentBlockId === PAGE_BLOCK_UID)
  const parentPath =
    effectiveParentId === PAGE_BLOCK_UID
      ? []
      : blockPathMap[effectiveParentId]?.path;
  if (effectiveParentId !== PAGE_BLOCK_UID && !parentPath) {
    console.error('[REORDER] Could not find parent path for:', parentBlockId);
    return formData;
  }

  const parentBlock = getBlockByPath(formData, parentPath);
  if (!parentBlock) {
    console.error('[REORDER] Could not find parent block:', parentBlockId);
    return formData;
  }

  // Build containerConfig from a child's pathInfo, not the parent schema:
  // an object_list nested inside a widget:'object' is not at
  // schema.properties[region], and its object prefix (regionPath, e.g. [table])
  // only lives on the child's pathInfo. Any child in the reordered set carries
  // region/regionPath/idField for the whole container.
  const sampleChild = blockPathMap[newOrder[0]];
  const isObjectList = !!sampleChild?.isObjectListItem;
  const containerConfig = {
    region,
    isObjectList,
    regionPath: sampleChild?.regionPath || [],
    idField: sampleChild?.idField || '@id',
  };

  const items = getContainerItems(parentBlock, containerConfig);
  const reorderedItems = reorderContainerItems(
    items,
    newOrder,
    containerConfig,
  );
  const updatedParent = setContainerItems(
    parentBlock,
    containerConfig,
    reorderedItems,
  );

  return setBlockByPath(formData, parentPath, updatedParent);
}

/**
 * Move a block from one location to another (supports same-container reorder,
 * cross-container moves, and page↔container moves).
 *
 * @param {Object} formData - The form data
 * @param {Object} blockPathMap - Map of blockId -> { path, parentId }
 * @param {string} blockId - Block being moved
 * @param {string} targetBlockId - Block to insert relative to
 * @param {boolean} insertAfter - True to insert after target, false for before
 * @param {string|null} sourceParentId - Parent of source block (PAGE_BLOCK_UID for page-level)
 * @param {string|null} targetParentId - Parent of target block (PAGE_BLOCK_UID for page-level)
 * @param {Object} blocksConfig - Block configuration from registry
 * @param {Object} intl - The intl object from react-intl
 * @returns {Object|null} New formData with block moved, or null if invalid move
 */
export function moveBlockBetweenContainers(
  formData,
  blockPathMap,
  blockId,
  targetBlockId,
  insertAfter,
  sourceParentId,
  targetParentId,
  blocksConfig,
  intl,
) {
  // Get block data to move
  const sourcePath = blockPathMap[blockId]?.path;
  const blockData = getBlockByPath(formData, sourcePath);
  console.log(
    '[MOVE_BLOCK] sourcePath:',
    sourcePath,
    'blockData:',
    blockData ? 'found' : 'null',
    'blockType:',
    blockData?.['@type'],
  );

  if (!blockData) {
    console.error('[MOVE_BLOCK] Could not find block data for:', blockId);
    return null;
  }

  // Same container - just reorder
  // Check parentId AND region: page-level blocks in different regions (e.g. the
  // items region vs the footer region) all have parentId=PAGE_BLOCK_UID, so
  // without the region check a cross-region move would be mis-handled as a
  // same-list reorder.
  const sourceRegion = blockPathMap[blockId]?.region || 'items';
  const targetRegion = blockPathMap[targetBlockId]?.region || 'items';
  if (sourceParentId === targetParentId && sourceRegion === targetRegion) {
    return reorderBlockInContainer(
      formData,
      blockPathMap,
      blockId,
      targetBlockId,
      insertAfter,
      sourceParentId,
      blocksConfig,
      intl,
    );
  }

  // Different containers - need to remove from source and add to target
  // First, delete from source
  const sourceContainerConfig = getContainerFieldConfig(
    blockId,
    blockPathMap,
    formData,
    blocksConfig,
    intl,
  );
  if (!sourceContainerConfig) {
    console.error(
      '[MOVE_BLOCK] Could not find source container config for block:',
      blockId,
    );
    return null;
  }

  let newFormData = deleteBlockFromContainer(
    formData,
    blockPathMap,
    blockId,
    sourceContainerConfig,
  );

  // Get target container config by looking up target block's container
  const targetContainerConfig = getContainerFieldConfig(
    targetBlockId,
    blockPathMap,
    formData,
    blocksConfig,
    intl,
  );
  if (!targetContainerConfig) {
    console.error(
      '[MOVE_BLOCK] Could not find target container config for block:',
      targetBlockId,
    );
    return null;
  }

  // Validate that block type is allowed in target container
  const sourcePathInfo = blockPathMap[blockId];
  const blockType = sourcePathInfo?.blockType || blockData?.['@type'];
  const targetAllowedBlocks = blockPathMap[targetBlockId]?.allowedSiblingTypes;
  if (
    targetAllowedBlocks &&
    blockType &&
    !targetAllowedBlocks.includes(blockType)
  ) {
    console.warn(
      '[MOVE_BLOCK] Block type not allowed in target container:',
      blockType,
      'allowed:',
      targetAllowedBlocks,
    );
    return null; // Reject the move
  }

  // Adapt block data for target format
  // When moving between object_list and blocks containers, the data needs cleaning
  let adaptedBlockData = { ...blockData };

  // Strip source-format-specific ID field if moving FROM object_list
  if (sourceContainerConfig.isObjectList) {
    const sourceIdField = sourceContainerConfig.idField || '@id';
    delete adaptedBlockData[sourceIdField];
  }

  // When moving TO blocks container, ensure @type is set
  if (
    !targetContainerConfig.isObjectList &&
    !adaptedBlockData['@type'] &&
    blockType
  ) {
    adaptedBlockData['@type'] = blockType;
  }

  // When moving TO a typed object_list, write the type into the typeField (dropping @type).
  if (
    targetContainerConfig.isObjectList &&
    targetContainerConfig.typeField &&
    blockType
  ) {
    adaptedBlockData = setBlockType(
      adaptedBlockData,
      blockType,
      targetContainerConfig.typeField,
    );
  }

  // Use insertBlockInContainer for the target insertion (handles both formats)
  const action = insertAfter ? 'after' : 'before';
  newFormData = insertBlockInContainer(
    newFormData,
    blockPathMap,
    targetBlockId,
    blockId,
    adaptedBlockData,
    targetContainerConfig,
    action,
  );

  return newFormData;
}

/**
 * Reorder a block within the same container.
 */
function reorderBlockInContainer(
  formData,
  blockPathMap,
  blockId,
  targetBlockId,
  insertAfter,
  parentId,
  blocksConfig,
  intl,
) {
  const containerConfig = getContainerFieldConfig(
    blockId,
    blockPathMap,
    formData,
    blocksConfig,
    intl,
  );
  if (!containerConfig) {
    console.error(
      '[MOVE_BLOCK] Could not find container config for block:',
      blockId,
    );
    return null;
  }

  const parentPath =
    parentId === PAGE_BLOCK_UID ? [] : blockPathMap[parentId]?.path;
  const parentBlock = getBlockByPath(formData, parentPath);
  if (!parentBlock) {
    console.error('[MOVE_BLOCK] Could not find parent block:', parentId);
    return null;
  }

  // Compute new ID order from blockId + targetBlockId + insertAfter
  const items = getContainerItems(parentBlock, containerConfig);
  const idField = containerConfig.isObjectList
    ? containerConfig.idField || '@id'
    : null;
  const getId = idField ? (item) => item[idField] : (item) => item;

  const ids = items.map(getId);
  const currentIndex = ids.indexOf(blockId);
  const targetIndex = ids.indexOf(targetBlockId);

  if (currentIndex === -1 || targetIndex === -1) {
    console.error('[MOVE_BLOCK] Block not found in container:', {
      blockId,
      targetBlockId,
      ids,
    });
    return null;
  }

  ids.splice(currentIndex, 1);
  let newIndex = currentIndex < targetIndex ? targetIndex - 1 : targetIndex;
  if (insertAfter) newIndex++;
  ids.splice(newIndex, 0, blockId);

  // Delegate to reorderBlocksInContainer which handles both formats
  return reorderBlocksInContainer(
    formData,
    blockPathMap,
    parentId,
    containerConfig.region,
    ids,
    blocksConfig,
    intl,
  );
}

/**
 * Get the index to insert at in the target container.
 */
function getInsertionIndex(
  formData,
  blockPathMap,
  targetBlockId,
  insertAfter,
  containerConfig,
) {
  if (!containerConfig) {
    throw new Error(`[HYDRA] getInsertionIndex: containerConfig required`);
  }

  const { parentId } = containerConfig;

  // parentPath is [] for page-level (parentId === PAGE_BLOCK_UID)
  const parentPath =
    parentId === PAGE_BLOCK_UID ? [] : blockPathMap[parentId]?.path;
  const parentBlock = getBlockByPath(formData, parentPath);
  // Region-scoped read so cross-region inserts index into the right list.
  const items = parentBlock
    ? getContainerItems(parentBlock, containerConfig)
    : [];

  const targetIndex = items.indexOf(targetBlockId);
  if (targetIndex === -1) {
    // Target not found, insert at end
    return items.length;
  }

  return insertAfter ? targetIndex + 1 : targetIndex;
}

/**
 * Find the lowest common ancestor of multiple blocks.
 * Walks up the parent chain for each block and finds the deepest
 * ancestor shared by all.
 *
 * @param {Object} blockPathMap - The block path map
 * @param {string[]} blockUids - Array of block UIDs
 * @returns {string} The common ancestor block UID, or PAGE_BLOCK_UID
 */
export function getCommonAncestor(blockPathMap, blockUids) {
  if (!blockUids || blockUids.length === 0) return PAGE_BLOCK_UID;
  if (blockUids.length === 1)
    return blockPathMap[blockUids[0]]?.parentId || PAGE_BLOCK_UID;

  // Build ancestor chain for each block (including self)
  const getAncestors = (uid) => {
    const chain = [];
    let current = uid;
    while (current && current !== PAGE_BLOCK_UID) {
      chain.unshift(current); // prepend so chain goes root → leaf
      current = blockPathMap[current]?.parentId;
    }
    chain.unshift(PAGE_BLOCK_UID);
    return chain;
  };

  const chains = blockUids.map(getAncestors);

  // Walk chains in parallel, find last common element
  let common = PAGE_BLOCK_UID;
  for (let i = 0; i < chains[0].length; i++) {
    const ancestor = chains[0][i];
    if (chains.every((chain) => chain[i] === ancestor)) {
      common = ancestor;
    } else {
      break;
    }
  }
  return common;
}


/**
 * Remove the 'empty' placeholder a block was just dropped onto.
 *
 * A drop onto a placeholder means "put it HERE", so the placeholder goes and the
 * dropped block takes its position rather than sitting beside it.
 *
 * Call this AFTER the dropped block's membership has been re-derived
 * (applyMembershipAfterMove). The placeholder is a neighbour, and in a forced
 * region it is the only neighbour carrying the template — remove it first and
 * there is nothing left to derive membership from, so the block that just landed
 * in the region does not belong to it.
 *
 * Written twice before this: once in the drag path, once in the chooser's
 * ask-first drop, which is how the two came to disagree about ordering.
 *
 * @returns {Object} formData — unchanged when the target isn't an 'empty'
 */
export function removeReplacedPlaceholder(
  formData,
  blockPathMap,
  replaceTargetId,
  { blocksConfig, intl },
) {
  if (!replaceTargetId) return formData;
  const blockData = getBlockById(formData, blockPathMap, replaceTargetId);
  if (blockData?.['@type'] !== 'empty') return formData;
  const containerConfig = getContainerFieldConfig(
    replaceTargetId,
    blockPathMap,
    formData,
    blocksConfig,
    intl,
  );
  if (!containerConfig) return formData;
  return deleteBlockFromContainer(
    formData,
    blockPathMap,
    replaceTargetId,
    containerConfig,
  );
}
