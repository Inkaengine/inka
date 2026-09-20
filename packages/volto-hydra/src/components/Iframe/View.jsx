import { addUrlParams } from '../../utils/iframeUrl';
import ViewPane from './ViewPane';
import { ReadOnlyForm } from '../Sidebar/ReadOnlyForm';
import {
  counterpartBlockId,
  untranslatedBlockIds,
  withAllBlocksReadOnly,
} from '@volto-hydra/helpers';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { isEqual } from 'lodash';
import { v4 as uuid } from 'uuid';
import { useHistory } from 'react-router-dom';
import Cookies from 'js-cookie';
import { Node } from 'slate';
import {
  applyBlockDefaults,
} from '@plone/volto/helpers';
import { validateAndLog, validateTemplatePlaceholders } from '../../utils/formDataValidation';
import { toast } from 'react-toastify';
import { getIframeUrlCookieName } from '../../utils/cookieNames';
import { PAGE_BLOCK_UID } from '@volto-hydra/hydra-js';
import {
  isSlateFieldType,
  formDataContentEqual,
  getUniqueTemplateIds,
  getBlockType,
  isBlockReadonly,
  isBlockPositionLocked,
  getFieldValue,
  setFieldValue,
} from '@volto-hydra/helpers';
import Api from '@plone/volto/helpers/Api/Api';

import { setBlocksClipboard, resetBlocksClipboard } from '@plone/volto/actions/blocksClipboard/blocksClipboard';
import { cloneBlocks } from '@plone/volto/helpers/Blocks/cloneBlocks';
import { createLog } from '../../utils/log';

const log = createLog('VIEW');
const logExtract = createLog('EXTRACT'); // eslint-disable-line no-unused-vars

/**
 * Get field type string in "type:widget" format.
 * Formats:
 *   - "string:textarea" (type and widget)
 *   - "array:slate" (type and widget)
 *   - ":object_browser" (widget only, no type)
 *   - "string" (type only, no widget - default text field)
 *   - "boolean" (type only)
 *
 * @param {Object} field - Field definition from schema.properties
 * @returns {string} Field type string
 */
const getFieldTypeString = (field) => {
  const type = field.type;
  const widget = field.widget;

  if (type && widget) {
    return `${type}:${widget}`;
  }
  if (widget) {
    return `:${widget}`;
  }
  if (type) {
    return type;
  }
  // No type or widget specified - defaults to string (TextWidget)
  return 'string';
};

/**
 * Validates if a selection is valid for the given slate value.
 * Returns true if all paths in the selection exist in the document.
 */
/**
 * Count the items currently in a block's container.
 * Works for page-level fields, blocks_layout containers and object_list
 * containers (used for the maxLength check below).
 */
function countContainerItems(formData, blockPathMap, containerConfig) {
  const parent =
    getBlockById(formData, blockPathMap, containerConfig.parentId) || formData;
  if (containerConfig.isObjectList) {
    let arr = parent;
    for (const key of [...(containerConfig.regionPath || []), containerConfig.region]) {
      arr = arr?.[key];
    }
    return Array.isArray(arr) ? arr.length : 0;
  }
  return parent?.blocks_layout?.[containerConfig.region || 'items']?.length ?? 0;
}

/**
 * Enforce the one-node-per-slate-field invariant.
 *
 * A slate field must hold a single top-level node. When one holds several
 * (paste, a deleteBackward demote producing [ul, p], imported content),
 * this either SPLITS — each extra node becomes its own sibling block — or,
 * when splitting is impossible, FLATTENS the value into a single node.
 *
 * Splitting only works when the block is itself a `slate` block (so the new
 * `{ '@type': 'slate', value: [...] }` siblings are valid) AND its container
 * can take that many more slate blocks. It is NOT possible for:
 *  - a slate-typed field of a non-slate block (slateTable cell `value`,
 *    teaser `description`, …) — there is no slate-block sibling to create;
 *  - a full container (maxLength reached) or one that disallows `slate`;
 *  - a table-mode container, where a new sibling means a new column.
 * In those cases the extra nodes are flattened into the first node.
 *
 * Returns null if nothing needed changing, otherwise { formData,
 * selectBlockId, selection }.
 */
function splitMultiNodeSlateBlocks(formData, blockPathMap, blocksConfig, uuidGenerator, selection) {
  let result = formData;
  let selectBlockId = null;
  let flattenedAny = false;

  for (const [blockId, pathInfo] of Object.entries(blockPathMap)) {
    if (blockId.startsWith('_')) continue;
    const blockType = pathInfo.blockType;
    if (!blockType || blockType === 'title' || blockType === 'description') continue;

    const block = getBlockById(result, blockPathMap, blockId);
    if (!block) continue;

    // Check slate fields for multiple top-level nodes
    const schema = getResolvedSchema(pathInfo, blockPathMap);
    if (!schema?.properties) continue;

    // Slate field PATHS, descending widget:'object' so a nested slate field
    // (content/headline) is enforced too — not just top-level fields.
    const slateFieldPaths = [];
    const collectSlate = (props, prefix) => {
      for (const [fn, fd] of Object.entries(props)) {
        if (fd.widget === 'object' && fd.schema?.properties) {
          collectSlate(fd.schema.properties, `${prefix}${fn}/`);
          continue;
        }
        if (isSlateFieldType(getFieldTypeString(fd))) {
          slateFieldPaths.push(`${prefix}${fn}`);
        }
      }
    };
    collectSlate(schema.properties, '');

    for (const fieldName of slateFieldPaths) {
      const value = getFieldValue(block, fieldName);
      if (!Array.isArray(value) || value.length <= 1) continue;

      const restNodes = value.slice(1);

      // Can this multi-node value be split into sibling slate blocks? Only a
      // TOP-LEVEL field of a slate block can (a nested object field has no
      // region to add siblings to — it flattens instead).
      const containerConfig = blockType === 'slate' && !fieldName.includes('/')
        ? getContainerFieldConfig(blockId, blockPathMap, result, blocksConfig)
        : null;
      const splittable =
        blockType === 'slate' &&
        !fieldName.includes('/') &&
        !!containerConfig &&
        containerConfig.addMode !== 'table' &&
        (containerConfig.allowedBlocks == null ||
          containerConfig.allowedBlocks.includes('slate')) &&
        (containerConfig.maxLength == null ||
          countContainerItems(result, blockPathMap, containerConfig) +
            restNodes.length <=
            containerConfig.maxLength);

      if (!splittable) {
        // Flatten: merge every node's children into the first node so the
        // field holds exactly one top-level node. No data is discarded.
        const merged = {
          ...value[0],
          children: value.flatMap((n) =>
            Array.isArray(n.children) ? n.children : [],
          ),
        };
        if (merged.children.length === 0) merged.children = [{ text: '' }];
        result = updateBlockById(result, blockPathMap, blockId,
          setFieldValue(block, fieldName, [merged]),
        );
        flattenedAny = true;
        continue;
      }

      // Split: keep the first node, each remaining node becomes a new
      // sibling slate block. Chain inserts so each goes after the previous.
      // (fieldName here is a top-level slate-block field, never nested.)
      result = updateBlockById(result, blockPathMap, blockId,
        setFieldValue(block, fieldName, [value[0]]),
      );
      let afterBlockId = blockId;
      for (let i = 0; i < restNodes.length; i++) {
        const newBlockId = uuidGenerator();
        const newBlockData = { '@type': 'slate', [fieldName]: [restNodes[i]] };
        result = insertBlockInContainer(
          result, blockPathMap, afterBlockId, newBlockId, newBlockData, containerConfig, 'after',
        );
        afterBlockId = newBlockId;
        if (i === 0) selectBlockId = newBlockId;
      }

      // Translate selection: cursor at [N, ...] in the unsplit value maps
      // to [0, ...] in the Nth new block.
      let newSelection = null;
      if (selection?.anchor?.path?.[0] > 0) {
        const translatePath = (p) => [0, ...p.slice(1)];
        newSelection = {
          anchor: { ...selection.anchor, path: translatePath(selection.anchor.path) },
          focus: { ...selection.focus, path: translatePath(selection.focus.path) },
        };
      }

      // Only process one split per render cycle to avoid stale blockPathMap.
      // Flattens done so far this pass ride along in `result`.
      return { formData: result, selectBlockId, selection: newSelection };
    }
  }

  if (flattenedAny) {
    return { formData: result, selectBlockId: null, selection: null };
  }
  return null;
}

function isSelectionValidForValue(selection, slateValue) {
  if (!selection) return true; // No selection is always valid
  if (!slateValue || !Array.isArray(slateValue)) return false;

  const doc = { children: slateValue };

  try {
    // Paths must resolve to text leaves, not element nodes.
    // A path like [0, 0] pointing to a li element is not a valid
    // cursor position — it must reach a text node like [0, 0, 0].
    if (selection.anchor?.path) {
      const node = Node.get(doc, selection.anchor.path);
      if (typeof node.text !== 'string') return false;
    }
    if (selection.focus?.path) {
      const node = Node.get(doc, selection.focus.path);
      if (typeof node.text !== 'string') return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}
import './styles.css';
import { useIntl } from 'react-intl';
import config from '@plone/volto/registry';
import { BlockChooser, Icon, Toast } from '@plone/volto/components';
import { Menu, Dimmer, Loader, Confirm } from 'semantic-ui-react';
import { createPortal, flushSync } from 'react-dom';
import { usePopper } from 'react-popper';
import { useSelector, useDispatch } from 'react-redux';
import { getURlsFromEnv } from '../../utils/getSavedURLs';
import { setSidebarTab } from '@plone/volto/actions';
import blockSVG from '@plone/volto/icons/block.svg';
import columnAfterSVG from '@plone/volto/icons/column-after.svg';
import rowAfterSVG from '@plone/volto/icons/row-after.svg';
import { setAllowedBlocksList } from '../../utils/allowedBlockList';
import toggleMark from '../../utils/toggleMark';
import slateTransforms from '../../utils/slateTransforms';
// Note: Editor, Transforms, toggleInlineFormat, toggleBlock were removed
// as applyFormat was replaced by SLATE_TRANSFORM_REQUEST handling
import OpenObjectBrowser from './OpenObjectBrowser';
import SyncedSlateToolbar from '../Toolbar/SyncedSlateToolbar';
import { getBlockTypeSchema } from '../../utils/blockPath';
import { removeReplacedPlaceholder, buildBlockPathMap, buildIdFieldMap, stripBlockPathMapForPostMessage, getBlockByPath, getBlockById, updateBlockById, getChildBlockIds, getContainerFieldConfig, getSelectAfterDelete, insertBlockInContainer, deleteBlockFromContainer, mutateBlockInContainer, ensureEmptyBlockIfEmpty, initializeContainerBlock, moveBlockBetweenContainers, reorderBlocksInContainer, getAllContainerFields, insertTableColumn, deleteTableColumn, removeTemplateInstance, getContainerItems, getResolvedSchema, getCommonAncestor, wrapBlocksInContainer, unwrapContainer, getEmptyBlockType, getContainerRegionDescriptors } from '../../utils/blockPath';
import { mergeAnchorsIntoContent } from '../../utils/linkableAnchors';
import { installStyleMenuPreviewCss } from '../../utils/styleMenuPreviewCss';
import { canContainAll, getChildBlockEntries, setBlockType, clearBlockType } from '@volto-hydra/helpers';
import { mergeTemplatesIntoPage } from '../../utils/mergeTemplates.mjs';
import {
  applySchemaDefaultsToFormData,
  previewSchemaDefaultConversions,
  filterAddableTypesByRule,
  applyBlockDefaultsWithContext,
  applyMembershipAfterMove,
  settleBlockStructure,
  deleteBlocks,
  canInsertBesideBlock,
  createSchemaEnhancerFromRecipe,
  installVariationFieldEnhancers,
  installChildBlockEnhancers,
  populateTypeSchemaCache,
  syncChildBlockTypes,
  getConvertibleTypes,
  getConversionMap,
  convertBlockType,
  reshapeContainerBlock,
  validateFieldMappings,
  reportDisallowedSlateNodes,
} from '../../utils/blockSync';
import {
  installCopyFromTargetEnhancers,
  markEditedLinkedFieldsCustom,
  getUrlField,
  pullLinkedFields,
  pullAllLinkedFields,
} from '../../utils/copyFromTarget';
import { flattenToAppURL, isInternalURL } from '@plone/volto/helpers/Url/Url';
import { searchContent } from '@plone/volto/actions/search/search';
import ChildBlocksWidget from '../Sidebar/ChildBlocksWidget';
import ParentBlocksWidget from '../Sidebar/ParentBlocksWidget';

/**
 * NoPreview component for frontend-defined blocks.
 * Prevents React errors when Volto tries to render a preview for blocks
 * that have Slate values or other non-serializable content.
 */
const NoPreview = () => null;

/**
 * Block types that keep their admin Edit component in the sidebar even though a
 * schema is declared for them.
 *
 * `slate`: hydra's own schema carries the `value` field block-sync and the
 * shadowed text editor depend on, which no frontend can know to send.
 *
 * `title` / `description` / `leadimage`: windows onto the PAGE's fields, not
 * blocks with data of their own — the page metadata form already edits those.
 * Their schema is still what gives the canvas its placeholder. Routing them to
 * the schema form costs the page field itself: the leadimage's own schema
 * describes only `align`, so `/preview_image` — the thing it renders — stopped
 * being reachable and clicking the image raised no toolbar.
 */
const SCHEMA_KEEPS_ADMIN_FORM = new Set([
  'slate',
  'title',
  'description',
  'leadimage',
]);

/**
 * Validate frontend configuration passed to initBridge.
 * Collects all validation errors and throws a single error with all issues.
 *
 * @param {Object} options - Options from FRONTEND_INIT message
 * @param {string[]} options.allowedBlocks - Page-level allowed block types
 * @param {Object} options.voltoConfig - Frontend's custom config
 * @param {Object} mergedBlocksConfig - Full merged blocks configuration
 * @throws {Error} If any validation errors are found
 */
const validateFrontendConfig = (options, mergedBlocksConfig) => {
  const errors = [];

  // Future validations can be added here as needed
  // Frontend developers control what's allowed where via allowedBlocks

  if (errors.length > 0) {
    throw new Error(`[HYDRA] initBridge config error:\n- ${errors.join('\n- ')}`);
  }
};

/**
 * Extract field types for all block types from schema registry
 * @param {Object} intl - The react-intl intl object for internationalization
 * @param {Object} contentTypeSchema - Optional content type schema for page-level fields
 * @returns {Object} - Object mapping blockType -> fieldName -> fieldType
 *
 * We look up schemas from config.blocks.blocksConfig for each registered block type
 * and identify which fields are Slate fields (widget: 'slate') vs text fields.
 * This way it works for all blocks of that type, including ones added later.
 */
const extractBlockFieldTypes = (intl, contentTypeSchema = null) => {
  const blockFieldTypes = {};

  if (!config.blocks?.blocksConfig) {
    return blockFieldTypes;
  }

  // Hardcode known block types that don't have schemas
  // Slate blocks always have a 'value' field that is a slate field
  blockFieldTypes.slate = { value: 'array:slate' };
  blockFieldTypes.detachedSlate = { value: 'array:slate' };

  // Extract page-level field types from content type schema
  // These are accessed via /fieldName syntax (e.g., /title, /description)
  if (contentTypeSchema?.properties) {
    blockFieldTypes._page = {};
    Object.keys(contentTypeSchema.properties).forEach((fieldName) => {
      const field = contentTypeSchema.properties[fieldName];
      blockFieldTypes._page[fieldName] = getFieldTypeString(field);
    });
    logExtract('Page-level field types from content type schema:', blockFieldTypes._page);
  }

  // Iterate through all registered block types
  Object.keys(config.blocks.blocksConfig).forEach((blockType) => {
    const blockConfig = config.blocks.blocksConfig[blockType];
    if (!blockConfig) {
      return;
    }

    try {
      // Get schema - can be a function or an object
      const schema = typeof blockConfig.blockSchema === 'function'
        ? blockConfig.blockSchema({ ...config, formData: {}, intl })
        : blockConfig.blockSchema;

      // Debug: Log hero block schema processing
      if (blockType === 'hero') {
        logExtract('Processing hero block, blockConfig.blockSchema:', blockConfig.blockSchema);
        logExtract('Hero schema after resolution:', schema);
        logExtract('Hero schema.properties:', schema?.properties);
      }

      if (!schema?.properties) {
        return;
      }

      // Map each field to its type for this block type
      // Preserve any hardcoded values (like slate.value) by merging, not overwriting
      if (!blockFieldTypes[blockType]) {
        blockFieldTypes[blockType] = {};
      }
      // Walk a schema's properties, recording each field's type under `typeKey`
      // and registering a virtual block type for every object_list field
      // (`typeKey:fieldName`) so getBlockTypeSchema / getAllContainerFields can
      // resolve object_list items (e.g. table rows/cells) by their virtual type.
      //
      // widget:'object' wrappers: the VIRTUAL TYPE key stays transparent (a
      // container nested in an object, e.g. `rows` inside the `table` object,
      // still registers as `slateTable:rows` — the object name never enters the
      // key, matching buildBlockPathMap's processItem). But a field's TYPE is
      // recorded under its `/`-path storage key (`content/headline`), so the map
      // matches how object sub-fields are addressed for inline editing (#245).
      // Arbitrary depth, both nesting kinds.
      const registerFieldTypes = (typeKey, properties, fieldPrefix = '') => {
        if (!blockFieldTypes[typeKey]) blockFieldTypes[typeKey] = {};
        Object.keys(properties).forEach((fieldName) => {
          const field = properties[fieldName];

          // Object wrapper — descend with a `/`-path prefix, same typeKey.
          if (field.widget === 'object' && field.schema?.properties) {
            registerFieldTypes(typeKey, field.schema.properties, `${fieldPrefix}${fieldName}/`);
            return;
          }

          blockFieldTypes[typeKey][`${fieldPrefix}${fieldName}`] = getFieldTypeString(field);

          if (field.widget === 'object_list' && field.schema?.properties) {
            // Virtual type key is object-transparent (no prefix).
            const itemTypeKey = `${typeKey}:${fieldName}`;
            if (!config.blocks.blocksConfig[itemTypeKey]) {
              config.blocks.blocksConfig[itemTypeKey] = {
                blockSchema: field.schema,
                disableCustomSidebarEditForm: true, // Virtual types use schema form in sidebar
              };
            }
            // Item fields are addressed relative to the item — reset the prefix.
            registerFieldTypes(itemTypeKey, field.schema.properties);
          }
        });
      };
      registerFieldTypes(blockType, schema.properties);

      // Debug: Log what was added for hero
      if (blockType === 'hero') {
        logExtract('Hero blockFieldTypes after processing:', blockFieldTypes['hero']);
      }
    } catch (error) {
      console.warn(`[VIEW] Error extracting field types for block type "${blockType}":`, error);
      // Continue with other block types
    }
  });

  // Debug: Final state check
  logExtract('Final blockFieldTypes keys:', Object.keys(blockFieldTypes));
  logExtract('Final blockFieldTypes.hero:', blockFieldTypes['hero']);

  return blockFieldTypes;
};

/**
 * Returns url with query params + proper paths
 * @param {String} url
 * @param {Object} qParams
 * @param {String} pathname
 * @returns {String}
 */


/**
 * Format the URL for the Iframe with location, token and edit mode
 * @param {URL} url
 * @param {String} token
 * @returns {URL} URL with the admin params
 */
const getUrlWithAdminParams = (url, token, isEdit) => {
  // Edit mode communicated via iframe name AND _edit param for reliability
  // _edit param ensures mode change triggers URL change and iframe reload
  if (typeof window === 'undefined') return null;
  const contentPath = window.location.pathname.replace(/\/edit$/, '');
  const params = { access_token: token, _edit: isEdit ? 'true' : 'false' };
  // Forward debug param to iframe so hydra.js enables logging
  const adminUrl = new URL(window.location.href);
  if (adminUrl.searchParams.has('_hydra_debug')) {
    params._hydra_debug = '1';
  }
  return addUrlParams(`${url}`, params, contentPath);
};
function _isObject(item) {
  return (
    ![undefined, null].includes(item) &&
    typeof item === 'object' &&
    !Array.isArray(item)
  );
}

/**
 * Merge two `fieldsets` arrays — special-cased because plain replacement
 * (deepMerge's default for arrays) silently drops every fieldset the base
 * declared, which is almost never what an override author intends.
 *
 * Strategy:
 *   - Match fieldsets by `id`. For matches, merge the two: union `fields`
 *     (base order preserved, overrides appended; duplicates dropped),
 *     other props (`title`, etc.) override-wins.
 *   - Fieldsets in `over` with no match in `base` are appended.
 *   - Fieldsets in `base` with no match in `over` are preserved.
 *
 * For the common author intent — "I want to add `variation` to listing's
 * default fieldset" — this gives the right shape (Volto's fields stay,
 * variation gets added) instead of nuking everything that was there.
 *
 * Note: this can't express *removing* a base field. If that's needed,
 * the override author should produce the desired array directly via a
 * function-form blockSchema, not a static override.
 */
function _mergeFieldsets(base, over) {
  if (!Array.isArray(base)) return over;
  if (!Array.isArray(over)) return base;
  const byId = new Map();
  const result = [];
  for (const fs of base) {
    const copy = { ...fs, fields: [...(fs.fields || [])] };
    byId.set(fs.id, copy);
    result.push(copy);
  }
  for (const fs of over) {
    const target = byId.get(fs.id);
    if (target) {
      const merged = [...target.fields];
      for (const f of fs.fields || []) {
        if (!merged.includes(f)) merged.push(f);
      }
      Object.assign(target, fs, { fields: merged });
    } else {
      result.push({ ...fs, fields: [...(fs.fields || [])] });
    }
  }
  return result;
}

function deepMerge(entry, newConfig, _key) {
  // Special-case `fieldsets` arrays — see _mergeFieldsets above.
  if (_key === 'fieldsets' && Array.isArray(entry) && Array.isArray(newConfig)) {
    return _mergeFieldsets(entry, newConfig);
  }
  let output = Object.assign({}, entry);
  if (_isObject(entry) && _isObject(newConfig)) {
    Object.keys(newConfig).forEach((key) => {
      if (_isObject(newConfig[key])) {
        if (!(key in entry)) {
          Object.assign(output, {
            [key]: newConfig[key],
          });
        } else if (typeof entry[key] === 'function') {
          // Special case: if existing value is a function (like blockSchema),
          // wrap it to merge the function's result with the new object
          const originalFn = entry[key];
          const overrides = newConfig[key];
          output[key] = (props) => {
            const result = originalFn(props);
            return deepMerge(result, overrides);
          };
        } else {
          output[key] = deepMerge(entry[key], newConfig[key], key);
        }
      } else if (key === 'fieldsets' && Array.isArray(newConfig[key]) && Array.isArray(entry[key])) {
        // fieldsets is an array (so _isObject returned false) — handle here too.
        output[key] = _mergeFieldsets(entry[key], newConfig[key]);
      } else {
        Object.assign(output, { [key]: newConfig[key] });
      }
    });
  }
  return output;
}
/**
 * Parse an SVG string into Volto's Icon component format.
 * Volto's Icon expects: { attributes: { xmlns, viewBox }, content }
 *
 * @param {string} svgString - SVG string like '<svg xmlns="..." viewBox="..."><path d="..."/></svg>'
 * @returns {Object|null} - Icon object or null if parsing fails
 */
function parseSvgToIconFormat(svgString) {
  if (typeof svgString !== 'string' || !svgString.trim().startsWith('<svg')) {
    return null;
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svg = doc.querySelector('svg');

    if (!svg) {
      return null;
    }

    // Extract attributes
    const xmlns = svg.getAttribute('xmlns') || 'http://www.w3.org/2000/svg';
    const viewBox = svg.getAttribute('viewBox') || '0 0 24 24';

    // Extract inner content (everything inside the svg tag)
    const content = svg.innerHTML;

    return {
      attributes: { xmlns, viewBox },
      content,
    };
  } catch (e) {
    console.warn('[HYDRA] Failed to parse SVG icon:', e);
    return null;
  }
}

/**
 * Process blocksConfig to convert string SVG icons to Volto's format.
 * Modifies the config in place. Uses blockSVG as fallback for missing icons.
 */
function processBlockIcons(blocksConfig) {
  if (!blocksConfig || typeof blocksConfig !== 'object') {
    return;
  }

  Object.keys(blocksConfig).forEach((blockType) => {
    const blockConfig = blocksConfig[blockType];
    if (!blockConfig) return;

    if (typeof blockConfig.icon === 'string') {
      const parsedIcon = parseSvgToIconFormat(blockConfig.icon);
      if (parsedIcon) {
        blockConfig.icon = parsedIcon;
      } else {
        // Invalid string icon - use fallback
        blockConfig.icon = blockSVG;
      }
    } else if (!blockConfig.icon) {
      // No icon provided - use fallback
      blockConfig.icon = blockSVG;
    }
  });
}

function recurseUpdateVoltoConfig(newConfig) {
  // Process icon strings in blocksConfig before merging
  if (newConfig?.blocks?.blocksConfig) {
    processBlockIcons(newConfig.blocks.blocksConfig);
  }

  // Config object is not directly editable, update all the keys only.
  Object.entries(newConfig).forEach(([configKey, configValue]) => {
    config[configKey] = deepMerge(config[configKey], configValue);
  });
}

// Module-level state to track iframe's current state across component remounts
// This prevents unnecessary iframe reloads when React Router remounts the View component
let persistedIframe = { frontendUrl: null, path: null, isEdit: null, src: null };

const Iframe = (props) => {
  if (typeof window !== 'undefined' && window._formatT0) {
    console.log('[VIEW-TIMING] Iframe render +' + (performance.now() - window._formatT0).toFixed(0) + 'ms');
  }
  const {
    onSelectBlock,
    properties,
    onChangeFormData,
    metadata,
    formData: form, // Keep for compatibility, but we'll use Redux selector for sync
    token,
    allowedBlocks,
    showRestricted,
    blocksConfig = config.blocks.blocksConfig,
    navRoot,
    type: contentType,
    selectedBlock,
    openObjectBrowser,
    closeObjectBrowser,
    schema, // Content type schema for page-level field types
    saveTemplatesRef, // Ref that Form.jsx uses to trigger template save
    multiSelected = [], // Array of block UIDs in multi-selection
    blocksErrors = {}, // blockId → { field: [messages] } from a refused save
    onSetMultiSelected, // Callback to set multi-selection in Redux
  } = props;

  const dispatch = useDispatch();
  const blocksClipboard = useSelector((state) => state?.blocksClipboard || {});

  // Viewport preset for responsive preview
  const viewportPreset = useSelector(
    (state) => state.viewportPreset?.preset || 'desktop',
  );
  const viewportWidths = useSelector(
    (state) => state.viewportPreset?.widths || { mobile: 375, tablet: 768 },
  );
  const iframeMaxWidth = viewportPreset === 'desktop'
    ? undefined
    : `${viewportWidths[viewportPreset]}px`;

  // DEBUG: Track what causes re-renders
  const renderCountRef = useRef(0);
  const prevPropsRef = useRef({});
  renderCountRef.current++;
  const changedProps = Object.keys(props).filter(
    (key) => props[key] !== prevPropsRef.current[key]
  );
  if (renderCountRef.current > 1 && changedProps.length > 0) {
    log('[RENDER]', renderCountRef.current, 'changed props:', changedProps.join(', '));
  } else if (renderCountRef.current > 1) {
    log('[RENDER]', renderCountRef.current, 'no prop changes (state/context)');
  }
  prevPropsRef.current = props;

  const [addNewBlockOpened, setAddNewBlockOpened] = useState(false);
  // pendingAdd: { mode: 'sidebar', parentBlockId, fieldName } | { mode: 'iframe', afterBlockId }
  const [pendingAdd, setPendingAdd] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [popperElement, setPopperElement] = useState(null);
  const [referenceElement, setReferenceElement] = useState(null);
  const [blockUI, setBlockUI] = useState(null); // { blockUid, rect, focusedFieldName }
  const [mouseActivityCounter, setMouseActivityCounter] = useState(0); // incremented on MOUSE_ACTIVITY from iframe
  const [selectionMode, setSelectionMode] = useState(false); // true when in touch selection mode
  // Unified chooser overlay used by both Wrap and Convert. Shape:
  //   { kind: 'wrap', blockIds: string[], allowedBlocks: string[] }
  //   { kind: 'convert', blockId: string, allowedBlocks: string[] }
  const [chooser, setChooser] = useState(null);
  // "This drop/paste will convert some blocks — OK?" gate. A drop/paste is TRIALLED
  // (applied to a candidate formData + normalised) BEFORE committing; if any block's
  // @type changed, we surface it here and wait for a confirm.
  //   { conversions: [{ blockId, from, to }], onConfirm: () => void }
  const [convertConfirm, setConvertConfirm] = useState(null);
  const multiSelectedRef = useRef(multiSelected);
  multiSelectedRef.current = multiSelected;

  // History for routing - needed early for edit mode detection
  const history = useHistory();
  const pathname = history.location.pathname;

  // Edit mode detection and iframe name - used for hydra.js bridge detection
  // Uses history.location.pathname which works on both SSR and client
  const isEditMode = pathname.endsWith('/edit');
  // Origin: use publicURL from config on SSR, window.location.origin on client
  const adminOrigin = typeof window !== 'undefined'
    ? window.location.origin
    : (config.settings.publicURL || '').replace(/\/$/, '');
  const iframeName = `hydra-${isEditMode ? 'edit' : 'view'}:${adminOrigin}`;

  const [pendingFieldMedia, setPendingFieldMedia] = useState(null); // { fieldName, blockUid } for field-level image selection
  // Multi-select state is merged into blockUI (multiSelectedUids, multiSelectRects fields)
  const blockChooserRef = useRef();
  const [slashMenu, setSlashMenu] = useState(null); // { blockId, filter } or null
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);

  // NOTE: selectionToSendRef, formatRequestIdToSendRef, and applyFormatRef have been removed.
  // Selection and toolbarRequestDone are now part of iframeSyncState.
  // Transforms are handled via SLATE_TRANSFORM_REQUEST and the toolbar's transformAction.

  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    strategy: 'fixed',
    placement: 'bottom',
    modifiers: [
      {
        name: 'offset',
        options: {
          offset: [550, -300],
        },
      },
      {
        name: 'flip',
        options: {
          fallbackPlacements: ['right-end', 'top-start'],
        },
      },
    ],
  });

  // Frontend URL: from Redux store, cookie, or env default
  const urlFromEnv = getURlsFromEnv();
  const u =
    useSelector((state) => state.frontendPreviewUrl.url) ||
    Cookies.get(getIframeUrlCookieName()) ||
    urlFromEnv[0]?.url;

  // Track last SELECT_BLOCK sent to avoid redundant sends during pending selection
  const lastSentSelectBlockRef = useRef(null);

  // When frontend URL changes (iframe remounts), reset the last-sent ref so the
  // selectedBlock effect below re-sends SELECT_BLOCK to the new iframe.
  // Also clear stale blockUI positioning from the old frontend.
  useEffect(() => {
    lastSentSelectBlockRef.current = null;
    setBlockUI(null);
  }, [u]);

  // Listen for sidebar "Page" click to deselect current block
  useEffect(() => {
    const handler = () => {
      onSelectBlock(null);
      // Tell the iframe to deselect too — otherwise it keeps sending
      // BLOCK_SELECTED for the previously selected block (e.g. from
      // afterContentRender) which immediately re-selects the block.
      if (iframeOriginRef.current) {
        document.getElementById('previewIframe')?.contentWindow?.postMessage(
          { type: 'SELECT_BLOCK', uid: null },
          iframeOriginRef.current,
        );
        lastSentSelectBlockRef.current = null;
      }
    };
    document.addEventListener('hydra-select-page', handler);
    return () => document.removeEventListener('hydra-select-page', handler);
  }, [onSelectBlock]);

  useEffect(() => {
    // Only send SELECT_BLOCK if iframe is ready (has sent INIT)
    // Skip if there's a pending selection - it will be sent via FORM_DATA instead
    // This prevents race condition where old selection overwrites pending new selection
    // Also skip if we just sent this same block (prevents duplicate sends)
    if (iframeOriginRef.current && selectedBlock && !iframeSyncState?.pendingSelectBlockUid) {
      if (lastSentSelectBlockRef.current !== selectedBlock) {
        log('useEffect sending SELECT_BLOCK:', selectedBlock);
        lastSentSelectBlockRef.current = selectedBlock;
        document.getElementById('previewIframe')?.contentWindow?.postMessage(
          {
            type: 'SELECT_BLOCK',
            uid: selectedBlock,
            method: 'select',
          },
          iframeOriginRef.current,
        );
      }
    }
  }, [selectedBlock]);

  // Clear blockUI when no block is selected
  // BUT keep it for page-level fields (blockUI exists with rect and blockUid is PAGE_BLOCK_UID)
  useEffect(() => {
    if (!selectedBlock) {
      setBlockUI((prev) => {
        // Keep blockUI if it's a page-level selection (blockUid is PAGE_BLOCK_UID with rect)
        if (prev?.blockUid === PAGE_BLOCK_UID && prev?.rect) {
          return prev;
        }
        return null;
      });
    }
  }, [selectedBlock]);

  const iframeOriginRef = useRef(null); // Store actual iframe origin from received messages
  // Note: iframePath is stored in module-level persistedIframePath to survive component remounts
  const inlineEditCounterRef = useRef(0); // Count INLINE_EDIT_DATA messages from iframe
  const processedInlineEditCounterRef = useRef(0); // Count how many we've seen come back through Redux
  const editSequenceRef = useRef(-1); // Sequence counter for detecting stale iframe echoes (starts at -1 so first increment gives 0)
  // "Latest ref" for the unlocked-template set. saveTemplatesRef.current is a
  // useEffect closure; it captured templateEditMode one render behind, so a Ctrl+S
  // fired the instant the toggle flipped to locked (render) hit a stale, still-
  // unlocked set and wrongly raised the "Lock your templates first" gate. Updated
  // DURING render below (single source of truth — always equals the last rendered
  // state), so any callback reading it agrees with what the toggle shows.
  const templateEditModeRef = useRef([]);
  // Combined state for iframe data - formData, selection, requestId, and transformAction updated atomically
  // This ensures toolbar sees all together in the same render
  const intl = useIntl();

  // Comparing languages while editing.
  //
  // Inka has no specialist create view — a translation is created and then
  // edited, like everything else — so this is where a translator works: the
  // page in another language on one side, the one being written on the other.
  // Volto calls the same thing "compare languages"; it lives on the edit
  // screen there too.
  const translations = useMemo(
    () => properties?.['@components']?.translations?.items || [],
    [properties],
  );
  const [compareLanguage, setCompareLanguage] = useState(null);
  const [compareContent, setCompareContent] = useState(null);
  // Which pane the sidebar belongs to. Volto does the same with two forms and
  // one sidebar: selecting a form makes the sidebar its own. Selecting the
  // compared language shows ITS fields, read-only — there is one page being
  // edited here, and it is not that one.
  const [selectedPane, setSelectedPane] = useState('edit');

  useEffect(() => {
    const translation = translations.find((t) => t.language === compareLanguage);
    if (!translation) {
      setCompareContent(null);
      return;
    }
    let cancelled = false;
    new Api()
      .get(flattenToAppURL(translation['@id']))
      .then((content) => {
        if (!cancelled) setCompareContent(content);
      })
      .catch(() => {
        // The other language is a convenience, not the page being edited: if it
        // cannot be read, the pane simply does not open.
        if (!cancelled) setCompareContent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [compareLanguage, translations]);

  // What the pane is given: the compared page with every block read-only, so
  // it can be read and inspected but not changed. Read-only is a property of a
  // block, so "a page nobody may edit" needs no new kind of frame.
  const compareReadOnlyContent = useMemo(
    () =>
      compareContent
        ? {
            ...compareContent,
            blocks: withAllBlocksReadOnly(
              compareContent.blocks,
              buildIdFieldMap(config.blocks.blocksConfig, intl),
            ),
          }
        : null,
    [compareContent, intl],
  );
  const [compareSelectedBlock, setCompareSelectedBlock] = useState(null);

  const comparePreviewUrl = useMemo(() => {
    const translation = translations.find((t) => t.language === compareLanguage);
    return translation
      ? addUrlParams(
          u,
          // An editing frame, so its blocks can be selected and inspected.
          // What makes it read-only is the CONTENT it is given.
          { access_token: token || '', _edit: 'true' },
          flattenToAppURL(translation['@id']),
        )
      : null;
  }, [translations, compareLanguage, u, token]);

  // Which blocks still read as the language they were copied from. Answerable
  // only against that other language, so it follows the comparison.
  const untranslatedIds = useMemo(
    () =>
      compareContent
        ? untranslatedBlockIds(
            properties?.blocks,
            compareContent?.blocks,
            buildIdFieldMap(config.blocks.blocksConfig, intl),
          )
        : [],
    [compareContent, properties?.blocks, intl],
  );


  // Initialize with properties so we have data from first render
  //
  // UNIFIED STATE MODEL (see DATA FLOW ARCHITECTURE in SyncedSlateToolbar.jsx):
  // - formData: current form data to sync with iframe
  // - selection: current Slate selection
  // - completedFlushRequestId: iframe completed a FLUSH_BUFFER request (toolbar button flow)
  // - transformAction: hotkey transform pending (format, paste, delete) - includes its own requestId
  // - toolbarRequestDone: toolbar completed a format operation, needs to send FORM_DATA to unblock iframe
  //   This is separate from completedFlushRequestId - that's for iframe→toolbar flow (flush),
  //   this is for toolbar→iframe flow (format completion, including selection-only changes)
  const [iframeSyncState, setIframeSyncState] = useState(() => ({
    formData: properties,
    blockPathMap: {}, // Built on INIT — no point computing here since INIT replaces it immediately
    selection: null,
    completedFlushRequestId: null, // For toolbar button click flow (FLUSH_BUFFER)
    transformAction: null, // For hotkey transform flow (format, paste, delete) - includes its own requestId
    toolbarRequestDone: null, // requestId - toolbar completed format, need to respond to iframe
    pendingSelectBlockUid: null, // Block to select after next FORM_DATA (for new block add)
    pendingFormatRequestId: null, // requestId to include in next FORM_DATA (for Enter key, etc.)
    templateEditMode: [], // v2: array of unlocked template instance ids (multiple at once)
  }));

  // Keep the latest-ref current as of this render (see templateEditModeRef).
  templateEditModeRef.current = iframeSyncState.templateEditMode || [];

  // v2 template edit: the decision modal shown on unlock/lock/save-gate, and a
  // per-instance snapshot of formData taken at unlock time (so "Reset changes"
  // can revert only that template's blocks, keeping page edits).
  const [templateModal, setTemplateModal] = useState(null); // { kind, instanceId } | null
  // True while a template lock-commit is persisting (flush → reverse-merge → PATCH →
  // unlock). That round-trip can be slow and, unlike a page save, has no Volto request
  // spinner — so show a Dimmer+Loader over the editor and block interaction until it
  // settles (nothing can race the in-flight commit).
  const [committingTemplate, setCommittingTemplate] = useState(false);
  const templateSnapshotsRef = useRef({});

  // Notify toolbar whether paste is allowed for the current selection + clipboard.
  useEffect(() => {
    const bpm = iframeSyncState?.blockPathMap;
    if (!bpm || !selectedBlock) return;
    const clipData = blocksClipboard?.cut || blocksClipboard?.copy || [];
    if (clipData.length === 0) return;

    const blocksConfig = config.blocks.blocksConfig;
    const containerConfig = getContainerFieldConfig(selectedBlock, bpm, properties, blocksConfig, intl);
    const allowedTypes = containerConfig?.allowedBlocks;

    let allowed = true;
    if (allowedTypes?.length > 0) {
      allowed = clipData.every(([, blockData]) =>
        allowedTypes.includes(blockData?.['@type']),
      );
    }

    document.dispatchEvent(new CustomEvent('hydra-paste-state', {
      detail: { allowed },
    }));
  }, [selectedBlock, blocksClipboard, iframeSyncState?.blockPathMap, properties, intl]);

  // Handle copy/cut/delete/paste from BlocksToolbar via document events.
  useEffect(() => {
    const bpm = iframeSyncState?.blockPathMap;
    if (!bpm) return;
    const blocksConfig = config.blocks.blocksConfig;

    const handleCopy = (e) => {
      const { blockIds, action } = e.detail;
      const blocksData = blockIds
        .map((uid) => {
          const block = getBlockById(properties, bpm, uid);
          return block ? [uid, block] : null;
        })
        .filter(Boolean);
      log('hydra-copy-blocks:', action, blocksData.length, 'blocks');
      dispatch(setBlocksClipboard({ [action]: blocksData }));
      // Clear all outlines — stale combined rect would render wrong as single-block outline
      setBlockUI(null);
      handleExitSelectionMode();
    };

    const handleDelete = (e) => {
      const { blockIds } = e.detail;
      // deleteBlocks carries BOTH halves this handler and onDeleteBlock had
      // drifted apart on: the lock backstop (in case a caller slipped locked
      // uids past hydra._filterMutableBlockUids) and the re-seed that stops a
      // forced region being emptied into nothing.
      const { formData: newFormData, deleted } = deleteBlocks(
        properties,
        bpm,
        blockIds,
        {
          blocksConfig,
          intl,
          uuidGenerator: uuid,
          templateEditMode: iframeSyncState.templateEditMode,
          metadata,
        },
      );
      log('hydra-delete-blocks:', deleted.length, '/', blockIds.length, 'blocks (after lock filter)');
      if (deleted.length === 0) return;
      onChangeFormData(newFormData);
      onSelectBlock(null);
      setBlockUI(null);
      if (onSetMultiSelected) onSetMultiSelected([]);
    };

    const handlePaste = (e) => {
      const { afterBlockId, keepClipboard } = e.detail;
      const mode = Object.keys(blocksClipboard).includes('cut') ? 'cut' : 'copy';
      const blocksData = blocksClipboard[mode] || [];

      const cloneWithIds = blocksData
        .filter(([blockId, blockData]) => blockId && blockData?.['@type'])
        .map(([blockId, blockData]) => {
          const blockConfig = blocksConfig[blockData['@type']];
          return mode === 'copy'
            ? blockConfig?.cloneData
              ? blockConfig.cloneData(blockData)
              : [uuid(), cloneBlocks(blockData)]
            : [blockId, blockData];
        })
        .filter(Boolean);

      if (cloneWithIds.length === 0) return;

      // The same backstop delete and move carry, and paste had none: pasting
      // after locked template chrome is exactly the injection the lock exists to
      // stop. The decision is canInsertBesideBlock, in the edit layer with the
      // rest of them, so it can be tested without driving this handler.
      if (
        !canInsertBesideBlock(
          afterBlockId,
          bpm,
          getBlockById(properties, bpm, afterBlockId),
          iframeSyncState.templateEditMode,
        )
      ) {
        log('hydra-paste: target refuses inserts (locked template content?)', afterBlockId);
        return;
      }

      const containerConfig = getContainerFieldConfig(afterBlockId, bpm, properties, blocksConfig, intl);
      const allowedTypes = containerConfig?.allowedBlocks;
      // Resolve each pasted block against the container's allowedBlocks: native,
      // or convertible (auto when one target type; a single pasted block with
      // several options opens the chooser — ask-first). Multi-paste is auto-only.
      let pasteBlocks = cloneWithIds;
      const membershipConversions = []; // {blockId, from, to} — surfaced in the confirm
      if (allowedTypes?.length > 0) {
        const singlePaste = cloneWithIds.length === 1;
        const resolved = [];
        for (const [newId, blockData] of cloneWithIds) {
          const bType = blockData?.['@type'];
          if (allowedTypes.includes(bType)) {
            resolved.push([newId, blockData]); // native fit
            continue;
          }
          const options = getConvertibleTypes(bType, blocksConfig, allowedTypes).map((t) => t.type);
          if (options.length === 1) {
            resolved.push([newId, convertBlockType(blockData, options[0], blocksConfig, '@type', intl)]);
            membershipConversions.push({ blockId: newId, from: bType, to: options[0] });
            continue;
          }
          if (options.length > 1 && singlePaste) {
            // Ask-first: pick a target type, then insert the converted block.
            setChooser({
              kind: 'convert',
              allowedBlocks: options,
              pendingPaste: { newId, blockData, afterBlockId },
            });
            return; // insertion happens on chooser pick (commitChooser)
          }
          log('hydra-paste-blocks: blocked — type not allowed/convertible in container');
          return;
        }
        pasteBlocks = resolved;
      }

      log('hydra-paste-blocks:', pasteBlocks.length, 'blocks after', afterBlockId);
      let newFormData = { ...properties };
      let currentBpm = bpm;
      let lastId = afterBlockId;
      for (const [newId, blockData] of pasteBlocks) {
        newFormData = insertBlockInContainer(newFormData, currentBpm, lastId, newId, blockData, containerConfig, 'after');
        currentBpm = buildBlockPathMap(newFormData, blocksConfig, intl);
        lastId = newId;
      }

      const commitPaste = (fd) => {
        if (!keepClipboard) dispatch(resetBlocksClipboard());
        onChangeFormData(fd);
      };
      // Trial the paste (same as a drop): normalise the candidate, diff @types, and
      // confirm if anything converted — membership fits + any rule-driven change.
      const trialBpm = buildBlockPathMap(newFormData, blocksConfig, intl);
      const { formData: normalizedFd, conversions: ruleConversions } =
        previewSchemaDefaultConversions(newFormData, trialBpm, blocksConfig, intl);
      const allConversions = [...membershipConversions, ...ruleConversions];
      if (allConversions.length > 0) {
        setConvertConfirm({
          conversions: allConversions,
          onConfirm: () => commitPaste(normalizedFd),
        });
      } else {
        commitPaste(newFormData);
      }
    };

    const handleExitSelectionMode = () => {
      log('hydra-exit-selection-mode');
      if (onSetMultiSelected) onSetMultiSelected([]);
      // Tell iframe — it clears state and acks with EXIT_SELECTION_MODE
      // which sets selectionMode(false) so checkboxes disappear after iframe confirms
      const iframe = document.getElementById('previewIframe');
      if (iframe?.contentWindow && iframeOriginRef.current) {
        iframe.contentWindow.postMessage({ type: 'EXIT_SELECTION_MODE' }, iframeOriginRef.current);
      }
    };

    const handleEnterSelectionMode = () => {
      log('hydra-enter-selection-mode');
      // Tell iframe to enter selection mode. Iframe responds with ENTER_SELECTION_MODE
      // message containing allBlockRects, which sets selectionMode=true in View.jsx
      const iframe = document.getElementById('previewIframe');
      if (iframe?.contentWindow && iframeOriginRef.current) {
        iframe.contentWindow.postMessage({ type: 'ENTER_SELECTION_MODE' }, iframeOriginRef.current);
      }
    };

    // Mobile #145 — chevron buttons in the Quanta toolbar dispatch this
    // CustomEvent to reorder the selected block within its parent. The
    // existing MOVE_BLOCKS postMessage path is iframe-origin-gated, so
    // admin-React → admin-React reuse goes through the CustomEvent bus
    // (same pattern as hydra-paste-blocks, hydra-copy-blocks, etc.).
    const handleMoveBlock = (e) => {
      const { blockId, targetBlockId, insertAfter, targetParentId } = e.detail || {};
      if (!blockId || !targetBlockId) return;
      // Drop a synthetic MOVE_BLOCKS message in — the same handler in the
      // window 'message' listener does the path-map rebuild, allowed-types
      // check, and onChangeFormData call. Origin filter is bypassed by
      // dispatching directly through MessageEvent on window.
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'MOVE_BLOCKS', blockIds: [blockId], targetBlockId, insertAfter, targetParentId },
          origin: iframeOriginRef.current || (iframeSrc ? new URL(iframeSrc).origin : ''),
        }),
      );
    };

    document.addEventListener('hydra-copy-blocks', handleCopy);
    document.addEventListener('hydra-delete-blocks', handleDelete);
    document.addEventListener('hydra-paste-blocks', handlePaste);
    document.addEventListener('hydra-exit-selection-mode', handleExitSelectionMode);
    document.addEventListener('hydra-enter-selection-mode', handleEnterSelectionMode);
    document.addEventListener('hydra-move-block', handleMoveBlock);
    return () => {
      document.removeEventListener('hydra-copy-blocks', handleCopy);
      document.removeEventListener('hydra-delete-blocks', handleDelete);
      document.removeEventListener('hydra-paste-blocks', handlePaste);
      document.removeEventListener('hydra-exit-selection-mode', handleExitSelectionMode);
      document.removeEventListener('hydra-enter-selection-mode', handleEnterSelectionMode);
      document.removeEventListener('hydra-move-block', handleMoveBlock);
    };
    // NOTE: templateEditMode must be a dep — these handlers (handleDelete) gate
    // on it via isBlockReadonly; without it the listener closure keeps a
    // stale edit mode and refuses to mutate template blocks while editing.
  }, [blocksClipboard, properties, iframeSyncState?.blockPathMap, iframeSyncState?.templateEditMode, onChangeFormData, dispatch, intl]);

  // Template cache: stores loaded template documents keyed by templateId
  // Used for comparison on save to detect template changes
  const templateCacheRef = useRef({});

  // Pending template edit exit - stores { requestId, prevInstanceId, mode } when
  // waiting for flush before a lock-commit reverse-merge.
  const pendingTemplateEditExitRef = useRef(null);

  // True when the instance's blocks are identical to the snapshot taken at unlock
  // (i.e. the template wasn't edited). Compares the instance's blocks + their
  // top-level order; nested container/object_list changes live inside the block
  // objects, so the deep compare of the blocks dict catches them too. Both sides
  // are the Redux `properties` representation, so the compare is apples-to-apples;
  // structural edits and (debounced) inline text edits are already reflected there.
  const isInstanceUnchanged = useCallback((instanceId, formData) => {
    const snap = templateSnapshotsRef.current[instanceId];
    if (!snap) return true;
    const pick = (fd) => {
      const blocks = {};
      for (const [id, b] of Object.entries(fd?.blocks || {})) {
        if (b?.templateInstanceId === instanceId) blocks[id] = b;
      }
      const items = (fd?.blocks_layout?.items || []).filter(
        (id) => fd?.blocks?.[id]?.templateInstanceId === instanceId,
      );
      return { blocks, items };
    };
    return isEqual(pick(snap), pick(formData));
  }, []);

  // v2: broadcast the current set of unlocked template instance ids to the iframe
  // (multiple templates may be unlocked at once). Bridge gates editability/movement
  // on this set.
  const postTemplateEditMode = useCallback((instanceIds) => {
    if (referenceElement?.contentWindow) {
      referenceElement.contentWindow.postMessage(
        { type: 'TEMPLATE_EDIT_MODE', instanceIds },
        '*',
      );
    }
  }, [referenceElement]);

  // Lock a template WITHOUT saving (used when it wasn't changed): drop it from the
  // unlocked set, tell the iframe, and discard its snapshot. No reverse-merge, no
  // template write. (Declared AFTER postTemplateEditMode — it's a dependency.)
  const exitTemplateEditNoSave = useCallback((instanceId) => {
    const next = (iframeSyncState.templateEditMode || []).filter((id) => id !== instanceId);
    setIframeSyncState((prev) => ({
      ...prev,
      templateEditMode: (prev.templateEditMode || []).filter((id) => id !== instanceId),
    }));
    postTemplateEditMode(next);
    delete templateSnapshotsRef.current[instanceId];
  }, [iframeSyncState.templateEditMode, postTemplateEditMode]);

  // Persist ONE template document from the cache: POST a brand-new template
  // (_isNew) into its parent folder, else PATCH the existing one. Shared by the
  // page-save path (saveTemplatesRef) and the v2 lock-commit ("Change on all
  // pages"), which saves the template the moment you lock it.
  const persistTemplateDoc = useCallback(async (api, templateId) => {
    const template = templateCacheRef.current[templateId];
    if (!template) return;
    try {
      if (template._isNew) {
        // New template: POST to parent folder so Plone creates the Document and
        // populates server-side fields (UID, created, …). The id goes in the body
        // so Plone keeps our slug instead of deriving one from the title.
        const lastSlash = templateId.lastIndexOf('/');
        const parentFolder = lastSlash > 0 ? templateId.slice(0, lastSlash) : '/';
        const id = templateId.slice(lastSlash + 1);
        // Creating a template needs "Add portal content" on the chosen folder.
        let targetFolder = null;
        try {
          targetFolder = await api.get(parentFolder);
        } catch {
          // Couldn't read permissions — let the backend 403 be the authority.
        }
        if (targetFolder?.can_add === false) {
          const err = new Error(
            `You don't have permission to add templates in "${parentFolder}" (requires “Add portal content”).`,
          );
          err.isPermissionError = true;
          throw err;
        }
        await api.post(parentFolder, {
          data: {
            '@type': 'Document',
            id,
            title: template.title || id,
            blocks: template.blocks,
            blocks_layout: template.blocks_layout,
          },
        });
        // Mutate in place so the cached reference stays valid; next save PATCHes.
        delete template._isNew;
      } else {
        await api.patch(templateId, {
          data: {
            blocks: template.blocks,
            blocks_layout: template.blocks_layout,
          },
        });
      }
    } catch (error) {
      console.error(`[HYDRA] Failed to save template ${templateId}:`, error);
      // A permission failure must block, not silently drop the template.
      if (error?.isPermissionError) throw error;
    }
  }, []);

  // Resolve each object_list field's idField ONCE from the schema (a form's subblocks are keyed
  // by field_id, not @id) and pass it to every merge — so the merge stamps item ids into the
  // right field instead of minting a bogus @id. A frontend passes this same shape as a hint.
  const idFieldMap = useMemo(
    () => buildIdFieldMap(config.blocks.blocksConfig, intl),
    [intl],
  );



  // Trigger for template sync effect - INIT increments this when templates need loading
  // This causes the effect to run and fetch templates, then send deferred INITIAL_DATA
  const [templateSyncTrigger, setTemplateSyncTrigger] = useState(0);

  // Set up saveTemplatesRef function for Form.jsx to call before page save
  // Templates are merged into cache when exiting template edit mode
  // This function just persists whatever is in cache to the backend
  useEffect(() => {
    if (!saveTemplatesRef) return;

    saveTemplatesRef.current = async (formData, currentPath) => {
      // v2: the page save is GATED while an EXISTING template is unlocked —
      // committing it affects every page that uses it, so that must be a deliberate
      // lock action, not a page save. A brand-new (_isNew) template has no other
      // pages yet, so it still persists on page save (preserving the make-template
      // flow). Raise the "lock your templates first" modal and abort otherwise.
      const findTemplateId = (instanceId) => {
        for (const block of Object.values(formData?.blocks || {})) {
          if (block.templateInstanceId === instanceId && block.templateId) {
            return block.templateId;
          }
        }
        return null;
      };
      // Read the latest-ref, not this effect closure's captured templateEditMode:
      // the ref is refreshed during the same render that flips the toggle to locked,
      // so a Ctrl+S fired the instant that lands sees the up-to-date set (no stale gate).
      const blockingUnlocked = (templateEditModeRef.current || []).filter(
        (iid) => {
          const tid = findTemplateId(iid);
          const tpl = tid && templateCacheRef.current[tid];
          return tpl && !tpl._isNew;
        },
      );
      if (blockingUnlocked.length > 0) {
        setTemplateModal({ kind: 'saveGate' });
        return { blocked: true };
      }

      // Flush any pending inline edit text from the iframe before saving.
      // Text typed in the iframe is debounced, so it may not have been sent
      // via INLINE_EDIT_DATA yet. The flush ensures formData is up to date.
      if (referenceElement?.contentWindow) {
        await new Promise((resolve) => {
          const requestId = `save-flush-${Date.now()}`;
          const handleMessage = (event) => {
            if (
              (event.data.type === 'BUFFER_FLUSHED' && event.data.requestId === requestId) ||
              (event.data.type === 'INLINE_EDIT_DATA' && event.data.flushRequestId === requestId)
            ) {
              window.removeEventListener('message', handleMessage);
              // Let React process the INLINE_EDIT_DATA state update
              setTimeout(resolve, 0);
            }
          };
          window.addEventListener('message', handleMessage);
          referenceElement.contentWindow.postMessage(
            { type: 'FLUSH_BUFFER', requestId },
            '*'
          );
        });
      }

      const templateCache = templateCacheRef.current;

      // Finalize the id/filename for any not-yet-saved template BEFORE we compute the
      // ids to save: choose its id from the Short name (or a slug of the Template
      // Name), then rewrite EVERY reference to the placeholder id — the template's own
      // blocks + its cache key, AND the page's blocks. The page's blocks are frozen
      // (Redux), so this rewrites immutably and returns the new page data for the page
      // save (see Form.jsx); otherwise the page would reference a template id that was
      // never created (404 on reload).
      const slugifyId = (s) =>
        String(s || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
      const rewriteTemplateRefs = (node, oldId, newId) => {
        if (Array.isArray(node)) {
          let changed = false;
          const arr = node.map((n) => {
            const nn = rewriteTemplateRefs(n, oldId, newId);
            if (nn !== n) changed = true;
            return nn;
          });
          return changed ? arr : node;
        }
        if (!node || typeof node !== 'object') return node;
        let changed = false;
        const out = {};
        for (const [k, v] of Object.entries(node)) {
          const nv = rewriteTemplateRefs(v, oldId, newId);
          out[k] = nv;
          if (nv !== v) changed = true;
        }
        if (out.templateId === oldId) { out.templateId = newId; changed = true; }
        if (out.templateInstanceId === oldId) { out.templateInstanceId = newId; changed = true; }
        return changed ? out : node;
      };

      let pageFormData = formData;
      for (const oldId of Object.keys(templateCache)) {
        const tpl = templateCache[oldId];
        if (!tpl?._isNew) continue;
        const lastSlash = oldId.lastIndexOf('/');
        const parent = lastSlash > 0 ? oldId.slice(0, lastSlash) : '';
        const currentSlug = oldId.slice(lastSlash + 1);
        // Short name → else derive from the Template Name → else keep the placeholder.
        const desiredSlug = slugifyId(tpl.id) || slugifyId(tpl.title) || currentSlug;
        const newId = `${parent}/${desiredSlug}`;
        if (!desiredSlug || newId === oldId) continue;
        templateCache[newId] = {
          ...tpl,
          '@id': newId,
          id: desiredSlug,
          blocks: rewriteTemplateRefs(tpl.blocks, oldId, newId),
        };
        delete templateCache[oldId];
        pageFormData = rewriteTemplateRefs(pageFormData, oldId, newId);
      }

      const templateIds = getUniqueTemplateIds(pageFormData).filter(
        id => id !== currentPath && templateCache[id]
      );

      if (templateIds.length === 0) {
        // Only hand back page data when an id was actually rewritten; otherwise
        // return nothing so Form.jsx uses its own (post-flush) state — which holds
        // the just-flushed inline edits this pre-flush `formData` param lacks.
        return pageFormData !== formData ? pageFormData : undefined;
      }

      // Use Volto's Api helper which handles auth and URL formatting
      const api = new Api();

      await Promise.all(
        templateIds.map((templateId) => persistTemplateDoc(api, templateId)),
      );

      // Hand the page data back to Form.jsx ONLY when an id was rewritten, so the page
      // save writes the finalized references. Otherwise return nothing so Form uses its
      // own post-flush state (which holds just-flushed inline edits this pre-flush
      // `formData` param lacks).
      return pageFormData !== formData ? pageFormData : undefined;
    };
  }, [saveTemplatesRef, referenceElement, persistTemplateDoc, iframeSyncState.templateEditMode]);

  // v2 lock-commit ("Change on all pages"): after the iframe flushes pending
  // inline edits, reverse-merge the instance's blocks back into the template
  // cache AND save that template document now (at lock time). Then drop just this
  // instance from the unlocked set — other unlocked templates stay unlocked.
  useEffect(() => {
    const pending = pendingTemplateEditExitRef.current;
    if (!pending) return;
    if (iframeSyncState.completedFlushRequestId !== pending.requestId) return;
    pendingTemplateEditExitRef.current = null;

    const { prevInstanceId } = pending;
    const formData = iframeSyncState.formData;

    // Drop this instance from the unlocked set + tell the iframe.
    const finish = () => {
      const next = (iframeSyncState.templateEditMode || []).filter((id) => id !== prevInstanceId);
      setIframeSyncState((prev) => ({
        ...prev,
        templateEditMode: (prev.templateEditMode || []).filter((id) => id !== prevInstanceId),
      }));
      postTemplateEditMode(next);
      delete templateSnapshotsRef.current[prevInstanceId];
      setCommittingTemplate(false); // commit round-trip done — drop the saving overlay
    };

    // Find the templateId for this instance.
    let templateId = null;
    for (const block of Object.values(formData.blocks || {})) {
      if (block.templateInstanceId === prevInstanceId && block.templateId) {
        templateId = block.templateId;
        break;
      }
    }

    if (templateId && templateCacheRef.current[templateId]) {
      const template = templateCacheRef.current[templateId];
      // Capture edits to the instance's fixed+readOnly blocks into the template.
      mergeTemplatesIntoPage(template, {
        loadTemplate: async () => formData,
        filterInstanceId: prevInstanceId,
        uuidGenerator: uuid,
        idFieldMap,
      })
        .then(async ({ merged: updatedTemplate }) => {
          templateCacheRef.current[templateId] = updatedTemplate;
          // "Change on all pages": persist the template document immediately.
          await persistTemplateDoc(new Api(), templateId);
        })
        .catch((e) => {
          toast.error(
            <Toast
              error
              title="Couldn't save template"
              content={e?.message || 'The template could not be saved.'}
            />,
          );
        })
        .finally(finish);
    } else {
      finish();
    }
  }, [iframeSyncState.completedFlushRequestId, iframeSyncState.formData, postTemplateEditMode, persistTemplateDoc, idFieldMap]);

  // Pending INITIAL_DATA: when templates are loading during INIT, store data here
  // Sync effect will send INITIAL_DATA after templates are merged
  const pendingInitialDataRef = useRef(null);

  // Handle Escape key in Admin UI — three-state machine (same as iframe):
  //   Text mode (sidebar field focused) → Block mode (blur field, stay on block)
  //   Block mode → Parent block (or deselect if at page level)
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key !== 'Escape') return;
      if (!selectedBlock) return;

      // Don't interfere with Escape in modals, dropdowns, popups, etc.
      const isInPopup = e.target.closest('.volto-hydra-dropdown-menu, .blocks-chooser, [role="dialog"], .ui.modal, .add-link, .slate-inline-toolbar');
      if (isInPopup) return;

      // Also check if LinkEditor popup is visible (focus may not be inside it)
      const linkEditorVisible = document.querySelector('.add-link');
      if (linkEditorVisible) return;

      // Don't handle if focus is in iframe - let iframe's handler do it
      const iframeEl = document.getElementById('previewIframe');
      if (iframeEl && iframeEl.contains(document.activeElement)) return;

      e.preventDefault();

      // Check if a sidebar form field has focus (sidebar text mode)
      const sidebarField = document.activeElement?.closest?.('.field-wrapper input, .field-wrapper textarea, .field-wrapper [contenteditable="true"], .field-wrapper select');
      if (sidebarField) {
        // FIRST ESCAPE: Sidebar text mode → Block mode (blur field, stay on block)
        log('Admin Escape key - entering block mode (blurring sidebar field)');
        (document.activeElement as HTMLElement)?.blur?.();
        return;
      }

      // SECOND ESCAPE: Block mode → Parent (or deselect)
      const pathInfo = iframeSyncState.blockPathMap?.[selectedBlock];
      const parentId = pathInfo?.parentId || null;
      log('Admin Escape key - selecting parent:', parentId, 'from:', selectedBlock);

      // Select parent (or deselect if no parent)
      onSelectBlock(parentId);

      // Tell the iframe to select the parent (or deselect) — otherwise the iframe
      // still has the old block selected and keeps sending BLOCK_SELECTED messages
      const iframeWindow = iframeEl?.contentWindow;
      if (iframeWindow) {
        iframeWindow.postMessage(
          { type: 'SELECT_BLOCK', uid: parentId, method: 'select' },
          '*',
        );
      }
    };

    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [selectedBlock, iframeSyncState.blockPathMap, onSelectBlock]);

  // Follow the sidebar into the page.
  //
  // A field is edited SOMEWHERE, and that somewhere is not always on screen: a
  // block can be drawn in several places with a different field in each — the
  // design system's cookie consent puts its message in a banner and its
  // category wording in a preferences dialog, each built in JavaScript, each
  // hidden until its own trigger is pressed. Selecting the block reveals at most
  // one of them, because a block-level handle is one handle; the field is what
  // says which half the author means.
  //
  // So when the cursor lands in a sidebar field, tell the page which field it
  // is — the FOCUS_FIELD the bridge has always handled, with `moveCaret: false`
  // so it reveals without taking the caret out of the sidebar. The bridge shows
  // that field's place only when a `uid#field` handle advertises it, and does
  // nothing when it is already visible, so this is safe to send on every focus.
  useEffect(() => {
    const handleSidebarFocus = (e) => {
      if (!selectedBlock || !iframeOriginRef.current) return;
      const target = e.target;
      if (!target?.closest) return;
      // Volto wraps each field as `.field-wrapper-<name>`.
      const wrapper = target.closest('[class*="field-wrapper-"]');
      if (!wrapper) return;
      const fieldName = Array.from(wrapper.classList)
        .find((name) => name.startsWith('field-wrapper-'))
        ?.slice('field-wrapper-'.length);
      if (!fieldName) return;
      const iframe = document.getElementById('previewIframe');
      iframe?.contentWindow?.postMessage(
        // One message with an intent, not two message types: `moveCaret: false`
        // says "reveal it, and leave the caret where the author put it".
        {
          type: 'FOCUS_FIELD',
          blockId: selectedBlock,
          fieldName,
          moveCaret: false,
        },
        iframeOriginRef.current,
      );
    };

    document.addEventListener('focusin', handleSidebarFocus);
    return () => document.removeEventListener('focusin', handleSidebarFocus);
  }, [selectedBlock]);

  // Initialize from persisted state so component remounts don't reset to null
  // (which would cause a duplicate iframe load for the same URL).
  // On first-ever load, persistedIframe.src is null (safe for SSR hydration).
  const [iframeSrc, setIframeSrc] = useState(persistedIframe.src);

  // Note: window.name inside iframe is set via the `name` attribute on the <iframe> element.
  // When iframe reloads (e.g., on mode switch), it picks up the current `name` attribute value.
  // No useEffect needed - the HTML attribute handles it.

  // Extract block field types - stored in state so it can be updated when frontend config is merged
  // Must be declared before useEffects that reference it
  const [blockFieldTypes, setBlockFieldTypes] = useState(() => extractBlockFieldTypes(intl, schema));

  // Update block field types when schema changes (includes page-level field types)
  useEffect(() => {
    if (schema) {
      setBlockFieldTypes(extractBlockFieldTypes(intl, schema));
    }
  }, [schema, intl]);

  // Note: We use `properties` prop from Form.jsx as the single source of truth
  // This matches standard Volto's BlocksForm pattern (props, not Redux)

  // Validate properties on mount and change
  useEffect(() => {
    validateAndLog(properties, 'properties (from Form)', blockFieldTypes);
  }, [properties, blockFieldTypes]);

  // Say what the slate style allow-list would rewrite (#295). The normalization
  // itself happens in applySchemaDefaultsToFormData; reporting it here means the
  // migration is visible while editing instead of turning up as a diff on a save
  // the author didn't think changed anything.
  useEffect(() => {
    const disallowed = reportDisallowedSlateNodes(
      properties,
      iframeSyncState.blockPathMap,
      config.blocks.blocksConfig,
      intl,
    );
    if (!disallowed.length) return;
    console.warn(
      `[slateStyles] ${disallowed.length} slate node(s) outside this page's allowed styles; they normalize on load:`,
    );
    for (const d of disallowed) {
      console.warn(
        `  block=${d.blockId} field=${d.field} path=[${d.path.join(',')}] ${d.from} → ${d.to ?? '(unwrapped)'}` +
          (d.configError ? `  (alias "${d.configError}" is itself disallowed)` : ''),
      );
    }
  }, [properties, iframeSyncState.blockPathMap, intl]);

  useEffect(() => {
    // Only update iframeSrc if admin path, mode, or frontend URL differs from iframe's current state
    // This prevents reloading iframe when it already navigated via SPA
    // Using module-level persistedIframe to survive component remounts
    const adminPath = pathname.replace(/\/edit$/, '');
    const stateMatches =
      persistedIframe.frontendUrl === u &&
      persistedIframe.path === adminPath &&
      persistedIframe.isEdit === isEditMode;
    log('[IFRAME_SRC] persisted:', persistedIframe, 'current:', { frontendUrl: u, path: adminPath, isEdit: isEditMode }, 'match:', stateMatches, 'iframeSrc:', iframeSrc ? 'set' : 'null');
    // Update if state doesn't match OR if iframeSrc is null (component just mounted)
    if (!stateMatches || !iframeSrc) {
      log('[IFRAME_SRC] Updating iframeSrc (state differs:', !stateMatches, 'iframeSrc null:', !iframeSrc, ')');
      const newSrc = getUrlWithAdminParams(u, token, isEditMode);
      setIframeSrc(newSrc);
      persistedIframe = { frontendUrl: u, path: adminPath, isEdit: isEditMode, src: newSrc };
    } else {
      log('[IFRAME_SRC] Skipping - state matches and iframeSrc already set');
    }
    u && Cookies.set(getIframeUrlCookieName(), u, { expires: 7 });
  }, [token, u, pathname, isEditMode, iframeSrc]);

  // NOTE: Form sync and FORM_DATA sending are merged into one useEffect below (search for "UNIFIED FORM SYNC")

  // Warn before leaving edit mode (browser-level)

  useEffect(() => {
    if (!isEditMode) return;

    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = ''; // Required for Chrome
      return ''; // Required for some browsers
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isEditMode]);

  /**
   * Unified block insertion: creates a block, inserts it, updates Redux, and selects it.
   *
   * @param {string} blockId - Reference block ID
   * @param {string} blockType - Type of block to insert (e.g., 'slate', 'image')
   * @param {'before'|'after'|'inside'} action - Where to insert relative to blockId
   * @param {string} [fieldName] - For 'inside' action, which container field to insert into
   * @param {Object} [options] - Optional settings
   * @param {Object} [options.blockData] - Custom block data (skips default generation)
   * @param {Object} [options.formData] - Pre-mutated formData to insert into
   * @param {Object} [options.blockPathMap] - BlockPathMap for the formData
   * @param {string} [options.formatRequestId] - Request ID to include in FORM_DATA response
   * @param {number} [options.selectChildIndex] - Select child at this index instead of the new block
   * @returns {string} The new block's ID
   */
  const insertAndSelectBlock = useCallback((blockId, blockType, action, fieldName, options = {}) => {
    const { blockData: customBlockData, formData: customFormData, blockPathMap: customBlockPathMap, formatRequestId, selectChildIndex, selectFirstLeaf, region: addRegion } = options;
    const formData = customFormData || properties;
    const blockPathMap = customBlockPathMap || iframeSyncState.blockPathMap;
    const mergedBlocksConfig = config.blocks.blocksConfig;
    const newBlockId = uuid();

    // Handle template insertion - templates expand to multiple blocks
    const templateConfig = mergedBlocksConfig[blockType];
    if (templateConfig?.isTemplate && templateConfig?.templateUrl) {
      // Fetch template data and insert (async)
      (async () => {
        try {
          // Use mergeTemplatesIntoPage with the template as the only allowedLayout to force it
          const { merged: newFormData } = await mergeTemplatesIntoPage(formData, {
            loadTemplate: async () => {
              const response = await fetch(`/++api++${templateConfig.templateUrl}`);
              if (!response.ok) throw new Error(`Failed to fetch template: ${response.status}`);
              return response.json();
            },
            pageBlocksFields: { [fieldName || 'items']: { allowedLayouts: [templateConfig.templateUrl] } },
            uuidGenerator: uuid,
            idFieldMap,
            blocksConfig: config.blocks.blocksConfig,
            intl,
          });

          // Merge with existing formData (preserve other fields like title, description)
          onChangeFormData({
            ...formData,
            blocks: newFormData.blocks,
            blocks_layout: newFormData.blocks_layout,
          });

          // Select the template virtual block (instance)
          // Get templateInstanceId from any template block
          const firstBlockId = newFormData.blocks_layout?.items?.[0];
          const firstBlock = newFormData.blocks?.[firstBlockId];
          const tplInstanceId = firstBlock?.templateInstanceId;

          if (tplInstanceId) {
            flushSync(() => {
              setIframeSyncState((prev) => ({
                ...prev,
                pendingSelectBlockUid: tplInstanceId,
              }));
            });
          }
          dispatch(setSidebarTab(1));
        } catch (error) {
          console.error('[VIEW] Failed to insert template:', error);
        }
      })();

      return null; // Async - block ID not immediately available
    }

    // Get container config and determine if object_list
    let containerConfig;
    let isObjectList = false;
    let fieldDef;

    if (action === 'inside') {
      // Get field info from blockPathMap (already resolved by buildBlockPathMap, includes schemaEnhancer)
      const childEntry = Object.values(blockPathMap || {}).find(
        (info) => info.parentId === blockId && info.region === fieldName
      );
      if (childEntry?.isObjectListItem) {
        isObjectList = true;
        fieldDef = {
          typeField: childEntry.typeField || null,
          allowedBlocks: childEntry.allowedSiblingTypes,
          idField: childEntry.idField,
          widget: 'object_list',
        };
      } else {
        // blocks_layout container or no existing children — try schema as fallback
        const parentType = blockPathMap[blockId]?.blockType;
        const parentSchema =
          typeof mergedBlocksConfig?.[parentType]?.blockSchema === 'function'
            ? mergedBlocksConfig[parentType].blockSchema({
                formData: {},
                intl: { formatMessage: (m) => m.defaultMessage },
              })
            : mergedBlocksConfig?.[parentType]?.blockSchema;
        fieldDef = parentSchema?.properties?.[fieldName];
        isObjectList = fieldDef?.widget === 'object_list';
      }
      // 'inside' adds to a specific region (default 'items'); the descriptor's
      // region flows into insertBlockInContainer via the funnel.
      containerConfig = { parentId: blockId, fieldName, isObjectList, region: addRegion || 'items' };
    } else {
      containerConfig = getContainerFieldConfig(blockId, blockPathMap, formData, mergedBlocksConfig, intl);
      // For before/after, get isObjectList from containerConfig
      isObjectList = containerConfig?.isObjectList || false;
    }

    // Check for table mode (from containerConfig which comes from pathMap)
    const isTableMode = containerConfig?.addMode === 'table';
    const isTableCell = containerConfig?.parentAddMode === 'table';

    // Table mode: adding a cell adds a column (to ALL rows)
    if (isTableCell && action !== 'inside') {
      // Create cell template with defaults. `cellType` is the item's type from the
      // pathMap: a VIRTUAL type (e.g. 'slateTable:rows:cells') for a non-typed
      // object_list, or a REAL registered type (e.g. 'tableCell') for a typed one.
      const cellType = blockPathMap[blockId]?.blockType;
      const isTypedCell = !!mergedBlocksConfig[cellType];
      let cellData = { '@type': cellType };
      cellData = applyBlockDefaults({ data: cellData, formData: cellData, intl, metadata, properties }, mergedBlocksConfig);
      cellData = initializeContainerBlock(cellData, mergedBlocksConfig, uuid, { intl, metadata, properties, blockType: cellType });
      // A TYPED cells region must KEEP the new cell's @type so it stays a real block
      // and the position typeRule can re-type it per row (header row →
      // tableHeaderCell). Only the OLD virtual-type cells (no blocksConfig entry,
      // no @type stored) clear it.
      if (!isTypedCell) {
        cellData = clearBlockType(cellData);
      }

      const result = insertTableColumn(
        formData,
        blockPathMap,
        blockId,
        cellData,
        action,
        uuid,
      );

      if (!result?.formData) {
        console.error('[VIEW] insertTableColumn failed');
        return null;
      }

      // Typed cells: re-run the schema-default pass so the position `@type` rule
      // re-types the uniform new cells per row (the header-row cell → its value
      // form). Virtual-cell tables have no typeRule, so skip the extra pass.
      let committedFormData = result.formData;
      if (isTypedCell) {
        const cbpm = buildBlockPathMap(result.formData, mergedBlocksConfig, intl);
        committedFormData = applySchemaDefaultsToFormData(result.formData, cbpm, mergedBlocksConfig, intl);
      }
      onChangeFormData(committedFormData);
      flushSync(() => {
        setIframeSyncState((prev) => ({
          ...prev,
          pendingSelectBlockUid: result.insertedCellId,
          ...(formatRequestId ? { pendingFormatRequestId: formatRequestId } : {}),
        }));
      });
      dispatch(setSidebarTab(1));

      return result.insertedCellId;
    }

    // Create block data (use custom data if provided)
    let blockData;

    // Inherit template membership (templateId/slotId) for a block inserted into a
    // container region — uniform across blocks_layout and object_list. Both are just an
    // ordered region of child blocks; getChildBlockEntries (public helper) normalises the
    // storage so this never branches on it. The neighbour is the LAST existing child for
    // 'inside' (append at end), else the sibling blockId we insert relative to.
    const inheritTemplateMembership = (bd) => {
      // A pasted/added block takes on the membership of where it LANDS — strip any source
      // template/slot it arrived carrying (e.g. copied from a template slot) so the
      // recompute below derives membership purely from the destination. Fixed template
      // blocks keep theirs. (Fresh adds have no membership, so this is a no-op for them.)
      if (bd && !bd.fixed && (bd.templateId || bd.slotId)) {
        bd = { ...bd };
        delete bd.templateId;
        delete bd.templateInstanceId;
        delete bd.slotId;
        delete bd.readOnly;
      }
      const region = containerConfig?.region || 'items';
      // The REAL container the new block lands in: containerConfig.parentId (the page,
      // or the container for a nested/inside add). NOT blockPathMap[blockId].parentId —
      // for a template-member block that is the VIRTUAL templateInstanceId, not a real
      // block, so getChildBlockEntries finds no siblings and nothing is inherited.
      const containerId = action === 'inside' ? blockId : (containerConfig?.parentId || PAGE_BLOCK_UID);
      const container = (containerId === PAGE_BLOCK_UID || containerId === 'page')
        ? formData
        : getBlockById(formData, blockPathMap, containerId);
      const entries = getChildBlockEntries(container, containerConfig);
      const refIndex = entries.findIndex((entry) => entry.id === blockId);
      const position = action === 'inside' ? entries.length
        : action === 'after' ? refIndex + 1
        : refIndex;
      const insertAfter = action === 'after' || action === 'inside';
      return applyBlockDefaultsWithContext(bd, {
        items: entries.map((entry) => entry.block),
        position,
        insertAfter,
        parentBlock: container,
        containerId,
        field: region,
        blocksConfig: mergedBlocksConfig,
        intl,
      });
    };

    if (customBlockData) {
      blockData = customBlockData;
    } else if (isObjectList) {
      // object_list items: typeField defaults to '@type' — no special casing needed
      const idField = containerConfig?.idField || fieldDef?.idField || '@id';
      const typeFieldName = (action === 'inside' ? fieldDef?.typeField : blockPathMap[blockId]?.typeField) || '@type';

      let effectiveType;
      if (blockType) {
        // Block type explicitly chosen (from BlockChooser) — use it directly
        effectiveType = blockType;
      } else if (action === 'inside') {
        // Single-schema or no explicit type: virtual type from parent:field
        effectiveType = `${blockPathMap[blockId]?.blockType}:${fieldName}`;
      } else {
        // Before/after: use existing item's type
        effectiveType = blockPathMap[blockId]?.blockType;
      }
      blockData = { [idField]: newBlockId, '@type': effectiveType };

      // For table mode rows, pass sibling data so cells count is copied
      let siblingData = null;
      if (isTableMode) {
        // Get existing rows for cell count reference
        // For 'inside' action: blockId is the table, fieldName is 'rows'
        // For 'before'/'after' action: blockId is a row, need to get parent table
        let tableBlock;
        let dataPath;
        if (action === 'inside') {
          tableBlock = getBlockById(formData, blockPathMap, blockId);
          dataPath = [...(containerConfig?.regionPath || []), fieldName];
        } else {
          // For before/after on a row, get the parent table. The row's pathInfo
          // carries the object prefix (regionPath, e.g. [table]) to the rows
          // array — array is at [...regionPath, region].
          const rowPathInfo = blockPathMap?.[blockId];
          const parentId = rowPathInfo?.parentId;
          tableBlock = getBlockById(formData, blockPathMap, parentId);
          dataPath = [...(rowPathInfo?.regionPath || []), rowPathInfo?.region];
        }
        let rowsData = tableBlock;
        for (const key of dataPath) {
          rowsData = rowsData?.[key];
        }
        siblingData = Array.isArray(rowsData) ? rowsData : null;
      }

      // Initialize nested containers (e.g., cells in a row)
      blockData = initializeContainerBlock(blockData, mergedBlocksConfig, uuid, { intl, metadata, properties, siblingData, blockType: effectiveType });

      // Inherit template membership from the neighbour (uniform read; see helper above).
      blockData = inheritTemplateMembership(blockData);

      // Store the type in the typeField (dropping the @type used only for schema
      // resolution) — the shared setBlockType.
      blockData = setBlockType(blockData, effectiveType, typeFieldName);
    } else {
      // Standard block with @type
      blockData = { '@type': blockType };
      if (blockType === 'slate') {
        blockData.value = [{ type: 'p', children: [{ text: '' }] }];
      }

      // Inherit template membership from the neighbour (uniform read; see helper above).
      blockData = inheritTemplateMembership(blockData);

      // Also apply regular applyBlockDefaults for non-context-aware schemas
      blockData = applyBlockDefaults({ data: blockData, formData: blockData, intl, metadata, properties });
      blockData = initializeContainerBlock(blockData, mergedBlocksConfig, uuid, { intl, metadata, properties, blockType });
    }

    // Insert and update state
    let newFormData = insertBlockInContainer(
      formData,
      blockPathMap,
      blockId,
      newBlockId,
      blockData,
      containerConfig,
      action,
    );

    if (!newFormData) {
      console.error('[VIEW] insertAndSelectBlock failed');
      return null;
    }

    // Ensure new container blocks have at least one child (for gridBlock etc.).
    // NOT settleBlockStructure's job: nothing was taken out of anything here — a
    // container that has just been created needs a child to be usable, which is
    // the ADD invariant, not the three an edit owes afterwards.
    const newBlockPathMap = buildBlockPathMap(newFormData, mergedBlocksConfig, intl);
    newFormData = ensureEmptyBlockIfEmpty(
      newFormData,
      { parentId: newBlockId },
      newBlockPathMap,
      uuid,
      mergedBlocksConfig,
      { intl, metadata, properties },
    );

    // Determine which block to select
    let selectBlockId = newBlockId;
    if (selectChildIndex != null && blockData) {
      // Find the first array field in the block and get the child at selectChildIndex
      // This is used when adding a row from a cell - we want to select the corresponding cell
      for (const [, fieldValue] of Object.entries(blockData)) {
        if (Array.isArray(fieldValue) && fieldValue[selectChildIndex]) {
          const childItem = fieldValue[selectChildIndex];
          // Get the ID field - typically 'key' or '@id'
          const childId = childItem?.key || childItem?.['@id'];
          if (childId) {
            selectBlockId = childId;
            break;
          }
        }
      }
    }
    // Drill into the new container's first leaf (recursive descent through
    // blocks_layout.items[0]) when the caller wants the keyboard-Enter UX:
    // user pressed Enter expecting to type, so put selection on the deepest
    // typeable child rather than the container shell. Toolbar/sidebar Add
    // paths don't pass selectFirstLeaf — they want the new container itself
    // selected so the user can configure it.
    if (selectFirstLeaf) {
      const updatedPathMap = buildBlockPathMap(newFormData, mergedBlocksConfig, intl);
      let walked = selectBlockId;
      while (true) {
        const blk = getBlockById(newFormData, updatedPathMap, walked);
        const firstChildUid = blk?.blocks_layout?.items?.[0];
        if (!firstChildUid || !updatedPathMap[firstChildUid]) break;
        walked = firstChildUid;
      }
      selectBlockId = walked;
    }

    // Set pending selection and blockPathMap, but NOT formData
    // formData will be updated by the useEffect after it sends FORM_DATA to iframe
    // This ensures the useEffect sees a content change and doesn't skip sending
    const insertBlockPathMap = buildBlockPathMap(newFormData, config.blocks.blocksConfig, intl);
    flushSync(() => {
      setIframeSyncState((prev) => ({
        ...prev,
        blockPathMap: insertBlockPathMap,
        pendingSelectBlockUid: selectBlockId,
        ...(formatRequestId ? { pendingFormatRequestId: formatRequestId } : {}),
      }));
    });
    onChangeFormData(newFormData);
    dispatch(setSidebarTab(1));

    return newBlockId;
  }, [properties, iframeSyncState.blockPathMap, intl, metadata, onChangeFormData, dispatch]);

  const onMutateBlock = (id, value) => {
    // Use merged config from registry (includes frontend's custom blocks after INIT)
    const mergedBlocksConfig = config.blocks.blocksConfig;

    // Initialize block data the same way as onInsertBlock
    // This is important when replacing empty blocks with real blocks
    let blockData = { '@type': value['@type'], ...value };

    // Add initial slate value for slate blocks
    if (blockData['@type'] === 'slate' && !blockData.value) {
      blockData.value = [{ type: 'p', children: [{ text: '' }] }];
    }

    // Apply block defaults
    // Pass formData alongside data - some Volto schemas expect formData (e.g., ImageSchema)
    blockData = applyBlockDefaults({
      data: blockData,
      formData: blockData,
      intl,
      metadata,
      properties,
    });

    // Initialize container blocks with default children (recursive)
    // onMutateBlock replaces blocks in blocks_layout, so @type is the type field
    blockData = initializeContainerBlock(blockData, mergedBlocksConfig, uuid, {
      intl,
      metadata,
      properties,
      blockType: value['@type'],
    });

    // Check if mutating inside a container (null means page-level)
    const containerConfig = getContainerFieldConfig(
      id,
      iframeSyncState.blockPathMap,
      properties,
      mergedBlocksConfig,
      intl,
    );

    // A typed object_list item carries its type in the typeField, not @type — the same field
    // getBlockAddability reads (dcd3114). Everything above ran with @type so applyBlockDefaults
    // / initializeContainerBlock could find the schema; now write the type where it lives (and
    // drop @type), or a form field's pick would land in @type (which FormBlock ignores) and
    // field_type would stay 'empty'.
    const targetTypeField = iframeSyncState.blockPathMap?.[id]?.typeField;
    if (targetTypeField) {
      blockData = setBlockType(blockData, blockData['@type'], targetTypeField);
    }

    // Use container-aware mutation for nested blocks
    const newFormData = mutateBlockInContainer(
      properties,
      iframeSyncState.blockPathMap,
      id,
      blockData,
      containerConfig,
    );

    // Rebuild blockPathMap to reflect the new block type (e.g., empty → slate)
    // Do NOT set formData here - let the useEffect update it after sending FORM_DATA
    const newBlockPathMap = buildBlockPathMap(newFormData, mergedBlocksConfig, intl);
    setIframeSyncState(prev => ({
      ...prev,
      blockPathMap: newBlockPathMap,
    }));
    onChangeFormData(newFormData);
  };

  const onDeleteBlock = (id, selectPrev) => {
    // Use merged config from registry (includes frontend's custom blocks after INIT)
    const mergedBlocksConfig = config.blocks.blocksConfig;

    // Check if this is a template instance (virtual block)
    const pathInfo = iframeSyncState.blockPathMap?.[id];
    if (pathInfo?.isTemplateInstance) {
      // Remove template instance: delete fixed blocks, strip template fields from user content
      let newFormData = removeTemplateInstance(
        properties,
        iframeSyncState.blockPathMap,
        id,
      );

      // Rebuild blockPathMap to reflect the removed template
      const newBlockPathMap = buildBlockPathMap(newFormData, mergedBlocksConfig, intl);
      setIframeSyncState(prev => ({
        ...prev,
        blockPathMap: newBlockPathMap,
      }));
      onChangeFormData(newFormData);
      onSelectBlock(null);
      setAddNewBlockOpened(false);
      dispatch(setSidebarTab(1));
      return;
    }

    // Check if deleting from a container (null means page-level)
    const containerConfig = getContainerFieldConfig(
      id,
      iframeSyncState.blockPathMap,
      properties,
      mergedBlocksConfig,
      intl,
    );

    // Compute which block to select after deletion (previous sibling, or parent if last)
    const selectAfterDelete = getSelectAfterDelete(
      id, containerConfig, iframeSyncState.blockPathMap, properties,
    );

    // The SAME delete the multi path uses — one block is a list of one. It
    // deletes, then re-seeds a region it emptied: a forced region keeps a
    // placeholder, and that placeholder carries the template membership the lock
    // control needs.
    const { formData: newFormData } = deleteBlocks(
      properties,
      iframeSyncState.blockPathMap,
      [id],
      {
        blocksConfig,
        intl,
        uuidGenerator: uuid,
        templateEditMode: iframeSyncState.templateEditMode,
        metadata,
      },
    );

    // Rebuild blockPathMap to reflect the deleted block
    // Do NOT set formData here - let the useEffect update it after sending FORM_DATA
    const newBlockPathMap = buildBlockPathMap(newFormData, mergedBlocksConfig, intl);
    const selectAfterDeleteUid = selectPrev ? selectAfterDelete : null;
    setIframeSyncState(prev => ({
      ...prev,
      blockPathMap: newBlockPathMap,
      ...(selectAfterDeleteUid ? { pendingSelectBlockUid: selectAfterDeleteUid } : {}),
    }));
    onChangeFormData(newFormData);
    onSelectBlock(selectAfterDeleteUid);
    setAddNewBlockOpened(false);
    dispatch(setSidebarTab(1));
  };

  // Process pending delete from iframe DELETE_BLOCK message (same pattern as addNewBlockOpened)
  useEffect(() => {
    if (pendingDelete) {
      onDeleteBlock(pendingDelete.uid, pendingDelete.selectPrev);
      setPendingDelete(null);
    }
  }, [pendingDelete]);

  useEffect(() => {
    const initialUrlOrigin = iframeSrc && new URL(iframeSrc).origin;
    const messageHandler = (event) => {
      if (event.origin !== initialUrlOrigin) {
        return;
      }
      // Everything but the compared-language pane, which has its own handler
      // and its own read-only page. Both frames are on the frontend's origin
      // and both post here, so without this the editor would act on the other
      // page's messages — selecting its blocks, moving them.
      //
      // Narrow on purpose: an earlier version demanded the message come from
      // THIS canvas's own frame, and rejected real ones (a MOVE_BLOCKS from
      // the preview) whenever the element's contentWindow was not the one the
      // ref happened to hold.
      if (typeof document !== 'undefined') {
        const comparePane = document.getElementById('translationSourceIframe');
        if (comparePane && event.source === comparePane.contentWindow) return;
      }

      // Store the actual iframe origin from the first message we receive
      if (!iframeOriginRef.current) {
        iframeOriginRef.current = event.origin;
      }
      const { type } = event.data;

      // Save pre-message sequence for echo detection (used by INLINE_EDIT_DATA).
      const preMessageSeq = editSequenceRef.current;

      // Adopt the iframe's edit sequence from ANY message carrying form data.
      // The iframe increments _editSequence when buffering local changes (typing).
      // Without this, editSequenceRef stays stale when typing is buffered directly
      // into a transform request (e.g., Enter pressed before debounced send).
      if (event.data.data?._editSequence != null) {
        const msgSeq = event.data.data._editSequence;
        if (msgSeq > editSequenceRef.current) {
          editSequenceRef.current = msgSeq;
        }
      }

      switch (type) {
        case 'PATH_CHANGE': { // PATH change from the iframe (SPA navigation)
          // Check if this is in-page navigation (e.g., paging) - just resend form data
          if (event.data.inPage) {
            log('PATH_CHANGE: in-page navigation (paging), resending form data');
            // Build blockPathMap and apply defaults (same as INIT handler)
            const resendBlockPathMap = buildBlockPathMap(form, config.blocks.blocksConfig, intl);
            const resendFormWithDefaults = applySchemaDefaultsToFormData(
              form,
              resendBlockPathMap,
              config.blocks.blocksConfig,
              intl,
            );
            const toolbarButtons = config.settings.slate?.toolbarButtons || [];
            event.source.postMessage(
              {
                type: 'INITIAL_DATA',
                data: resendFormWithDefaults,
                blockPathMap: stripBlockPathMapForPostMessage(resendBlockPathMap),
                conversionMap: getConversionMap(config.blocks.blocksConfig),
                selectedBlockUid: selectedBlock,
                slateConfig: {
                  hotkeys: config.settings.slate?.hotkeys || {},
                  toolbarButtons,
                },
              },
              event.origin,
            );
            break;
          }
          // User clicked a nav link in iframe - they want to VIEW that page, not edit it
          // Strip the iframe's base path prefix from the reported path
          // e.g., iframe at /edit/about → content path /about
          const iframeBasePath = u ? new URL(u).pathname.replace(/\/$/, '') : '';
          let navPath = event.data.path;
          if (iframeBasePath && navPath.startsWith(iframeBasePath)) {
            navPath = navPath.slice(iframeBasePath.length) || '/';
          }
          // Update module-level state BEFORE history.push so useEffect knows iframe already has this path
          persistedIframe = { frontendUrl: u, path: navPath, isEdit: false };
          history.push(navPath);
          break;
        }


        case 'OPEN_SETTINGS':
          // NOTE: Do NOT call onSelectBlock here. BLOCK_SELECTED is the single source of
          // truth for selection - it sets both selectedBlock (via onSelectBlock) and blockUI
          // atomically. OPEN_SETTINGS just opens the sidebar; selection happens via BLOCK_SELECTED.
          if (history.location.pathname.endsWith('/edit')) {
            setAddNewBlockOpened(false);
            dispatch(setSidebarTab(1));
          }
          break;

        case 'ADD_BLOCK':
          setAddNewBlockOpened(true);
          break;

        case 'DELETE_BLOCK':
          setPendingDelete({ uid: event.data.uid, selectPrev: true });
          break;

        case 'DELETE_BLOCKS': {
          const uidsToDelete = event.data.uids || [];
          log('DELETE_BLOCKS: dispatching hydra-delete-blocks for', uidsToDelete.length, 'blocks');
          document.dispatchEvent(new CustomEvent('hydra-delete-blocks', {
            detail: { blockIds: uidsToDelete },
          }));
          break;
        }

        case 'COPY_BLOCKS': {
          const uids = event.data.uids || [];
          const action = event.data.action || 'copy'; // 'copy' or 'cut'
          const blocksData = uids
            .map(uid => {
              const block = getBlockById(properties, iframeSyncState.blockPathMap, uid);
              return block ? [uid, block] : null;
            })
            .filter(Boolean);
          log('COPY_BLOCKS:', action, blocksData.length, 'blocks');
          dispatch(setBlocksClipboard({ [action]: blocksData }));
          break;
        }

        case 'PASTE_BLOCKS': {
          // Paste from blocks clipboard after the specified block (Cmd+V in block mode)
          const afterBlockId = event.data.afterBlockId;
          if (!afterBlockId) break;
          document.dispatchEvent(new CustomEvent('hydra-paste-blocks', {
            detail: { afterBlockId, keepClipboard: false },
          }));
          break;
        }

        case 'ENTER_SELECTION_MODE': {
          const { blockUid: toggledUid, allBlockRects } = event.data;
          log('ENTER_SELECTION_MODE:', toggledUid || '(activate only)', allBlockRects ? Object.keys(allBlockRects).length + ' rects' : 'toggle');
          setSelectionMode(true);
          if (allBlockRects) {
            setBlockUI(prev => ({ ...prev, selectionModeRects: allBlockRects }));
          }
          // Toggle blockUid in multiSelected only if provided. When admin triggered
          // selection mode via sidebar (no blockUid), multiSelected is already set.
          if (toggledUid && onSetMultiSelected) {
            const current = multiSelectedRef.current || [];
            const idx = current.indexOf(toggledUid);
            const updated = idx >= 0
              ? current.filter(id => id !== toggledUid)
              : [...current, toggledUid];
            if (updated.length === 0) {
              // All unchecked — exit selection mode
              onSetMultiSelected([]);
              const iframe = document.getElementById('previewIframe');
              if (iframe?.contentWindow && iframeOriginRef.current) {
                iframe.contentWindow.postMessage({ type: 'EXIT_SELECTION_MODE' }, iframeOriginRef.current);
              }
            } else {
              onSetMultiSelected(updated);
            }
          }
          break;
        }

        case 'EXIT_SELECTION_MODE': {
          log('EXIT_SELECTION_MODE ack from iframe');
          setSelectionMode(false);
          break;
        }

        case 'ADD_BLOCK_AFTER': {
          // "Another one of these" if the source block's @type is in the
          // computed allowed types for this position; otherwise defer to
          // the centralised getEmptyBlockType chain (defaultBlockType →
          // single-allowedBlocks → config.settings.defaultBlockType →
          // 'empty' slot). Same definition used by ensureEmptyBlockIfEmpty.
          const containerFieldConfig = getContainerFieldConfig(
            event.data.blockId, iframeSyncState.blockPathMap, properties, config.blocks.blocksConfig, intl
          );
          const sourcePathInfo = iframeSyncState.blockPathMap?.[event.data.blockId];
          const sourceType = sourcePathInfo?.blockType;
          const allowedSiblings = sourcePathInfo?.allowedSiblingTypes;
          const sourceAllowed = sourceType
            && (!allowedSiblings || allowedSiblings.includes(sourceType));
          const newType = sourceAllowed
            ? sourceType
            : getEmptyBlockType(containerFieldConfig);
          // ADD_BLOCK_AFTER comes from the bridge's keyboard-Enter handler
          // (block-mode Enter, last-field plain-string Enter, slate split).
          // Keyboard intent is "ready to type", so drill the selection down
          // to the new block's first leaf when the new block is a container.
          // Toolbar/sidebar Add paths use different message types and keep
          // selection on the new container.
          insertAndSelectBlock(event.data.blockId, newType, 'after', null, { selectFirstLeaf: true });
          break;
        }

        case 'SLASH_MENU':
          if (event.data.action === 'filter') {
            setSlashMenu({ blockId: event.data.blockId, filter: event.data.filter, fieldRect: event.data.fieldRect });
            setSlashMenuIndex(0);
          } else if (event.data.action === 'hide') {
            setSlashMenu(null);
            setSlashMenuIndex(0);
          } else if (event.data.action === 'up') {
            setSlashMenuIndex(prev => (prev > 0 ? prev - 1 : prev));
          } else if (event.data.action === 'down') {
            setSlashMenuIndex(prev => prev + 1);
          } else if (event.data.action === 'select') {
            // Selection is handled by the slashMenuSelect effect below
            setSlashMenu(prev => prev ? { ...prev, selecting: true } : null);
          }
          break;

        case 'INLINE_EDIT_DATA': {
          // Validate data from postMessage before using it
          validateAndLog(event.data.data, 'INLINE_EDIT_DATA', blockFieldTypes);
          const incomingSequence = event.data.data?._editSequence || 0;
          // Use preMessageSeq (saved before universal adoption) for echo detection.
          // The universal adoption already bumped editSequenceRef, so reading it
          // here would always show incomingSeq == editSequenceRef → never new.
          log('INLINE_EDIT_DATA flushRequestId:', event.data.flushRequestId, '_editSequence:', incomingSequence, 'preMessageSeq:', preMessageSeq);

          // Sequence logic:
          // - incomingSeq > preMessageSeq: new edit from iframe, process it
          // - incomingSeq <= preMessageSeq: echo or stale, only update selection
          const isNewEdit = incomingSequence > preMessageSeq;

          if (isNewEdit) {
            // New edit from iframe - update everything.
            // Copy-from-target: turn any LINKED field edited inline CUSTOM, by the
            // same value-compare used for image/link edits — the inline message
            // carries the whole formData with no clue which field changed. Applied
            // synchronously (part of THIS update) so it doesn't re-render mid-type
            // and move the cursor.
            inlineEditCounterRef.current += 1;
            let editedData = markEditedLinkedFieldsCustom(
              event.data.data,
              properties,
              config.blocks.blocksConfig,
            );
            // Fold the deep-link anchors harvested with THIS edit into the same
            // formData. They ride on INLINE_EDIT_DATA (this fresh iframe formData,
            // adopted wholesale below) rather than a separate LINKABLE_ANCHORS
            // message — so block._linkableAnchors is merged into the CURRENT edit,
            // never a stale snapshot, and there's no extra re-render. Editing a
            // heading re-slugs it each keystroke, so this is the common path; the
            // separate LINKABLE_ANCHORS handler now only fires for structural
            // changes (reorder/delete of heading blocks).
            if (event.data.anchors) {
              editedData = mergeAnchorsIntoContent(
                editedData,
                event.data.anchors,
                config.blocks.blocksConfig,
                intl,
              );
            }
            // Debug: log full children structure to diagnose missing "w" bug
            const debugBlock = editedData?.blocks?.['block-1-uuid'];
            if (debugBlock?.value?.[0]?.children) {
              log('INLINE_EDIT_DATA: full children structure:', JSON.stringify(debugBlock.value[0].children));
            }
            setIframeSyncState(prev => ({
              ...prev,
              formData: editedData,
              blockPathMap: buildBlockPathMap(editedData, config.blocks.blocksConfig, intl),
              selection: event.data.selection || null,
              _selectionSource: 'INLINE_EDIT_DATA:new',
              ...(event.data.flushRequestId ? { completedFlushRequestId: event.data.flushRequestId } : {}),
            }));
            // Strip _editSequence when updating Redux - sequence numbers are for iframe
            // echo detection only. Redux data doesn't need sequences since admin-side echo
            // prevention uses content comparison (processedInlineEditCounterRef + formDataContentEqual).
            const { _editSequence: _, ...formDataWithoutSeq } = editedData;
            log('INLINE_EDIT_DATA: calling onChangeFormData prop to update Redux (without _editSequence)');
            onChangeFormData(formDataWithoutSeq);
          } else {
            // Echo or stale - only update flush state (NOT selection).
            // The iframe may echo back a wrong cursor position (e.g., [0,0]
            // instead of [0,1,0] inside a prospective-format node). The admin
            // already has the authoritative selection from the format transform.
            log('INLINE_EDIT_DATA: echo/stale, updating flush state only (ignoring selection)');
            if (event.data.flushRequestId) {
              setIframeSyncState(prev => ({
                ...prev,
                completedFlushRequestId: event.data.flushRequestId,
              }));
            }
          }
          break;
        }

        case 'LINKABLE_ANCHORS': {
          // Iframe harvested data-linkable-id anchors (full map, keyed by nearest
          // data-block-uid). Merge them straight into the canonical formData so
          // block._linkableAnchors rides the normal update flow — the object
          // browser reads them from the form and they persist on the ordinary
          // save (no transient store, no save-time merge). To avoid re-rendering
          // the iframe mid-edit (cursor loss), reuse the INLINE_EDIT_DATA echo
          // guard: bump inlineEditCounterRef so the UNIFIED FORM SYNC effect
          // swallows the resulting properties change instead of bouncing a
          // FORM_DATA back. hydra already echo-guards the send (only on a DOM-map
          // change), and we skip the dispatch when the merge is a no-op.
          const base = properties || form;
          if (base?.blocks) {
            const merged = mergeAnchorsIntoContent(
              base,
              event.data.anchors || {},
              config.blocks.blocksConfig,
              intl,
            );
            if (JSON.stringify(merged) !== JSON.stringify(base)) {
              inlineEditCounterRef.current += 1;
              onChangeFormData(merged);
            }
          }
          break;
        }

        case 'BUFFER_FLUSHED':
          // Iframe had no pending text - update combined state with current form + requestId + selection
          log('Received BUFFER_FLUSHED (no pending text), requestId:', event.data.requestId);
          setIframeSyncState(prev => ({
            ...prev,
            selection: event.data.selection || null,
            _selectionSource: 'BUFFER_FLUSHED',
            completedFlushRequestId: event.data.requestId,
          }));
          break;

        case 'INLINE_EDIT_EXIT':
          
          break;

        case 'TOGGLE_MARK': {
          // console.log('TOGGLE_BOLD', event.data.html);

          const deserializedHTMLData = toggleMark(event.data.html);
          // console.log('deserializedHTMLData', deserializedHTMLData);
          onChangeFormData({
            ...form,
            blocks: {
              ...form.blocks,
              [selectedBlock]: {
                ...form.blocks[selectedBlock],
                value: deserializedHTMLData,
              },
            },
          });
          event.source.postMessage(
            {
              type: 'TOGGLE_MARK_DONE',
              data: {
                ...form,
                blocks: {
                  ...form.blocks,
                  [selectedBlock]: {
                    ...form.blocks[selectedBlock],
                    value: deserializedHTMLData,
                  },
                },
              },
            },
            event.origin,
          );
          break;
        }

        case 'SLATE_TRANSFORM_REQUEST':
          window._formatT0 = performance.now();
          console.log('[VIEW-TIMING] SLATE_TRANSFORM_REQUEST received');
          // Validate data from postMessage before using it
          validateAndLog(event.data.data, 'SLATE_TRANSFORM_REQUEST', blockFieldTypes);

          // Unified transform request from iframe - always includes form data with buffer
          // transformType: 'format', 'paste', 'delete', 'enter'
          // fieldName: which field is being edited (e.g., 'value', 'description')

          if (event.data.transformType === 'enter') {
            // Enter is handled directly here since it creates a new block
            try {
              const { blockId: enterBlockId, fieldName: enterFieldName, selection: enterSelection, requestId: enterRequestId } = event.data;
              const formToUseForEnter = event.data.data;

              // Update iframeSyncState to keep it in sync
              const enterBlockPathMap = buildBlockPathMap(formToUseForEnter, config.blocks.blocksConfig, intl);
              setIframeSyncState(prev => ({
                ...prev,
                formData: formToUseForEnter,
                blockPathMap: enterBlockPathMap,
                selection: enterSelection || null,
              }));

              // Get the current block data using path lookup (supports nested blocks)
              const enterBlockPath = enterBlockPathMap[enterBlockId]?.path;
              const currentBlock = enterBlockPath
                ? getBlockByPath(formToUseForEnter, enterBlockPath)
                : formToUseForEnter.blocks[enterBlockId];
              if (!currentBlock) {
                break;
              }
              const blockType = currentBlock['@type'];
              const fieldType = blockFieldTypes[blockType]?.[enterFieldName];
              if (!isSlateFieldType(fieldType)) {
                // Not a slate field - don't split block
                break;
              }

              // Get the field value to split
              const fieldValue = currentBlock[enterFieldName];
              if (!fieldValue) {
                break;
              }

              // Check if cursor is in a list item — handle differently from normal split
              if (slateTransforms.isSelectionInList(fieldValue, enterSelection)) {
                const containerConfig = getContainerFieldConfig(
                  enterBlockId, enterBlockPathMap, formToUseForEnter,
                  config.blocks.blocksConfig, intl,
                );

                if (slateTransforms.isCurrentListItemEmpty(fieldValue, enterSelection)) {
                  // Empty list item: remove it and create new empty block after
                  const { newValue } = slateTransforms.removeEmptyListItem(fieldValue, enterSelection);
                  const updatedBlock = { ...currentBlock, [enterFieldName]: newValue };
                  const mutatedFormData = mutateBlockInContainer(
                    formToUseForEnter, enterBlockPathMap, enterBlockId, updatedBlock, containerConfig,
                  );
                  const syncedBpm = buildBlockPathMap(mutatedFormData, config.blocks.blocksConfig, intl);
                  flushSync(() => {
                    setIframeSyncState(prev => ({
                      ...prev,
                      formData: mutatedFormData,
                      blockPathMap: syncedBpm,
                    }));
                  });
                  onChangeFormData(mutatedFormData);
                  insertAndSelectBlock(enterBlockId, currentBlock['@type'] || 'slate', 'after', null, {
                    formatRequestId: enterRequestId,
                    formData: mutatedFormData,
                    blockPathMap: syncedBpm,
                  });
                } else {
                  // Non-empty list item: split it (new bullet, same block)
                  const { newValue, newSelection } = slateTransforms.splitListItem(fieldValue, enterSelection);
                  const updatedBlock = { ...currentBlock, [enterFieldName]: newValue };
                  const mutatedFormData = mutateBlockInContainer(
                    formToUseForEnter, enterBlockPathMap, enterBlockId, updatedBlock, containerConfig,
                  );
                  const newBpm = buildBlockPathMap(mutatedFormData, config.blocks.blocksConfig, intl);
                  setIframeSyncState(prev => ({
                    ...prev,
                    formData: mutatedFormData,
                    blockPathMap: newBpm,
                    selection: newSelection,
                    toolbarRequestDone: enterRequestId,
                  }));
                }
                break;
              }

              // Split the block at the cursor using slateTransforms
              const { topValue, bottomValue } = slateTransforms.splitBlock(
                fieldValue,
                enterSelection,
              );

              // Check if this block is inside a container
              const containerConfig = getContainerFieldConfig(
                enterBlockId,
                enterBlockPathMap,
                formToUseForEnter,
                config.blocks.blocksConfig,
                intl,
              );

              // Update current block with content before cursor
              const updatedCurrentBlock = {
                ...currentBlock,
                [enterFieldName]: topValue,
              };
              const mutatedFormData = mutateBlockInContainer(
                formToUseForEnter,
                enterBlockPathMap,
                enterBlockId,
                updatedCurrentBlock,
                containerConfig,
              );

              // First sync the text changes to Redux (like toolbar onChange does for format)
              // This ensures state is consistent before insert
              const syncedBlockPathMap = buildBlockPathMap(mutatedFormData, config.blocks.blocksConfig, intl);
              flushSync(() => {
                setIframeSyncState(prev => ({
                  ...prev,
                  formData: mutatedFormData,
                  blockPathMap: syncedBlockPathMap,
                }));
              });
              onChangeFormData(mutatedFormData);

              // Insert new block with bottom half of split text.
              // Must pass mutatedFormData because properties is stale (won't update
              // until next render after onChangeFormData dispatch above).
              const newBlockData = {
                '@type': blockType,
                [enterFieldName]: bottomValue,
              };
              insertAndSelectBlock(enterBlockId, blockType, 'after', null, {
                blockData: newBlockData,
                formatRequestId: enterRequestId,
                formData: mutatedFormData,
                blockPathMap: syncedBlockPathMap,
              });
            } catch (error) {
              console.error('[VIEW] Error handling enter transform:', error);
              event.source.postMessage(
                {
                  type: 'SLATE_ERROR',
                  blockId: event.data.blockId,
                  error: error.message,
                },
                event.origin,
              );
            }
          } else if (event.data.transformType === 'outdent') {
            // Check if this is a top-level list item — needs block splitting
            const { blockId: odBlockId, fieldName: odFieldName, selection: odSelection, requestId: odRequestId } = event.data;
            const odForm = event.data.data;
            const odBpm = buildBlockPathMap(odForm, config.blocks.blocksConfig, intl);
            const odBlockPath = odBpm[odBlockId]?.path;
            const odBlock = odBlockPath ? getBlockByPath(odForm, odBlockPath) : odForm.blocks[odBlockId];
            const odFieldValue = odBlock?.[odFieldName];
            log('[OUTDENT] selection:', JSON.stringify(odSelection), 'fieldValue:', JSON.stringify(odFieldValue));
            const split = odFieldValue ? slateTransforms.splitListAtItem(odFieldValue, odSelection) : null;
            log('[OUTDENT] split result:', split ? JSON.stringify({ before: !!split.before, paragraph: !!split.paragraph, after: !!split.after }) : 'null');

            if (!split) {
              // Nested outdent: forward to toolbar
              setIframeSyncState(prev => ({
                ...prev,
                formData: odForm,
                blockPathMap: odBpm,
                selection: odSelection || null,
                transformAction: { type: 'outdent', requestId: odRequestId },
              }));
            } else {
              // Top-level outdent: split list block into up to 3 blocks
              const containerConfig = getContainerFieldConfig(odBlockId, odBpm, odForm, config.blocks.blocksConfig, intl);
              const blockType = odBlock['@type'];

              // Update current block with before-list (or paragraph if no before)
              const updatedBlock = { ...odBlock, [odFieldName]: split.before || split.paragraph };
              let fd = mutateBlockInContainer(odForm, odBpm, odBlockId, updatedBlock, containerConfig);
              let bpm = buildBlockPathMap(fd, config.blocks.blocksConfig, intl);
              let selectBlockId = odBlockId;

              // Insert paragraph block after current (only if current kept the before-list)
              if (split.before) {
                const paraId = uuid();
                fd = insertBlockInContainer(fd, bpm, odBlockId, paraId,
                  { '@type': blockType, [odFieldName]: split.paragraph }, containerConfig, 'after');
                bpm = buildBlockPathMap(fd, config.blocks.blocksConfig, intl);
                selectBlockId = paraId;

                // Insert after-list block after the paragraph
                if (split.after) {
                  const afterId = uuid();
                  fd = insertBlockInContainer(fd, bpm, paraId, afterId,
                    { '@type': blockType, [odFieldName]: split.after }, containerConfig, 'after');
                  bpm = buildBlockPathMap(fd, config.blocks.blocksConfig, intl);
                }
              } else if (split.after) {
                // No before: current block IS paragraph, insert after-list after it
                const afterId = uuid();
                fd = insertBlockInContainer(fd, bpm, odBlockId, afterId,
                  { '@type': blockType, [odFieldName]: split.after }, containerConfig, 'after');
                bpm = buildBlockPathMap(fd, config.blocks.blocksConfig, intl);
              }

              // Set pending selection and blockPathMap, but NOT formData
              // formData will be updated by the useEffect after it sends FORM_DATA to iframe
              // This ensures the useEffect sees a content change and doesn't skip sending
              flushSync(() => {
                setIframeSyncState(prev => ({
                  ...prev,
                  blockPathMap: bpm,
                  pendingSelectBlockUid: selectBlockId,
                  ...(odRequestId ? { pendingFormatRequestId: odRequestId } : {}),
                }));
              });
              onChangeFormData(fd);
              dispatch(setSidebarTab(1));
            }
          } else if (event.data.transformType === 'unwrapBlock' && event.data.isFirstField && !event.data.isEmpty && (() => {
            // Check if block's root node is already a default paragraph — only then merge.
            // Non-default types (headings, lists) should go to toolbar for unwrap first.
            const checkBlock = event.data.data?.blocks?.[event.data.blockId];
            const checkValue = checkBlock?.[event.data.fieldName || 'value'];
            const defaultType = config.settings?.slate?.defaultBlockType || 'p';
            return Array.isArray(checkValue) && checkValue[0]?.type === defaultType;
          })()) {
            // Backspace at start of non-empty default paragraph — merge with previous block
            log('unwrapBlock merge handler reached for block:', event.data.blockId, 'fieldName:', event.data.fieldName);
            try {
              const { blockId: mergeBlockId, fieldName: mergeFieldName, requestId: mergeRequestId } = event.data;
              const mergeForm = event.data.data;
              const mergeBpm = buildBlockPathMap(mergeForm, config.blocks.blocksConfig, intl);
              const mergePathInfo = mergeBpm[mergeBlockId];

              // Find previous block in layout
              const mergeParentId = mergePathInfo?.parentId;
              const mergeRegion = mergePathInfo?.region || 'items';
              const mergeParent = mergeParentId === '_page' ? mergeForm : getBlockByPath(mergeForm, mergeBpm[mergeParentId]?.path);
              const mergeLayout = mergeParent?.blocks_layout?.[mergeRegion] || [];
              const mergeIdx = mergeLayout.indexOf(mergeBlockId);
              const prevBlockId = mergeIdx > 0 ? mergeLayout[mergeIdx - 1] : null;

              if (prevBlockId) {
                const prevPathInfo = mergeBpm[prevBlockId];
                const prevBlock = prevPathInfo?.path ? getBlockByPath(mergeForm, prevPathInfo.path) : mergeForm.blocks[prevBlockId];
                const currentBlock = mergePathInfo?.path ? getBlockByPath(mergeForm, mergePathInfo.path) : mergeForm.blocks[mergeBlockId];
                const fieldName = mergeFieldName || 'value';
                const prevValue = prevBlock?.[fieldName];
                const currentValue = currentBlock?.[fieldName];

                // Only merge single-text-field blocks (e.g. slate paragraphs).
                // Multi-field blocks (hero, teaser) should not merge.
                //
                // The iframe sends editableFieldsByBlock — derived from the
                // rendered DOM's data-edit-text/link/media attributes —
                // which is the authoritative "what fields are user-editable
                // in this block?" answer. Schema-introspection here would
                // over-count settings fields (placeholder, instructions,
                // fixed, etc.) that exist in the sidebar form but aren't
                // user content.
                const prevEditableFields = event.data.editableFieldsByBlock?.[prevBlockId] || [];
                const isSingleTextField = prevEditableFields.length === 1
                  && prevEditableFields[0].fieldName === fieldName
                  && prevEditableFields[0].type === 'slate';

                log('unwrapBlock merge check:', { prevBlockId, prevType: prevBlock?.['@type'], fieldName, isSingleTextField, prevEditableFields, hasPrevValue: Array.isArray(prevValue), hasCurrentValue: Array.isArray(currentValue) });

                if (isSingleTextField && Array.isArray(prevValue) && Array.isArray(currentValue)) {
                  log('unwrapBlock merge: merging', mergeBlockId, 'into', prevBlockId);

                  const { Transforms, Editor } = require('slate');
                  const { slate: slateConfig } = config.settings;
                  // Merge using a headless Slate editor — handles all cases
                  // (p into p, p into list, heading into p, etc.) and normalizes
                  // the result (merges adjacent text nodes, ensures inline spacing).
                  const allNodes = [...prevValue, ...currentValue];
                  const mergeEditor = slateTransforms.createHeadlessEditor(allNodes);
                  const joinIdx = prevValue.length;
                  Transforms.select(mergeEditor, Editor.start(mergeEditor, [joinIdx]));
                  Editor.deleteBackward(mergeEditor, { unit: 'character' });
                  const mergedValue = JSON.parse(JSON.stringify(mergeEditor.children));
                  const cursorSelection = mergeEditor.selection;
                  log('unwrapBlock merge: joinIdx:', joinIdx, 'result nodes:', mergedValue.length, 'selection:', JSON.stringify(cursorSelection));
                  const updatedPrev = { ...prevBlock, [fieldName]: mergedValue };

                  // Merge + delete in one atomic form data update using iframe's form data
                  // (includes latest typed text from buffer)
                  const mergeBpmForDelete = buildBlockPathMap(mergeForm, config.blocks.blocksConfig, intl);
                  let newFormData = updateBlockById(mergeForm, mergeBpmForDelete, prevBlockId, updatedPrev);
                  // Remove the merged block from blocks and layout
                  newFormData = {
                    ...newFormData,
                    blocks: Object.fromEntries(
                      Object.entries(newFormData.blocks || {}).filter(([id]) => id !== mergeBlockId)
                    ),
                    blocks_layout: {
                      ...newFormData.blocks_layout,
                      items: (newFormData.blocks_layout?.items || []).filter(id => id !== mergeBlockId),
                    },
                  };

                  // After merge+delete, check if the next block is a list of the
                  // same type as the previous block — if so, merge it in.
                  // Lists are containers: two adjacent ul blocks are one split list.
                  const prevRootType = mergedValue[0]?.type;
                  if (prevRootType && slateConfig?.listTypes?.includes(prevRootType)) {
                    const postLayout = newFormData.blocks_layout?.items || [];
                    const prevIdx = postLayout.indexOf(prevBlockId);
                    const nextBlockId = prevIdx >= 0 ? postLayout[prevIdx + 1] : null;
                    if (nextBlockId) {
                      const nextBpm = buildBlockPathMap(newFormData, config.blocks.blocksConfig, intl);
                      const nextBlock = getBlockById(newFormData, nextBpm, nextBlockId);
                      const nextValue = nextBlock?.[fieldName];
                      if (Array.isArray(nextValue) && nextValue.length === 1
                        && nextValue[0]?.type === prevRootType) {
                        log('unwrapBlock: merging adjacent list block', nextBlockId);
                        const adjEditor = slateTransforms.createHeadlessEditor([...mergedValue, ...nextValue]);
                        Transforms.mergeNodes(adjEditor, { at: [mergedValue.length] });
                        const combined = JSON.parse(JSON.stringify(adjEditor.children));
                        newFormData = updateBlockById(newFormData, nextBpm, prevBlockId, { ...updatedPrev, [fieldName]: combined });
                        // The one raw delete left, and deliberately raw: this
                        // MERGES the next block's content into the previous one
                        // and drops the empty shell. The region cannot be
                        // emptied by it — the block that absorbed the content is
                        // still there — so there is nothing for settle to settle.
                        newFormData = deleteBlockFromContainer(newFormData, nextBpm, nextBlockId,
                          getContainerFieldConfig(nextBlockId, nextBpm, newFormData, config.blocks.blocksConfig, intl));
                      }
                    }
                  }

                  // Set pending state synchronously so the FORM_DATA effect sees it
                  flushSync(() => {
                    setIframeSyncState(prev => ({
                      ...prev,
                      selection: cursorSelection,
                      pendingSelectBlockUid: prevBlockId,
                      pendingFormatRequestId: mergeRequestId,
                      pendingTransformedSelection: cursorSelection,
                    }));
                  });
                  onChangeFormData(newFormData);
                }
              }
            } catch (error) {
              console.error('[VIEW] Error handling unwrapBlock merge:', error);
              event.source.postMessage(
                { type: 'SLATE_ERROR', blockId: event.data.blockId, error: error.message },
                event.origin,
              );
            }
          } else {
            // Format, paste, delete, indent - let toolbar handle via transformAction
            // Build transformAction based on transformType
            const transformAction = {
              type: event.data.transformType,
              requestId: event.data.requestId,
            };
            log('SLATE_TRANSFORM_REQUEST requestId:', event.data.requestId, 'data third child text:', JSON.stringify(event.data.data?.blocks?.[Object.keys(event.data.data?.blocks || {})[0]]?.value?.[0]?.children?.[2]?.text));
            // Add type-specific fields
            if (event.data.transformType === 'format') {
              transformAction.format = event.data.format;
            } else if (event.data.transformType === 'paste') {
              transformAction.html = event.data.html;
            } else if (event.data.transformType === 'delete') {
              transformAction.direction = event.data.direction;
            } else if (event.data.transformType === 'markdown') {
              transformAction.markdownType = event.data.markdownType;
              transformAction.blockType = event.data.blockType;
              transformAction.inlineType = event.data.inlineType;
            } else if (event.data.transformType === 'unwrapBlock') {
              transformAction.isFirstField = event.data.isFirstField;
              transformAction.isEmpty = event.data.isEmpty;
            }

            const bpmT0 = performance.now();
            const transformBpm = buildBlockPathMap(event.data.data, config.blocks.blocksConfig, intl);
            console.log('[VIEW-TIMING] buildBlockPathMap: ' + (performance.now() - bpmT0).toFixed(0) + 'ms, keys:', Object.keys(transformBpm).length);
            setIframeSyncState(prev => ({
              ...prev,
              formData: event.data.data,
              blockPathMap: transformBpm,
              selection: event.data.selection || null,
              _selectionSource: 'SLATE_TRANSFORM_REQUEST',
              transformAction: transformAction,
            }));
            console.log('[VIEW-TIMING] setIframeSyncState done +' + (performance.now() - (window._formatT0 || 0)).toFixed(0) + 'ms');
          }
          break;

        case 'SLATE_UNDO_REQUEST': {
          // Dispatch a synthetic Ctrl+Z event to trigger Volto's global undo manager
          const undoEvent = new KeyboardEvent('keydown', {
            key: 'z',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          });
          document.dispatchEvent(undoEvent);
          break;
        }

        case 'SLATE_REDO_REQUEST': {
          // Dispatch a synthetic Ctrl+Y event to trigger Volto's global undo manager
          const redoEvent = new KeyboardEvent('keydown', {
            key: 'y',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          });
          document.dispatchEvent(redoEvent);
          break;
        }

        case 'SAVE_REQUEST': {
          // Dispatch a synthetic Ctrl+S event to trigger Form.jsx save handler
          const saveEvent = new KeyboardEvent('keydown', {
            key: 's',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          });
          document.dispatchEvent(saveEvent);
          break;
        }

        case 'ACTION_REQUEST': {
          // Generic action handler for custom operations like delete row/column
          const { action, blockId: actionBlockId } = event.data;
          const pathInfo = iframeSyncState.blockPathMap?.[actionBlockId];

          if (action === 'deleteColumn' && pathInfo?.parentAddMode === 'table') {
            // Delete column: remove cell at same index from ALL rows
            const newFormData = deleteTableColumn(properties, iframeSyncState.blockPathMap, actionBlockId);
            if (newFormData) {
              onChangeFormData(newFormData);
              // Select the parent row after column deletion
              if (pathInfo.parentId) {
                flushSync(() => {
                  setIframeSyncState((prev) => ({
                    ...prev,
                    pendingSelectBlockUid: pathInfo.parentId,
                  }));
                });
              }
            }
          } else if (action === 'deleteRow' && pathInfo?.addMode === 'table') {
            // Delete row: use standard block deletion
            const containerConfig = getContainerFieldConfig(actionBlockId, iframeSyncState.blockPathMap, properties, blocksConfig, intl);
            // A row delete is a delete: deleteBlocks removes it and settles what
            // that disturbed (re-seeding the table if it took the last row),
            // and brings the lock backstop with it — a row of locked template
            // chrome is not the author's to remove from a page.
            const { formData: newFormData, deleted: deletedRows } = deleteBlocks(
              properties,
              iframeSyncState.blockPathMap,
              [actionBlockId],
              { blocksConfig, intl, uuidGenerator: uuid, templateEditMode: iframeSyncState.templateEditMode, metadata },
            );
            if (deletedRows.length > 0) {
              onChangeFormData(newFormData);
              // Select the parent table after row deletion
              if (pathInfo.parentId) {
                flushSync(() => {
                  setIframeSyncState((prev) => ({
                    ...prev,
                    pendingSelectBlockUid: pathInfo.parentId,
                  }));
                });
              }
            }
          }
          break;
        }

        case 'UPDATE_BLOCKS_LAYOUT':
          // Validate data from postMessage before using it
          validateAndLog(event.data.data, 'UPDATE_BLOCKS_LAYOUT', blockFieldTypes);
          onChangeFormData(event.data.data);
          break;

        case 'MOVE_BLOCKS': {
          // Handle drag-and-drop block moves (single or multi, supports containers)
          // replaceTargetId is set when the drop landed on an 'empty' placeholder
          // (the slot block ensureEmptyBlockIfEmpty creates when a container is
          // empty). After the move, that placeholder is removed so the dropped
          // block lives where the placeholder was instead of beside it.
          const { blockIds: moveBlockIds, targetBlockId, insertAfter, targetParentId, selectAfterMove, replaceTargetId } = event.data;
          log('MOVE_BLOCKS: received:', moveBlockIds?.length, 'blocks to', targetBlockId, 'insertAfter:', insertAfter, 'replaceTargetId:', replaceTargetId);

          // Use properties (Redux) as source of truth for moves
          const currentFormData = properties;
          const currentBlockPathMap = buildBlockPathMap(currentFormData, config.blocks.blocksConfig, intl);

          // Expand template instances: each template instance drags all its child blocks
          const blocksToMove = [];
          for (const bid of (moveBlockIds || [])) {
            if (currentBlockPathMap[bid]?.isTemplateInstance) {
              const parentId = currentBlockPathMap[bid]?.parentId || 'page';
              const parentBlock = parentId === 'page' ? currentFormData : getBlockById(currentFormData, currentBlockPathMap, parentId);
              const region = currentBlockPathMap[bid]?.region || 'items';
              const layoutItems = parentBlock?.blocks_layout?.[region] || [];
              const childBlocks = layoutItems.filter(id => currentBlockPathMap[id]?.parentId === bid);
              log('MOVE_BLOCKS: template instance', bid, '- expanding to:', childBlocks);
              blocksToMove.push(...childBlocks);
            } else {
              blocksToMove.push(bid);
            }
          }

          // Derive sourceParentId from first block's pathMap entry
          const firstBlockId = blocksToMove[0];
          const sourceParentId = currentBlockPathMap[firstBlockId]?.parentId || null;

          // Get source container config BEFORE the move (needed for ensureEmptyBlockIfEmpty)
          const sourceContainerConfig = sourceParentId !== targetParentId && sourceParentId
            ? getContainerFieldConfig(firstBlockId, currentBlockPathMap, currentFormData, blocksConfig, intl)
            : null;

          // Resolve each block against the target container's allowedBlocks:
          // native fit, or convertible (auto when one target type; a single-block
          // drag with several options opens the chooser — ask-first). A block that
          // can't be placed rejects the whole move. Multi-block is auto-only.
          const targetContainerCfg = getContainerFieldConfig(targetBlockId, currentBlockPathMap, currentFormData, blocksConfig, intl);
          const targetAllowedTypes = targetContainerCfg?.allowedBlocks;
          const dropConversions = {}; // bid -> type to convert to before moving
          const membershipConversions = []; // {blockId, from, to} — surfaced in the confirm
          let rejectMove = false;
          let deferredToChooser = false;
          if (targetAllowedTypes?.length > 0) {
            const singleDrag = blocksToMove.length === 1;
            for (const bid of blocksToMove) {
              const bType = getBlockById(currentFormData, currentBlockPathMap, bid)?.['@type'];
              if (targetAllowedTypes.includes(bType)) continue; // native fit
              const options = getConvertibleTypes(bType, blocksConfig, targetAllowedTypes).map((t) => t.type);
              if (options.length === 1) {
                dropConversions[bid] = options[0]; // single target → convert to fit
                membershipConversions.push({ blockId: bid, from: bType, to: options[0] });
                continue;
              }
              if (options.length > 1 && singleDrag) {
                // Ask-first: show the chooser; commitChooser converts + moves atomically.
                setChooser({
                  kind: 'convert',
                  blockId: bid,
                  allowedBlocks: options,
                  pendingMove: { targetBlockId, insertAfter, targetParentId, replaceTargetId },
                });
                deferredToChooser = true;
                break;
              }
              // 0 options, or a multi-option member of a multi-block batch → can't place.
              log('MOVE_BLOCKS: blocked — type not allowed/convertible in target container');
              rejectMove = true;
              break;
            }
          }
          if (rejectMove || deferredToChooser) break;

          // Move all blocks in sequence, each one after the previous
          // Track insertAfter for each block (needed for template inheritance)
          let newFormData = currentFormData;
          // Auto-convert (single-option) blocks BEFORE moving so each already
          // fits the target container's allowedBlocks.
          for (const [bid, toType] of Object.entries(dropConversions)) {
            const cbpm = buildBlockPathMap(newFormData, config.blocks.blocksConfig, intl);
            newFormData = convertBlockInPlace(newFormData, cbpm, bid, toType);
          }
          let currentTarget = targetBlockId;
          let currentInsertAfter = insertAfter;
          const blockInsertAfterMap = {};

          for (let i = 0; i < blocksToMove.length; i++) {
            const moveBlockId = blocksToMove[i];
            blockInsertAfterMap[moveBlockId] = currentInsertAfter;
            const updatedPathMap = buildBlockPathMap(newFormData, config.blocks.blocksConfig, intl);

            newFormData = moveBlockBetweenContainers(
              newFormData,
              updatedPathMap,
              moveBlockId,
              currentTarget,
              currentInsertAfter,
              sourceParentId,
              targetParentId,
              blocksConfig,
              intl,
            );

            if (!newFormData) {
              log('MOVE_BLOCKS: moveBlockBetweenContainers failed for:', moveBlockId);
              break;
            }

            // After first block, subsequent blocks go after the previous one
            currentTarget = moveBlockId;
            currentInsertAfter = true;
          }
          log('MOVE_BLOCKS: moveBlockBetweenContainers returned:', newFormData ? 'formData' : 'null');

          if (newFormData) {
            // Everything a move owes afterwards, in the order it owes it:
            // membership for what landed, THEN the placeholder it landed on,
            // THEN a re-seed of the region it came out of. settleBlockStructure
            // fixes that order in one place so the drag path and the chooser's
            // ask-first drop cannot disagree about it again.
            const settledMove = settleBlockStructure(
              newFormData,
              buildBlockPathMap(newFormData, config.blocks.blocksConfig, intl),
              {
                landed: blocksToMove,
                replacedPlaceholders: replaceTargetId ? [replaceTargetId] : [],
                emptiedContainers:
                  sourceParentId !== targetParentId && sourceContainerConfig
                    ? [sourceContainerConfig]
                    : [],
              },
              {
                blocksConfig,
                intl,
                uuidGenerator: uuid,
                templateEditMode: templateEditModeRef.current,
                metadata,
                insertAfterById: blockInsertAfterMap,
              },
            );
            newFormData = settledMove.formData;

            // Commit + keep the moved block selected. Rebuild the pathMap for the
            // new positions and flushSync so state is committed before the Redux
            // update triggers the useEffect. Do NOT set formData here — the
            // useEffect sends FORM_DATA. selectAfterMove pins selection on a
            // specific block (edge-drag stays on the container); default = the
            // first moved block (legacy DnD behaviour).
            const selectUid = selectAfterMove || blocksToMove[0];
            const commitMove = (fd) => {
              const newBlockPathMap = buildBlockPathMap(fd, config.blocks.blocksConfig, intl);
              flushSync(() => {
                setIframeSyncState(prev => ({
                  ...prev,
                  blockPathMap: newBlockPathMap,
                  pendingSelectBlockUid: selectUid,
                }));
              });
              onChangeFormData(fd);
            };

            // Trial the drop before committing: normalise the candidate (applies
            // field defaults AND `@type` rules via the container⇄value bridge) and
            // diff the @types. If ANY block converted — for any reason, any rule —
            // confirm first. `membershipConversions` (single-target drops converted
            // to fit the container above) are surfaced in the same confirm. Nothing
            // converted → commit the raw move unchanged (no behaviour change).
            const trialBpm = buildBlockPathMap(newFormData, config.blocks.blocksConfig, intl);
            const { formData: normalizedFd, conversions: ruleConversions } =
              previewSchemaDefaultConversions(newFormData, trialBpm, blocksConfig, intl);
            const allConversions = [...membershipConversions, ...ruleConversions];
            if (allConversions.length > 0) {
              setConvertConfirm({
                conversions: allConversions,
                onConfirm: () => commitMove(normalizedFd),
              });
            } else {
              commitMove(newFormData);
            }
          }
          break;
        }

        case 'SELECTION_CHANGE':
          // Selection-only update (no text change) — safe because data is already in sync
          // Sent by hydra.js when selectionchange fires but text is unchanged (e.g., Ctrl+A, Shift+Arrow)
          setIframeSyncState(prev => {
            const newSelection = event.data.selection || null;
            if (JSON.stringify(prev.selection) === JSON.stringify(newSelection)) {
              return prev;
            }
            return { ...prev, selection: newSelection };
          });
          break;

        case 'BLOCK_SELECTED': {
          // Back to the page being edited when the editor is WORKING IN it. A
          // selection announced while the other pane holds focus is this page
          // re-announcing itself on a re-render, and must not snatch the
          // sidebar back. Focus is ASKED for: moving between two frames fires
          // no event in this document.
          if (
            typeof document === 'undefined' ||
            document.activeElement?.id !== 'translationSourceIframe'
          ) {
            setSelectedPane('edit');
          }
          // Update block UI state and selection atomically
          // Selection is included in BLOCK_SELECTED to prevent race conditions

          // Determine if this is a new block BEFORE setBlockUI to avoid nested state updates
          // Calling onSelectBlock (which dispatches Redux action) inside setBlockUI callback
          // causes React's "Cannot update during an existing state transition" warning
          //
          // IMPORTANT: Position updates from scroll/resize handlers should NEVER trigger
          // onSelectBlock - they're just updating the rect, not changing selection.
          // This prevents the scroll-back bug where scrolling away from a block causes
          // it to be "re-selected" and scrolled back into view.
          const isPositionUpdateOnly = event.data.src === 'scrollHandler' ||
                                        event.data.src === 'resizeHandler';
          // Reject BLOCK_SELECTED with zero rect only for position updates of the SAME block
          // (this happens when block element is detached during frontend re-render)
          // For NEW block selection, allow zero rect - the block may be empty but we still need to select it
          const hasZeroRect = event.data.blockUid && (event.data.rect?.width === 0 || event.data.rect?.height === 0);
          const isSameBlock = selectedBlock === event.data.blockUid;
          if (hasZeroRect && isSameBlock) {
            log('[VIEW] Ignoring BLOCK_SELECTED with zero rect (element detached):', event.data.src);
            return;
          }
          // Only check selectedBlock - blockUI can be stale due to React's async state updates
          // When multiple BLOCK_SELECTED messages arrive rapidly (e.g., sidebar click + Escape),
          // blockUI may not have updated yet, causing onSelectBlock to be skipped incorrectly
          const isNewBlock = !isPositionUpdateOnly &&
                             selectedBlock !== event.data.blockUid;

          // Clear any pending selection - BLOCK_SELECTED from hydra.js is authoritative
          // The hydra.js domChange observer already checks blockUid === selectedBlockUid
          // before sending, so we don't need to filter here
          const pendingUid = iframeSyncState?.pendingSelectBlockUid;
          if (pendingUid) {
            log('BLOCK_SELECTED clearing pendingSelectBlockUid:', pendingUid);
            setIframeSyncState(prev => ({ ...prev, pendingSelectBlockUid: null }));
          }

          log('BLOCK_SELECTED received:', event.data.blockUid, 'src:', event.data.src, 'rect:', event.data.rect, 'isNewBlock:', isNewBlock, 'currentBlockUI:', blockUI?.blockUid, 'currentSelectedBlock:', selectedBlock);
          log(' BLOCK_SELECTED received:', event.data.blockUid, 'src:', event.data.src, 'rect:', event.data.rect);

          // Update lastSentSelectBlockRef to match iframe's selection
          // This is critical: when iframe confirms a selection, our ref must match
          // Otherwise, if we later try to select the same block the iframe already has,
          // we'll skip sending SELECT_BLOCK (thinking it's a duplicate) but the iframe
          // may have moved to a different selection in the meantime
          lastSentSelectBlockRef.current = event.data.blockUid;

          // --- Multi-block selection: set state and break (nothing else applies) ---
          if (event.data.isMultipleSelection) {
            const blockUids = event.data.blockUids || [];
            log('BLOCK_SELECTED multi-select:', blockUids.length, 'blocks');
            if (onSetMultiSelected) onSetMultiSelected(blockUids);
            setBlockUI({
              blockUid: blockUids[0],
              rect: event.data.rect,
              // Where a stand-in for this block sits (a tab's label on its trigger), so
              // chrome can be placed clear of a field the author needs to click.
              standInRect: event.data.standInRect,
              focusedFieldName: null,
              addDirection: 'bottom',
              editableFields: {},
              multiSelectedUids: blockUids,
              multiSelectRects: event.data.rects || {},
            });
            break;
          }

          // --- Single-block selection from here on ---
          // Clear multiSelected unless we're in selection mode (preserve
          // during navigation). Skip the clear for position-only updates
          // (scroll/resize) — those aren't real selection changes and
          // would otherwise wipe a multi-select that was just initiated
          // from the sidebar before selectionMode flips to true.
          if (onSetMultiSelected && !selectionMode && !isPositionUpdateOnly) {
            onSetMultiSelected([]);
          }
          if (isNewBlock) {
            log('BLOCK_SELECTED calling onSelectBlock:', event.data.blockUid);
            onSelectBlock(event.data.blockUid);
          }

          // Deselection: just call onSelectBlock(null) — skip blockUI/addability updates.
          // The selectedBlock useEffect will set blockUI to null.
          // Without this early return, setBlockUI({ blockUid: null }) creates a truthy
          // object that causes a brief intermediate render where the sidebar checks
          // blockUI (truthy) and renders block-level UI instead of page-level UI.
          if (!event.data.blockUid) {
            setBlockUI(null);
            break;
          }

          // NOTE: selecting an empty block must NOT open the block chooser. BLOCK_SELECTED fires
          // for every selection — click, keyboard nav, escape-to-parent, sidebar, and the admin's
          // own pendingSelectBlockUid after an insert or after a delete seeds a replacement empty.
          // An empty block gets a '+' (getBlockAddability: canReplace), and clicking THAT opens
          // the chooser via handleIframeAdd. That is the convert gesture.

          // Now update blockUI state
          log(' About to call setBlockUI for:', event.data.blockUid);
          setBlockUI((prevBlockUI) => {
            // Skip update if nothing changed - prevents unnecessary toolbar redraws
            // IMPORTANT: Must compare mediaFields because they can change independently
            // (e.g., when an image is cleared, the placeholder div has different dimensions)
            const mediaFieldsChanged = JSON.stringify(prevBlockUI?.mediaFields) !== JSON.stringify(event.data.mediaFields);
            if (prevBlockUI &&
                prevBlockUI.blockUid === event.data.blockUid &&
                prevBlockUI.focusedFieldName === event.data.focusedFieldName &&
                prevBlockUI.focusedLinkableField === event.data.focusedLinkableField &&
                prevBlockUI.focusedMediaField === event.data.focusedMediaField &&
                prevBlockUI.addDirection === event.data.addDirection &&
                prevBlockUI.revealed === event.data.revealed &&
                JSON.stringify(prevBlockUI.revealableFields) === JSON.stringify(event.data.revealableFields) &&
                prevBlockUI.rect?.top === event.data.rect?.top &&
                prevBlockUI.rect?.left === event.data.rect?.left &&
                prevBlockUI.rect?.width === event.data.rect?.width &&
                prevBlockUI.rect?.height === event.data.rect?.height &&
                !mediaFieldsChanged) {
              // focusedFieldRect intentionally excluded — it changes during typing
              // (field height shifts) and re-renders from that cause perf issues.
              // The underline updates when other fields trigger a state change.
              return prevBlockUI; // Return same reference to skip re-render
            }
            // Note: Zero rect check happens earlier (before onSelectBlock) so we return before reaching here

            // Assert required fields - fail loudly if BLOCK_SELECTED is missing data
            // Only check when selecting a block (blockUid not null) - deselection doesn't need these
            if (event.data.blockUid && !event.data.addDirection) {
              console.error('[VIEW] BLOCK_SELECTED missing addDirection! src:', event.data.src, 'blockUid:', event.data.blockUid);
              throw new Error(`BLOCK_SELECTED missing addDirection (src: ${event.data.src})`);
            }
            // editableFields can be empty {} (block has no editable fields) but must be present
            if (event.data.blockUid && event.data.editableFields === undefined) {
              console.error('[VIEW] BLOCK_SELECTED missing editableFields! src:', event.data.src, 'blockUid:', event.data.blockUid);
              throw new Error(`BLOCK_SELECTED missing editableFields (src: ${event.data.src})`);
            }

            return {
              blockUid: event.data.blockUid,
              rect: event.data.rect,
              // Where a stand-in for this block sits (a tab's label on its trigger), so
              // chrome can be placed clear of a field the author needs to click.
              standInRect: event.data.standInRect,
              // The block's content lives in a nested browsing context (video,
              // map, PDF preview). Its mouse events are the embed's, not ours,
              // so the toolbar must not fade waiting for activity that cannot
              // arrive — see SyncedSlateToolbar.
              hasEmbed: event.data.hasEmbed,
              focusedFieldName: event.data.focusedFieldName, // Track which editable field is focused
              focusedFieldRect: event.data.focusedFieldRect, // Rect of focused field for underline positioning
              focusedLinkableField: event.data.focusedLinkableField, // Track which linkable field is focused
              focusedMediaField: event.data.focusedMediaField, // Track which media field is focused
              editableFields: event.data.editableFields, // Map of fieldName -> fieldType from iframe
              linkableFields: event.data.linkableFields, // Map of fieldName -> true for link fields
              mediaFields: event.data.mediaFields, // Map of fieldName -> true for image/media fields
              // Reveal (#296): empty inline-editable fields the quanta toolbar can
              // offer to reveal, and whether they currently are.
              revealableFields: event.data.revealableFields, // string[] of field names
              revealed: event.data.revealed, // are they currently revealed
              addDirection: event.data.addDirection, // Direction for add button positioning
              isMultiElement: event.data.isMultiElement, // True if block renders as multiple DOM elements
              canResize: event.data.canResize || null, // {top,bottom,left,right} booleans for edge-drag chrome
              // Chevron move targets computed by hydra.js from render geometry.
              // null => that chevron is disabled; otherwise the MOVE_BLOCKS target.
              moveUpTarget: event.data.moveUpTarget || null,
              moveDownTarget: event.data.moveDownTarget || null,
              selectionModeRects: event.data.selectionModeRects,
            };
          });
          // Set selection from BLOCK_SELECTED - this ensures block and selection are atomic
          // Only update selection if EXPLICITLY provided in the message
          // Position-only updates (rect changes) don't include selection - preserve existing
          if (event.data.selection !== undefined) {
            setIframeSyncState(prev => {
              const newSelection = event.data.selection || null;
              if (JSON.stringify(prev.selection) === JSON.stringify(newSelection)) {
                return prev; // Skip re-render if selection unchanged
              }
              return { ...prev, selection: newSelection };
            });
          }
          break;
        }

        case 'HIDE_BLOCK_UI':
          // Hide block UI overlays temporarily (during scroll/resize)
          // Don't deselect the block - just hide the visual overlays
          // The block will be re-shown when BLOCK_SELECTED is sent after scroll stops
          setBlockUI(null);
          // Don't call onSelectBlock(null) - keep the block selected in Redux
          break;

        case 'MOUSE_ACTIVITY':
          // Throttled mousemove from iframe — reset toolbar fade timer
          setMouseActivityCounter(c => c + 1);
          break;

        case 'INIT': {
          // Combined initialization: merge config first, then send data
          // This ensures blockPathMap is built with complete schema knowledge
          iframeOriginRef.current = event.origin;

          // Check if iframe navigated to a different page (e.g., user clicked nav link)
          // User confirmed beforeunload warning, so they're leaving edit mode
          if (event.data.currentPath) {
            // Strip the iframe's base path prefix from the reported path
            // e.g., iframe at /edit/about → content path /about
            const iframeBasePath = u ? new URL(u).pathname.replace(/\/$/, '') : '';
            let contentPath = event.data.currentPath;
            if (iframeBasePath && contentPath.startsWith(iframeBasePath)) {
              contentPath = contentPath.slice(iframeBasePath.length) || '/';
            }
            const adminPath = history.location.pathname.replace(/\/edit$/, '') || '/';
            if (contentPath !== adminPath) {
              log('INIT: iframe navigated to different page, following to view mode:', contentPath, '(raw:', event.data.currentPath, ', base:', iframeBasePath, ')');
              // Update persistedIframe BEFORE history.push so useEffect won't reload iframe
              persistedIframe = { frontendUrl: u, path: contentPath, isEdit: false };
              history.push(contentPath);
              return; // Don't send INITIAL_DATA - admin will re-render with new page
            }
          }

          // 1. Merge custom block definitions from event.data.blocks
          const blocksConfig = event.data.blocks;
          if (blocksConfig) {
            // Inject NoPreview view for frontend blocks that don't have one
            // Also ensure blockSchema has fieldsets if properties exist (for new blocks only)
            Object.keys(blocksConfig).forEach((blockType) => {
              const blockConfig = blocksConfig[blockType];
              if (!blockConfig) return;
              // Ensure id matches the key
              if (!blockConfig.id) {
                blockConfig.id = blockType;
              }
              // Default title from the key name (e.g. 'single_choice' -> 'Single Choice')
              if (!blockConfig.title) {
                blockConfig.title = blockType.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              }
              if (!blockConfig.view) {
                blockConfig.view = NoPreview;
              }
              // Default group to 'common' so blocks appear in the block chooser
              if (!blockConfig.group) {
                blockConfig.group = 'common';
              }
              // Show sidebar settings tab when block has a schema
              if (blockConfig.blockSchema && blockConfig.sidebarTab === undefined) {
                blockConfig.sidebarTab = 1;
              }
              // A frontend that declares a block's schema is AUTHORITATIVE for
              // it: it is the thing that renders, so it decides what can be set.
              // Without this the admin's own Edit component keeps rendering the
              // sidebar (ToC/Edit.jsx imports its schema directly and hands it
              // to BlockDataForm), so an override was silently ignored for every
              // type Volto already knows — our ToC offered core's `hide_title`
              // and `ordered` beside the one field the frontend declared, and
              // the frontend implemented neither. Settings the site cannot
              // honour, with nothing able to catch it.
              //
              // Reuses the existing per-block opt-out rather than adding a
              // mechanism: `disableCustomSidebarEditForm` already routes a block
              // to the schema-driven BlockDataForm (see ParentBlocksWidget's
              // `useSchemaOnly`). Declaring a schema simply defaults it on.
              //
              // A frontend can still opt back in per block by sending
              // `disableCustomSidebarEditForm: false` — for a block whose admin
              // Edit does something a JSON schema cannot express.
              //
              // `slate` is exempt: hydra's own slate schema carries the `value`
              // field that block-sync and the shadowed text editor depend on,
              // which no frontend can know to send (see index.js).
              //
              // `title` and `description` are exempt for a different reason:
              // they are not blocks with data, they are windows onto the PAGE's
              // own fields, and the page metadata form already edits those. A
              // schema-driven block form for them renders a second, always-empty
              // `#field-title` beside the metadata form's — a duplicate DOM id,
              // and an input whose writes land in block data nothing reads.
              // Their schema still stands: it is where the canvas placeholder
              // ("Type the title…") comes from.
              if (
                blockConfig.blockSchema &&
                !SCHEMA_KEEPS_ADMIN_FORM.has(blockType) &&
                blockConfig.disableCustomSidebarEditForm === undefined
              ) {
                blockConfig.disableCustomSidebarEditForm = true;
              }
              // Auto-generate default fieldset if missing (only for new blocks, not overrides)
              // Also ensure required is an array (Volto expects this)
              // Recurse into object_list inner schemas too (Volto's InlineForm needs fieldsets).
              const schema = blockConfig?.blockSchema;
              const isNewBlock = !config.blocks.blocksConfig[blockType];
              if (isNewBlock && schema?.properties && !schema.fieldsets) {
                schema.fieldsets = [{
                  id: 'default',
                  title: 'Default',
                  fields: Object.keys(schema.properties),
                }];
              }
              if (schema && !schema.required) {
                schema.required = [];
              }
              // Auto-generate fieldsets on nested object_list inner schemas
              if (schema?.properties) {
                Object.values(schema.properties).forEach((prop) => {
                  if (prop?.widget === 'object_list' && prop?.schema?.properties && !prop.schema.fieldsets) {
                    prop.schema.fieldsets = [{
                      id: 'default',
                      title: 'Default',
                      fields: Object.keys(prop.schema.properties),
                    }];
                  }
                  if (prop?.widget === 'object_list' && prop?.schema && !prop.schema.required) {
                    prop.schema.required = [];
                  }
                });
              }
              // Validate fieldMappings: warn about invalid @default keys
              validateFieldMappings(blockType, blockConfig);
            });
            // Save existing function-type schemaEnhancers before deepMerge overwrites them.
            // When the frontend sends a recipe object for a block that already has a function
            // enhancer (e.g., listing's fieldMapping/b_size logic from our plugin), deepMerge
            // would corrupt the function. We chain them back in step 1b.
            const savedEnhancers = {};
            for (const blockType of Object.keys(blocksConfig)) {
              const existing = config.blocks.blocksConfig[blockType]?.schemaEnhancer;
              if (typeof existing === 'function') {
                savedEnhancers[blockType] = existing;
              }
            }
            recurseUpdateVoltoConfig({ blocks: { blocksConfig } });

            // Variations follow the schema. They are a SECOND registry the admin
            // fills in (core attaches ToCVariations, ListingVariations, … in
            // Blocks.jsx), so a frontend that replaced a block's schema still had
            // the admin's `variation` picker sitting on top of it — offering
            // renderings the frontend does not have. Same defect as the fields,
            // one registry over: the author picks and nothing changes.
            //
            // So a frontend that declares a schema owns the variations too. Send
            // them and they are used; send none and the block has none.
            for (const [blockType, blockDef] of Object.entries(blocksConfig)) {
              if (!blockDef?.blockSchema || blockType === 'slate') continue;
              if (blockDef.variations) continue; // the frontend declared its own
              const target = config.blocks.blocksConfig[blockType];
              // EMPTIED, not deleted. Admin code reads this key without
              // guarding it (the listing/search item-type and facet paths walk
              // `variations` to resolve a renderer), so removing it threw and
              // took the whole preview down with it: 18 admin tests timed out
              // waiting for any block to appear in the iframe, all of them on
              // the listing/facet paths. An empty list means "this block has no
              // variations", which is the intent, and every `.find`/`.map` on it
              // still answers.
              if (target?.variations) target.variations = [];
            }

            // 1b. Create schemaEnhancers from frontend recipes
            // When the frontend sends a recipe (e.g., { inheritSchemaFrom: {...} }),
            // chain it with any existing function enhancer from admin plugins (e.g., listing's
            // fieldMapping/b_size removal) rather than replacing it.
            const recipeKeys = ['inheritSchemaFrom', 'fieldRules'];
            for (const [blockType, blockConfig] of Object.entries(blocksConfig)) {
              const recipe = blockConfig.schemaEnhancer;
              // Check if it's a recipe (has known enhancer keys, type property, or is array)
              const isRecipe =
                recipe &&
                typeof recipe === 'object' &&
                (recipe.type || // legacy format
                  Array.isArray(recipe) || // array of recipes
                  recipeKeys.some((key) => key in recipe)); // new format
              if (isRecipe) {
                // Pass savedEnhancer so createSchemaEnhancerFromRecipe can detect
                // overlapping enhancerTypes (via .config.enhancerType) and skip
                // duplicates while preserving the admin's extra logic.
                const enhancer = createSchemaEnhancerFromRecipe(
                  recipe, savedEnhancers[blockType],
                );
                if (enhancer) {
                  config.blocks.blocksConfig[blockType].schemaEnhancer = enhancer;
                } else {
                  // Remove invalid recipe to prevent Volto from trying to use it
                  delete config.blocks.blocksConfig[blockType].schemaEnhancer;
                }
              }
            }
          }

          // 1c. Merge any additional voltoConfig (non-block settings)
          if (event.data.voltoConfig) {
            recurseUpdateVoltoConfig(event.data.voltoConfig);
            // A design-system style is a FRONTEND class. On the canvas that is
            // fine — the canvas is the frontend. But slate is also edited in the
            // sidebar, which renders inside Volto, where the site's stylesheet
            // does not exist: volto-slate applies the class there and it
            // resolves to nothing, so picking "Lead" changes nothing visible.
            // Label them from what the menu already declares. Installed here
            // because this is when the style menu first becomes known — a
            // frontend declares it at INIT, long after applyConfig.
            installStyleMenuPreviewCss(config.settings.slate?.styleMenu);
          }

          // 1d. Install variation field enhancers for blocks with `variations.length>1`.
          // Volto would normally add the variation field at sidebar render via
          // withVariationSchemaEnhancer, but that means the field is missing from
          // pathmap-built schemas. Prepending the enhancer to each block's chain
          // makes pathmap schemas a true superset of what Volto would render.
          installVariationFieldEnhancers(config.blocks.blocksConfig);

          // 1d.1. Auto-apply hideParentOwnedFields to every block. Any block can
          // be a child of a parent that uses block sync (typeField +
          // mappingField); installing this enhancer for all blocks makes
          // parent-owned fields automatically hide on the child sidebar form
          // when the parent has a type selected. Blocks don't need to opt in
          // or remember per-child-block configuration. Parents declare
          // additional claimed fields per child type via
          // `inheritSchemaFrom.parentControlled`.
          installChildBlockEnhancers(config.blocks.blocksConfig);

          // 1d-bis. Auto-attach the copy-from-target enhancer to every block
          // that declares fieldMappings['@target'] (e.g. teaser). The author's
          // only opt-in is the mapping; no per-block wiring.
          installCopyFromTargetEnhancers(config.blocks.blocksConfig);

          // 1e. Eager-populate the type schema cache. Done now (before any sidebar
          // rendering kicks off) so the cache is filled with no instance context
          // present. Avoids the previous bug where the lazy fill happened during a
          // sidebar render and inherited that render's instance identity, polluting
          // the cached "type-level" schema.
          populateTypeSchemaCache(config.blocks.blocksConfig, intl);

          // 2. Process page schema — page.schema.properties lists the page's
          // BLOCKS FIELDS, keyed by field name. Each field name is a key in the
          // shared blocks_layout dict; the default field is named 'items'.
          const pageProperties = event.data.page?.schema?.properties || {};
          // A page schema describes two different things. Entries carrying
          // `widget: 'blocks_layout'` are REGIONS (a key in the shared
          // blocks_layout dict); an entry naming one of the page's OWN fields
          // — `title`, `description` — is that frontend describing the field
          // it renders inline, placeholder included. The content type tells
          // them apart, since a page field carries no distinguishing widget of
          // its own. Anything else stays a region, as it was before, so a
          // frontend that declares a region without the widget still gets one.
          //
          // Without the split, EVERY property was coerced into a region: a
          // frontend that described its own title got a phantom blocks region
          // and no say over the wording the author sees.
          // No fallback. `{}` here is not "a content type with no fields", it
          // is "the content type has not loaded", and the two are
          // indistinguishable downstream: `_page` gets registered with the
          // page's regions and none of its own fields, the path map is built
          // from that, and the bridge quietly decides `title` is not
          // text-editable. Clicking the page title still SELECTS it — the
          // toolbar appears, selection does not go through the schema — so
          // nothing looks wrong while everything the author types is discarded
          // and the save carries no title at all. That cost a day to find,
          // through the menu it made look broken.
          //
          // Editing needs the content type. If it is not here, say so.
          if (
            history.location.pathname.endsWith('/edit') &&
            !schema?.properties
          ) {
            throw new Error(
              'INIT: the content type schema has not loaded, so the page fields ' +
                '(title, description) cannot be registered and would silently ' +
                'stop being editable. This is a load-order fault, not a content ' +
                'fault — the message handler must re-run once `schema` arrives.',
            );
          }
          const contentTypeProperties = schema?.properties;
          const pageFieldOverrides = {};
          const pageBlocksFieldsDef = {};
          for (const [fieldName, fieldDef] of Object.entries(pageProperties)) {
            const isRegion =
              fieldDef?.widget === 'blocks_layout' ||
              !(fieldName in contentTypeProperties);
            if (isRegion) {
              pageBlocksFieldsDef[fieldName] = fieldDef;
            } else {
              pageFieldOverrides[fieldName] = fieldDef;
            }
          }
          if (Object.keys(pageBlocksFieldsDef).length === 0) {
            pageBlocksFieldsDef.items = { title: 'Blocks' };
          }
          // Ensure each field has widget: 'blocks_layout' and its own constraints
          for (const [fieldName, fieldDef] of Object.entries(pageBlocksFieldsDef)) {
            pageBlocksFieldsDef[fieldName] = {
              widget: 'blocks_layout',
              allowedBlocks: fieldDef.allowedBlocks || null,
              allowedTemplates: fieldDef.allowedTemplates || null,
              allowedLayouts: fieldDef.allowedLayouts || null,
              // Preserve the region's seed type. Without this, defaultBlockType
              // is dropped here and arrives null in the container config, so a
              // single-allowedBlocks region auto-fills to that type instead of
              // honouring e.g. defaultBlockType: 'empty' (a stay-empty slot).
              defaultBlockType: fieldDef.defaultBlockType || null,
              maxLength: fieldDef.maxLength || null,
              title: fieldDef.title || fieldName,
              // Slate styles this region permits (#295). This rebuild is a
              // fixed key list, so anything not named here is silently dropped
              // on the way in — which is why these four are spelled out.
              allowedStyles: fieldDef.allowedStyles || null,
              disallowedStyles: fieldDef.disallowedStyles || null,
              allowedMarks: fieldDef.allowedMarks || null,
              disallowedMarks: fieldDef.disallowedMarks || null,
            };
          }

          // 2b. Apply restrictions based on page fields
          // Collect all unique allowed blocks across all page fields and restrict the rest
          const allAllowedBlocks = new Set();
          for (const fieldDef of Object.values(pageBlocksFieldsDef)) {
            if (fieldDef.allowedBlocks) {
              fieldDef.allowedBlocks.forEach(blockType => allAllowedBlocks.add(blockType));
            }
          }
          if (allAllowedBlocks.size > 0) {
            validateFrontendConfig({ allowedBlocks: [...allAllowedBlocks] }, config.blocks.blocksConfig);
            Object.keys(config.blocks.blocksConfig).forEach((blockType) => {
              const blockConfig = config.blocks.blocksConfig[blockType];
              if (blockConfig && !allAllowedBlocks.has(blockType)) {
                const existingRestricted = blockConfig.restricted;
                if (typeof existingRestricted !== 'function') {
                  blockConfig.restricted = true;
                }
              }
            });
            setAllowedBlocksList([...allAllowedBlocks]);
          }

          // 2c. Auto-initialize the blocks_layout dict — one empty list per
          // declared blocks field (so a declared-but-empty field is addressable).
          let formWithPageFields = form ? { ...form } : form;
          if (form) {
            if (!formWithPageFields.blocks) {
              formWithPageFields.blocks = {};
            }
            const layout = { ...(formWithPageFields.blocks_layout || {}) };
            for (const fieldName of Object.keys(pageBlocksFieldsDef)) {
              if (!Array.isArray(layout[fieldName])) {
                layout[fieldName] = [];
              }
            }
            formWithPageFields.blocks_layout = layout;
          }

          // 3. Register _page as virtual block type in blocksConfig
          // Merge content-type field definitions (title, description, etc.) alongside
          // blocks_layout fields so buildBlockPathMap includes them in resolvedBlockSchema.
          // This lets hydra.js derive page-level field types from blockPathMap['_page'].
          // The frontend's description of a page field wins over the backend's:
          // it is the thing that renders the field, so it decides the wording
          // the author is shown. Same rule as a block's schema, one level up.
          const contentTypeFields = { ...contentTypeProperties };
          for (const [fieldName, fieldDef] of Object.entries(pageFieldOverrides)) {
            contentTypeFields[fieldName] = {
              ...(contentTypeFields[fieldName] || {}),
              ...fieldDef,
            };
          }
          // Fallback wording, for a frontend that described neither.
          if (contentTypeFields.title && !contentTypeFields.title.placeholder) {
            contentTypeFields.title = { ...contentTypeFields.title, placeholder: intl.formatMessage({ id: 'Type the title…', defaultMessage: 'Type the title…' }) };
          }
          if (contentTypeFields.description && !contentTypeFields.description.placeholder) {
            contentTypeFields.description = { ...contentTypeFields.description, placeholder: intl.formatMessage({ id: 'Add a description…', defaultMessage: 'Add a description…' }) };
          }
          // The page metadata form in the sidebar renders from the content
          // type's own schema, so the merged definitions go back onto it:
          // otherwise the canvas shows the frontend's placeholder and the
          // sidebar shows none, which is how the old in-place mutation of
          // `schema.properties` happened to behave before this merge existed.
          if (schema?.properties) {
            Object.assign(schema.properties, contentTypeFields);
          }
          config.blocks.blocksConfig['_page'] = {
            id: '_page',
            schema: () => ({ properties: { ...contentTypeFields, ...pageBlocksFieldsDef } }),
            restricted: true, // Can't be added as a child block
          };

          // 3b. Register template URLs as virtual block types
          for (const fieldDef of Object.values(pageBlocksFieldsDef)) {
            if (fieldDef.allowedTemplates?.length > 0) {
              fieldDef.allowedTemplates.forEach(templateUrl => {
                if (typeof templateUrl === 'string') {
                  const templateName = templateUrl.split('/').filter(Boolean).pop() || 'unknown';
                  const templateBlockType = `Template: ${templateName}`;

                  // Register template as virtual block type (data fetched on selection)
                  if (!config.blocks.blocksConfig[templateBlockType]) {
                    config.blocks.blocksConfig[templateBlockType] = {
                      id: templateBlockType,
                      title: templateBlockType, // Full title with "Template:" prefix for sidebar display
                      icon: config.blocks.blocksConfig.slate?.icon,
                      isTemplate: true,
                      templateUrl: templateUrl, // URL to fetch when selected
                      group: 'templates',
                      restricted: false,
                    };
                  }
                }
              });
            }
          }

          // 4. Extract block field types (now includes custom blocks and page-level fields)
          const initialBlockFieldTypes = extractBlockFieldTypes(intl, schema);
          setBlockFieldTypes(initialBlockFieldTypes);

          // 5. Build blockPathMap (now has complete schema knowledge from _page registration)
          let initialBlockPathMap = buildBlockPathMap(
            formWithPageFields,
            config.blocks.blocksConfig,
            intl,
          );

          // 5b. Ensure empty page blocks fields have at least one empty block
          // No fieldName = process ALL page-level container fields and their regions
          // (e.g. blocks_layout's items + footer regions)
          const preEnsureForm = formWithPageFields;
          formWithPageFields = ensureEmptyBlockIfEmpty(
            formWithPageFields,
            { parentId: PAGE_BLOCK_UID },
            initialBlockPathMap,
            uuid,
            config.blocks.blocksConfig,
            { intl, metadata, properties: formWithPageFields },
          );
          // Rebuild blockPathMap only if empty blocks were actually added
          if (formWithPageFields !== preEnsureForm) {
            initialBlockPathMap = buildBlockPathMap(
              formWithPageFields,
              config.blocks.blocksConfig,
              intl,
            );
          }

          // 6. Apply schema defaults (handles schemaEnhancer-computed defaults like fieldMapping)
          let formWithDefaults = applySchemaDefaultsToFormData(
            formWithPageFields,
            initialBlockPathMap,
            config.blocks.blocksConfig,
            intl,
          );
          // 6b. On-load pull: every linked field fills from its stored snapshot
          // when the page opens for editing (canvas-pick snapshots carry the data;
          // sidebar `[{@id}]` links have nothing to pull).
          formWithDefaults = pullAllLinkedFields(formWithDefaults, config.blocks.blocksConfig);

          // No anchor seeding needed: the loaded blocks already carry their saved
          // _linkableAnchors in formData, so the object browser reads them straight
          // from the form (anchors ride the normal update flow now).

          setIframeSyncState(prev => ({
            ...prev,
            formData: formWithDefaults,
            blockPathMap: initialBlockPathMap,
          }));

          // 7. Send everything to iframe (only in edit mode)
          // In view mode, frontend renders from its own API - no need to send data
          const inEditMode = history.location.pathname.endsWith('/edit');
          if (!inEditMode) {
            log('INIT: view mode, skipping INITIAL_DATA');
            break;
          }
          if (!form) {
            log('INIT: form data not available yet, skipping INITIAL_DATA');
            break;
          }

          // 8. Always go through sync effect for template merge
          // Even if no templates in data, there might be forced layouts from allowedLayouts
          const templateIds = getUniqueTemplateIds(formWithDefaults);
          const unloadedTemplates = templateIds.filter(id => templateCacheRef.current[id] === undefined);

          if (unloadedTemplates.length > 0) {
            log('[INIT] Templates need loading, deferring INITIAL_DATA');
          } else {
            log('[INIT] No templates to load, but still merging for allowedLayouts');
          }

          // Store pending data for effect to merge and send
          pendingInitialDataRef.current = {
            source: event.source,
            origin: event.origin,
            // Store prepared formData with empty blocks already added
            formData: formWithDefaults,
            blockPathMap: initialBlockPathMap,
          };
          // Trigger the sync effect to fetch templates (if any) and merge
          setTemplateSyncTrigger(prev => prev + 1);
          break;
        }

        // case 'OPEN_OBJECT_BROWSER':
        //   openObjectBrowser({
        //     mode: event.data.mode,
        //     propDataName: 'data',
        //     onSelectItem: (item) => {
        //       event.source.postMessage(
        //         {
        //           type: 'OBJECT_SELECTED',
        //           path: item,
        //         },
        //         event.origin,
        //       );
        //       closeObjectBrowser();
        //       
        //     },
        //   });
        //   break;

        default:
          break;
      }
    };

    // Listen for messages from the iframe
    window.addEventListener('message', messageHandler);

    // Clean up the event listener on unmount
    return () => {
      window.removeEventListener('message', messageHandler);
    };
  }, [
    closeObjectBrowser,
    dispatch,
    form,
    form?.blocks,
    history,
    history.location.pathname,
    iframeSrc,
    onChangeFormData,
    onSelectBlock,
    openObjectBrowser,
    properties,
    // The content type schema. INIT registers `_page` — the page as a virtual
    // block, the content type's own fields with the frontend's description
    // layered on top — and builds the block path map from it. Reading
    // `schema?.properties` out of a stale closure gives `{}`, so `_page` gets
    // the page's regions and none of its fields: the bridge cannot resolve
    // `title` to a text-editable type and never makes it editable. Clicking the
    // page title still SELECTS it (the toolbar appears — selection does not go
    // through the schema), so it looks like it worked, while what the author
    // types is discarded and a save carries no title at all.
    schema,
    selectedBlock,
    token,
  ]);

  // UNIFIED FORM SYNC: Syncs iframeSyncState AND sends FORM_DATA to iframe
  // Triggers when Form's properties change or toolbar completes a format operation
  useEffect(() => {
    const useEffectT0 = performance.now();
    let formToUse = properties || form;

    // Skip if this is an echo from INLINE_EDIT_DATA we just processed
    if (processedInlineEditCounterRef.current < inlineEditCounterRef.current) {
      processedInlineEditCounterRef.current += 1;
      return;
    }

    // Case 1: Toolbar completed a format operation
    if (iframeSyncState.toolbarRequestDone) {
      console.log('[VIEW-TIMING] Case 1 start, toolbarRequestDone:', iframeSyncState.toolbarRequestDone, '+' + (performance.now() - (window._formatT0 || 0)).toFixed(0) + 'ms');
      // Increment edit sequence for toolbar operations too
      editSequenceRef.current++;
      let toolbarFormData = iframeSyncState.formData;
      // Always build blockPathMap from the form data being sent
      let toolbarBlockPathMap = iframeSyncState.blockPathMap && Object.keys(iframeSyncState.blockPathMap).length > 0
        ? iframeSyncState.blockPathMap
        : buildBlockPathMap(toolbarFormData || formToUse, config.blocks.blocksConfig, intl);
      // Split any multi-node slate blocks before sending to iframe
      const toolbarSplit = splitMultiNodeSlateBlocks(toolbarFormData, toolbarBlockPathMap, config.blocks.blocksConfig, uuid, iframeSyncState.selection);
      if (toolbarSplit) {
        toolbarFormData = toolbarSplit.formData;
        toolbarBlockPathMap = buildBlockPathMap(toolbarFormData, config.blocks.blocksConfig, intl);
        if (toolbarSplit.selectBlockId) {
          flushSync(() => {
            setIframeSyncState(prev => ({
              ...prev,
              selection: toolbarSplit.selection || prev.selection,
              pendingSelectBlockUid: toolbarSplit.selectBlockId,
            }));
          });
        }
      }
      const formWithSequence = {
        ...toolbarFormData,
        _editSequence: editSequenceRef.current,
      };
      const skipRender = iframeSyncState.skipRenderOnSend;
      const message = {
        type: 'FORM_DATA',
        data: formWithSequence,
        blockPathMap: stripBlockPathMapForPostMessage(toolbarBlockPathMap),
        formatRequestId: iframeSyncState.toolbarRequestDone,
      };
      // When a split created new blocks, tell the iframe which block to select
      if (toolbarSplit?.selectBlockId) {
        message.selectedBlockUid = toolbarSplit.selectBlockId;
        if (toolbarSplit.selection) {
          message.transformedSelection = toolbarSplit.selection;
        }
      } else if (iframeSyncState.selection) {
        message.transformedSelection = iframeSyncState.selection;
      }
      // When data didn't change (e.g. link cancel), tell iframe to skip
      // re-render — just unblock and restore selection/focus.
      if (skipRender) {
        message.skipRender = true;
      }
      message._sentAt = Date.now();
      console.log('[VIEW-TIMING] FORM_DATA prepared +' + (performance.now() - (window._formatT0 || 0)).toFixed(0) + 'ms (useEffect overhead: ' + (performance.now() - useEffectT0).toFixed(0) + 'ms), blockPathMap keys:', Object.keys(message.blockPathMap || {}).length);
      log('Sending FORM_DATA (Case 1: toolbar) formatRequestId:', message.formatRequestId,
        '_editSequence:', editSequenceRef.current, 'skipRender:', !!skipRender,
        'blockPathMap keys:', Object.keys(message.blockPathMap || {}),
        'cachedBPM keys:', Object.keys(iframeSyncState.blockPathMap || {}));
      const iframeEl = document.getElementById('previewIframe');
      let msgSize;
      try { msgSize = JSON.stringify(message).length; } catch { msgSize = -1; }
      // One-time payload breakdown
      if (!window._payloadLogged && message.formatRequestId) {
        window._payloadLogged = true;
        try {
          const dataSize = JSON.stringify(message.data).length;
          const bpmSize = JSON.stringify(message.blockPathMap).length;
          const schemasSize = message.blockPathMap._schemas ? JSON.stringify(message.blockPathMap._schemas).length : 0;
          const uniqueSchemas = message.blockPathMap._schemas ? Object.keys(message.blockPathMap._schemas).length : 0;
          console.log('[PAYLOAD] total:', (msgSize/1024).toFixed(0) + 'KB',
            'data:', (dataSize/1024).toFixed(0) + 'KB',
            'blockPathMap:', (bpmSize/1024).toFixed(0) + 'KB',
            'unique schemas:', uniqueSchemas, '(' + (schemasSize/1024).toFixed(0) + 'KB)');
        } catch (e) {
          console.log('[PAYLOAD] total:', (msgSize/1024).toFixed(0) + 'KB (detail error:', e.message + ')');
        }
      }
      message._sentAt = Date.now();
      const postT0 = performance.now();
      iframeEl?.contentWindow?.postMessage(
        message,
        iframeOriginRef.current,
      );
      console.log('[VIEW-TIMING] postMessage call took', (performance.now() - postT0).toFixed(1) + 'ms, payload:', (msgSize / 1024).toFixed(0) + 'KB');
      // Strip _editSequence from Redux - sequences are for iframe echo detection only.
      // Keeping them in Redux causes sidebar edits to inherit stale sequences.
      const { _editSequence: _, ...formWithoutSeq } = formWithSequence;
      // Use flushSync to ensure BOTH state updates commit before any pending re-renders
      // This prevents race condition where Redux update triggers Case 2 with stale properties
      // NOTE: flushSync may warn "cannot flush when already rendering" but still works
      flushSync(() => {
        setIframeSyncState(prev => ({ ...prev, toolbarRequestDone: null, skipRenderOnSend: false, formData: formWithSequence }));
        onChangeFormData(formWithoutSeq);
      });
      // Focus iframe AFTER flushSync — React has finished all synchronous
      // renders so nothing will steal focus. The iframe-side field focus is
      // handled by restoreSlateSelection in afterContentRender.
      if (iframeEl && message.formatRequestId) {
        iframeEl.focus();
      }
      return;
    }

    // INITIAL_DATA sending - consolidated to this ONE place
    // Handles: no templates, templates loading, templates already cached
    if (pendingInitialDataRef.current) {
      const { source, origin, formData: preparedFormData, blockPathMap: preparedBlockPathMap } = pendingInitialDataRef.current;
      const templateIds = getUniqueTemplateIds(preparedFormData);
      const unloadedTemplates = templateIds.filter(id => templateCacheRef.current[id] === undefined);

      if (unloadedTemplates.length === 0) {
        // No templates to load - but still need to merge for forced layouts
        log('[INITIAL_DATA] No templates to load, merging for forced layouts');
        const toolbarButtons = config.settings.slate?.toolbarButtons || [];

        // Get pageBlocksFields from config (set during INIT)
        const pageBlocksFields = config.blocks.blocksConfig['_page']?.schema?.()?.properties || {};

        // Always call mergeTemplatesIntoPage - it handles all cases:
        // - No templates/layouts: returns data unchanged
        // - Has templates: merges them
        // - Has forced layouts: applies them
        const api = new Api();

        (async () => {
          // Create loadTemplate that uses cache and falls back to API
          const loadTemplate = async (templateId) => {
            if (templateCacheRef.current[templateId]) {
              return templateCacheRef.current[templateId];
            }
            // Load from API and cache
            const template = await api.get(templateId);
            templateCacheRef.current[templateId] = template;
            return template;
          };

          // Merge templates with forced layouts
          const { merged: mergedFormData } = await mergeTemplatesIntoPage(preparedFormData, {
            loadTemplate,
            preloadedTemplates: templateCacheRef.current,
            pageBlocksFields,
            uuidGenerator: uuid,
            idFieldMap,
            // This document is being opened to edit: never merge it against its
            // own template, or a template forced into a region other than the one
            // its definition blocks live in loses them and its own page comes up
            // an empty shell.
            skipOwnTemplate: true,
          });
          let blockPathMap = buildBlockPathMap(mergedFormData, config.blocks.blocksConfig, intl);

          // Ensure empty page blocks fields have at least one empty block (template merge may add containers)
          let formDataToSend = ensureEmptyBlockIfEmpty(
            mergedFormData,
            { parentId: PAGE_BLOCK_UID },
            blockPathMap,
            uuid,
            config.blocks.blocksConfig,
            { intl, metadata, properties: mergedFormData },
          );
          if (formDataToSend !== mergedFormData) {
            blockPathMap = buildBlockPathMap(formDataToSend, config.blocks.blocksConfig, intl);
          }

          // Update Redux with the SAME data sent to the iframe (including seeded
          // empty placeholders). Committing the pre-seed mergedFormData instead
          // diverges Redux from the iframe: a custom region that renders from
          // pageState (e.g. an empty forced announcement) loses its seed on the
          // next Redux-sourced FORM_DATA sync. Edit-only seeds are stripped on
          // save by stripEmptyBlocks, so they never persist.
          onChangeFormData(formDataToSend);

          source.postMessage({
            type: 'INITIAL_DATA',
            data: formDataToSend,
            blockPathMap: stripBlockPathMapForPostMessage(blockPathMap),
            conversionMap: getConversionMap(config.blocks.blocksConfig),
            selectedBlockUid: selectedBlock,
            slateConfig: { hotkeys: config.settings.slate?.hotkeys || {}, toolbarButtons },
          }, origin);
          pendingInitialDataRef.current = null;
        })().catch(err => {
          log('[INITIAL_DATA] ERROR in forced-layout merge:', err.message, err.stack);
          console.error('[INITIAL_DATA] Error (forced-layout):', err);
        });
        return;
      }

      // Templates need loading - fetch them
      const api = new Api();

      (async () => {
        const newTemplates = {};

        await Promise.all(
          unloadedTemplates.map(async (templateId) => {
            try {
              const template = await api.get(templateId);
              newTemplates[templateId] = template;
            } catch (error) {
              console.warn(`[INITIAL_DATA] Failed to fetch template ${templateId}:`, error.status || error);
              templateCacheRef.current[templateId] = null;
            }
          }),
        );

        // Re-check pending ref - it might have been cleared if user navigated away
        if (!pendingInitialDataRef.current) {
          return;
        }

        const { source, origin, formData: baseFormData } = pendingInitialDataRef.current;
        const toolbarButtons = config.settings.slate?.toolbarButtons || [];

        // Update template cache
        templateCacheRef.current = { ...templateCacheRef.current, ...newTemplates };

        // Create loadTemplate that uses cache and falls back to API
        const loadTemplate = async (templateId) => {
          if (templateCacheRef.current[templateId]) {
            return templateCacheRef.current[templateId];
          }
          // Load from API and cache
          const template = await api.get(templateId);
          templateCacheRef.current[templateId] = template;
          return template;
        };

        // Get pageBlocksFields from config (set during INIT)
        const pageBlocksFields = config.blocks.blocksConfig['_page']?.schema?.()?.properties || {};

        // Merge templates (both newly fetched and already cached) with forced layouts
        const { merged: mergedFormData, newTemplateIds: moreTemplateIds } = await mergeTemplatesIntoPage(baseFormData, {
          loadTemplate,
          preloadedTemplates: templateCacheRef.current,
          pageBlocksFields,
          uuidGenerator: uuid,
          blocksConfig: config.blocks.blocksConfig,
          intl,
          idFieldMap,
        });
        if (moreTemplateIds.length > 0) {
          log('[INITIAL_DATA] Discovered nested templates:', moreTemplateIds);
          // TODO: Load nested templates and merge again
        }

        // Build blockPathMap and ensure empty blocks
        let blockPathMap = buildBlockPathMap(mergedFormData, config.blocks.blocksConfig, intl);
        let formDataToSend = ensureEmptyBlockIfEmpty(
          mergedFormData,
          { parentId: PAGE_BLOCK_UID },
          blockPathMap,
          uuid,
          config.blocks.blocksConfig,
          { intl, metadata, properties: mergedFormData },
        );
        if (formDataToSend !== mergedFormData) {
          blockPathMap = buildBlockPathMap(formDataToSend, config.blocks.blocksConfig, intl);
        }

        // Send INITIAL_DATA
        source.postMessage({
          type: 'INITIAL_DATA',
          data: formDataToSend,
          blockPathMap: stripBlockPathMapForPostMessage(blockPathMap),
          conversionMap: getConversionMap(config.blocks.blocksConfig),
          selectedBlockUid: selectedBlock,
          slateConfig: { hotkeys: config.settings.slate?.hotkeys || {}, toolbarButtons },
        }, origin);
        pendingInitialDataRef.current = null;

        // Update Redux with the SAME data sent to the iframe (including seeded
        // empty placeholders). Committing the pre-seed mergedFormData instead
        // diverges Redux from the iframe: a custom region that renders from
        // pageState (e.g. an empty forced announcement) loses its seed on the
        // next Redux-sourced FORM_DATA sync. Edit-only seeds are stripped on save
        // by stripEmptyBlocks, so they never persist.
        onChangeFormData(formDataToSend);
      })().catch(err => {
        log('[INITIAL_DATA] ERROR in template loading/merge:', err.message, err.stack);
        console.error('[INITIAL_DATA] Error:', err);
      });

      return; // Don't continue to Case 2 while templates are loading
    }

    // Case 2: Form properties changed (sidebar edit, block add, etc.)
    if (!formToUse || !iframeOriginRef.current) {
      return;
    }

    // Build blockPathMap first - needed for applying defaults to nested blocks
    let newBlockPathMap = buildBlockPathMap(formToUse, config.blocks.blocksConfig, intl);

    // Split any slate blocks that have multiple top-level nodes.
    // This happens when the deleteBackward extension demotes a list item
    // to a paragraph, producing [ul, p] — two top-level nodes in one block.
    // Each top-level node becomes its own block.
    const splitResult = splitMultiNodeSlateBlocks(formToUse, newBlockPathMap, config.blocks.blocksConfig, uuid, iframeSyncState.selection);
    if (splitResult) {
      formToUse = splitResult.formData;
      newBlockPathMap = buildBlockPathMap(formToUse, config.blocks.blocksConfig, intl);
      // Select the new block that received the split content
      if (splitResult.selectBlockId) {
        flushSync(() => {
          setIframeSyncState(prev => ({
            ...prev,
            selection: splitResult.selection || prev.selection,
            pendingSelectBlockUid: splitResult.selectBlockId,
          }));
        });
      }
      // Update Redux so the split persists
      onChangeFormData(formToUse);
    }

    // Apply schema defaults BEFORE equality check (handles schemaEnhancer-computed defaults)
    // This ensures fields like fieldMapping get smart defaults even on initial load.
    // IMPORTANT: Must apply before equality check so we compare apples-to-apples
    // (both formWithDefaults and iframeSyncState.formData have defaults applied)
    let formWithDefaults = applySchemaDefaultsToFormData(
      formToUse,
      newBlockPathMap,
      config.blocks.blocksConfig,
      intl,
    );
    // On-load pull: fill every linked block from its (full-metadata) snapshot when
    // the page opens. The widget's reactive pull covers editing the selected block.
    formWithDefaults = pullAllLinkedFields(formWithDefaults, config.blocks.blocksConfig);

    // Also skip if content is identical (ignoring _editSequence metadata)
    // Compare defaults-applied versions to avoid infinite loops
    if (formDataContentEqual(formWithDefaults, iframeSyncState.formData)) {
      return;
    }

    // Validate selection (may be stale after document structure changes)
    let newSelection = iframeSyncState.selection;
    if (selectedBlock && iframeSyncState.selection) {
      const block = getBlockById(formToUse, newBlockPathMap, selectedBlock);
      const slateValue = block?.value;
      if (slateValue && !isSelectionValidForValue(iframeSyncState.selection, slateValue)) {
        log('Selection invalid for new form data, clearing');
        newSelection = null;
      }
    }

    const hasPendingSelect = !!iframeSyncState.pendingSelectBlockUid;
    const hasPendingFormatRequest = !!iframeSyncState.pendingFormatRequestId;

    // Always increment sequence - useEffect only runs when properties change
    // The sequence is used to detect stale iframe echoes
    editSequenceRef.current++;

    // Add _editSequence to form data for round-trip tracking
    const formWithSequence = {
      ...formWithDefaults,
      _editSequence: editSequenceRef.current,
    };

    // Update local state
    // NOTE: Do NOT clear pendingSelectBlockUid here - keep it set until BLOCK_SELECTED
    // is received for that block. This prevents race conditions where another block
    // (e.g., parent container) gets selected during re-render and we send SELECT_BLOCK for it.
    log('PROPS_SYNC: overwriting iframeSyncState. prev.selection:', JSON.stringify(iframeSyncState.selection?.anchor?.path), 'newSelection:', JSON.stringify(newSelection?.anchor?.path), 'prevSource:', iframeSyncState._selectionSource);
    setIframeSyncState(prev => ({
      ...prev,
      formData: formWithSequence,
      blockPathMap: newBlockPathMap,
      selection: newSelection,
      _selectionSource: 'PROPS_SYNC',
      ...(hasPendingFormatRequest ? { pendingFormatRequestId: null } : {}),
      pendingTransformedSelection: null,
    }));

    // Send updated data to iframe (duplicates already filtered above)
    // Only include selectedBlockUid when there's a pending selection to avoid
    // clearing the iframe's selection with a null value from subsequent FORM_DATA
    const message = {
      type: 'FORM_DATA',
      data: formWithSequence,
      blockPathMap: stripBlockPathMapForPostMessage(newBlockPathMap),
      ...(hasPendingSelect ? { selectedBlockUid: iframeSyncState.pendingSelectBlockUid } : {}),
      ...(hasPendingFormatRequest ? { formatRequestId: iframeSyncState.pendingFormatRequestId } : {}),
      ...(iframeSyncState.pendingTransformedSelection ? { transformedSelection: iframeSyncState.pendingTransformedSelection } : {}),
    };
    log('Sending FORM_DATA to iframe. blockPathMap keys:', Object.keys(newBlockPathMap), 'selectedBlockUid:', hasPendingSelect ? iframeSyncState.pendingSelectBlockUid : '(not sent)', '_editSequence:', editSequenceRef.current);
    document.getElementById('previewIframe')?.contentWindow?.postMessage(
      message,
      iframeOriginRef.current,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties, iframeSyncState.toolbarRequestDone, templateSyncTrigger]);

  const sidebarFocusEventListenerRef = useRef(null);

  useEffect(() => {
    const handleMouseHover = (e) => {
      e.stopPropagation();
      
      // console.log(
      //   'Sidebar or its child element focused!',
      // );
    };
    sidebarFocusEventListenerRef.current = handleMouseHover;
    const sidebarElement = document.getElementById('sidebar');
    sidebarElement.addEventListener('mouseover', handleMouseHover, true);

    // Cleanup on component unmount
    return () => {
      // ... (your other cleanup code)
      if (sidebarElement && sidebarFocusEventListenerRef.current) {
        sidebarElement.removeEventListener(
          'mouseover',
          sidebarFocusEventListenerRef.current,
          true,
        );
      }
    };
  }, []);


  // Get parentContainerConfig for the selected block
  // - Used for adding siblings AFTER the selected block (iframe add)
  // NOTE: We use config.blocks.blocksConfig directly (not blocksConfig prop) because
  // the config is mutated when INIT is received with frontend's custom blocksConfig.
  // The iframeSyncState.blockPathMap dependency ensures re-compute after INIT.
  const parentContainerConfig = useMemo(() => {
    if (!selectedBlock || !iframeSyncState.blockPathMap) {
      return null;
    }

    // Use merged config from registry (includes frontend's custom blocks after INIT)
    const mergedBlocksConfig = config.blocks.blocksConfig;

    return getContainerFieldConfig(
      selectedBlock,
      iframeSyncState.blockPathMap,
      iframeSyncState.formData,
      mergedBlocksConfig,
      intl,
    );
  }, [selectedBlock, iframeSyncState.blockPathMap, iframeSyncState.formData, intl]);

  // Filter allowedBlocks by parent's variation if inheritSchemaFrom with blocksField is configured
  // This ensures new blocks match the parent's item type selection (container use case)
  const filterByParentVariation = useCallback((rawAllowedBlocks, parentBlockData, parentType) => {
    if (!rawAllowedBlocks || !parentBlockData || !parentType) {
      return rawAllowedBlocks;
    }
    const parentBlockConfig = config.blocks.blocksConfig?.[parentType];
    const schemaEnhancer = parentBlockConfig?.schemaEnhancer;
    // Handle both function (with .config) and recipe object (with .inheritSchemaFrom)
    const schemaEnhancerConfig = typeof schemaEnhancer === 'function'
      ? schemaEnhancer.config
      : schemaEnhancer?.inheritSchemaFrom;
    const typeField = schemaEnhancerConfig?.typeField;
    const blocksField = schemaEnhancerConfig?.blocksField;

    // Only filter when blocksField is set and not '..' (container use case)
    // Listing use case (blocksField: '..') doesn't need BlockChooser filtering
    if (!blocksField || blocksField === '..' || !typeField) {
      return rawAllowedBlocks;
    }

    const variationValue = parentBlockData?.[typeField];
    // If parent has a variation set and it's in allowedBlocks, filter to just that type
    if (variationValue && rawAllowedBlocks.includes(variationValue)) {
      return [variationValue];
    }
    return rawAllowedBlocks;
  }, []);

  // Iframe add: adds AFTER the selected block (as sibling)
  // Uses parentContainerConfig.allowedBlocks, or page-level allowedBlocks
  // Filtered by parent's variation if inheritSchemaFrom is configured
  const iframeAllowedBlocks = useMemo(() => {
    let allowed = allowedBlocks;
    if (parentContainerConfig?.allowedBlocks) {
      allowed = parentContainerConfig.allowedBlocks;
    }
    // Get parent block data for variation filtering
    const afterBlockId = selectedBlock;
    const parentId = iframeSyncState.blockPathMap?.[afterBlockId]?.parentId;
    if (parentId) {
      const parentBlockData = getBlockByPath(properties, iframeSyncState.blockPathMap?.[parentId]?.path);
      const parentType = iframeSyncState.blockPathMap?.[parentId]?.blockType;
      allowed = filterByParentVariation(allowed, parentBlockData, parentType);
    }
    return allowed;
  }, [parentContainerConfig, allowedBlocks, selectedBlock, iframeSyncState.blockPathMap, properties, filterByParentVariation]);

  // Compute allowedBlocks for BlockChooser based on pendingAdd context
  // Also applies variation filtering when parent has blocksField configured
  // Includes templates from allowedTemplates as virtual block types
  const effectiveAllowedBlocks = useMemo(() => {
    let allowed = null;
    let allowedTemplates = null;
    let parentBlockData = null;
    let parentType = null;

    // Helper to convert template URL/object to block type ID
    const getTemplateTypeId = (template) => {
      const templatePath = typeof template === 'string' ? template : (template['@id'] || template.UID || '');
      const templateName = templatePath.split('/').filter(Boolean).pop() || 'unknown';
      return `Template: ${templateName}`;
    };

    if (pendingAdd?.mode === 'sidebar') {
      // Sidebar add appends to a specific region of a container.
      const { parentBlockId, region = 'items' } = pendingAdd;
      const effectiveParentId = parentBlockId === null ? '_page' : parentBlockId;
      if (parentBlockId !== null) {
        parentBlockData = getBlockById(properties, iframeSyncState.blockPathMap, parentBlockId);
        parentType = iframeSyncState.blockPathMap?.[parentBlockId]?.blockType;
      }
      // Prefer the region's resolved constraints (carried on pendingAdd) so an
      // empty region still offers the right blocks; fall back to a sibling in
      // the SAME region.
      allowed = pendingAdd.allowedBlocks || null;
      allowedTemplates = pendingAdd.allowedTemplates || null;
      if (!allowed) {
        const childIds = getChildBlockIds(effectiveParentId, iframeSyncState.blockPathMap);
        const siblingInField = childIds.find((id) => {
          const info = iframeSyncState.blockPathMap[id];
          return (info.region || 'items') === region;
        });
        if (siblingInField) {
          const siblingInfo = iframeSyncState.blockPathMap[siblingInField];
          allowed = siblingInfo.allowedSiblingTypes || null;
          allowedTemplates = siblingInfo.allowedTemplates || null;
        }
      }
    } else {
      // Iframe add: get allowed blocks from blockPathMap (already resolved by buildBlockPathMap)
      const afterBlockId = pendingAdd?.afterBlockId || selectedBlock;
      const afterPathInfo = iframeSyncState.blockPathMap?.[afterBlockId];
      if (afterPathInfo?.parentId) {
        parentBlockData = getBlockByPath(properties, iframeSyncState.blockPathMap?.[afterPathInfo.parentId]?.path);
        parentType = iframeSyncState.blockPathMap?.[afterPathInfo.parentId]?.blockType;
        allowed = afterPathInfo.allowedSiblingTypes || null;
        allowedTemplates = afterPathInfo.allowedTemplates || null;
      } else {
        // No parent - page-level, get templates from _page schema
        const pageSchema = config.blocks.blocksConfig?.['_page']?.schema?.();
        const pageFieldDef = pageSchema?.properties?.blocks_layout;
        allowedTemplates = pageFieldDef?.allowedTemplates;
      }
    }

    // Apply variation filtering if parent has blocksField configured
    if (allowed && parentBlockData && parentType) {
      allowed = filterByParentVariation(allowed, parentBlockData, parentType);
    }

    let result = allowed || allowedBlocks;

    // Add template type IDs to allowed blocks
    if (allowedTemplates?.length > 0) {
      const templateTypeIds = allowedTemplates.map(getTemplateTypeId);
      result = result ? [...result, ...templateTypeIds] : templateTypeIds;
    }

    return result;
  }, [pendingAdd, selectedBlock, iframeSyncState.blockPathMap, properties, allowedBlocks, filterByParentVariation]);

  // ============================================================================
  // SLASH MENU — filtered block list for "/" command in iframe
  // ============================================================================
  const slashMenuBlocks = useMemo(() => {
    if (!slashMenu) return [];
    const hasAllowed = effectiveAllowedBlocks && effectiveAllowedBlocks.length > 0;
    const search = (slashMenu.filter || '').toLowerCase();

    const scoreBlock = (block) => {
      if (!search) return 0;
      const title = intl.formatMessage({ id: block.title, defaultMessage: block.title }).toLowerCase();
      if (title.indexOf(search) === 0) return 2; // prefix match
      if (title.includes(search)) return 1; // substring match
      return 0;
    };

    return Object.values(blocksConfig)
      .filter(block => {
        if (!block.id || !block.title) return false;
        if (block.id === 'slate') return false; // same as core Volto
        if (hasAllowed && !effectiveAllowedBlocks.includes(block.id)) return false;
        if (!search) return true;
        const title = intl.formatMessage({ id: block.title, defaultMessage: block.title }).toLowerCase();
        const originalTitle = block.title.toLowerCase();
        return title.includes(search) || originalTitle.includes(search);
      })
      .sort((a, b) => {
        const scoreDiff = scoreBlock(b) - scoreBlock(a);
        if (scoreDiff) return scoreDiff;
        const aTitle = intl.formatMessage({ id: a.title, defaultMessage: a.title });
        const bTitle = intl.formatMessage({ id: b.title, defaultMessage: b.title });
        return aTitle.localeCompare(bTitle);
      });
  }, [slashMenu, blocksConfig, effectiveAllowedBlocks, properties, navRoot, contentType, intl]);

  // Clamp slashMenuIndex to available blocks
  const clampedSlashMenuIndex = slashMenuBlocks.length > 0
    ? Math.min(slashMenuIndex, slashMenuBlocks.length - 1)
    : 0;

  // Handle slash menu selection (when 'selecting' flag is set)
  useEffect(() => {
    if (!slashMenu?.selecting) return;
    const block = slashMenuBlocks[clampedSlashMenuIndex];
    if (block) {
      onMutateBlock(slashMenu.blockId, { '@type': block.id });
    }
    setSlashMenu(null);
    setSlashMenuIndex(0);
    // Tell iframe to clear _slashMenuActive
    document.getElementById('previewIframe')?.contentWindow?.postMessage(
      { type: 'SLASH_MENU_CLOSED' },
      '*',
    );
  }, [slashMenu?.selecting]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close slash menu on click outside (or block change)
  useEffect(() => {
    if (!slashMenu) return;
    const closeSlashMenu = () => {
      setSlashMenu(null);
      setSlashMenuIndex(0);
      document.getElementById('previewIframe')?.contentWindow?.postMessage(
        { type: 'SLASH_MENU_CLOSED' },
        '*',
      );
    };
    // Click anywhere outside the menu portal closes it
    const handleMouseDown = (e) => {
      if (e.target.closest('.power-user-menu')) return;
      closeSlashMenu();
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [slashMenu !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================================
  // BLOCK ADD FLOW (Unified for Sidebar and Iframe)
  // ============================================================================
  //
  // Both sidebar add (via ChildBlocksWidget) and iframe add (via + button) follow
  // the same flow:
  //
  // 1. Determine allowedBlocks for the insertion context
  // 2. If single allowedBlock: auto-insert without showing chooser
  // 3. If multiple allowedBlocks: show BlockChooser for user selection
  //
  // After insertion (whether auto or via chooser):
  //
  // 1. onChangeFormData(newFormData) - updates Form.jsx state
  // 2. flushSync: set pendingSelectBlockUid - ensures flag is committed BEFORE Form re-renders
  // 3. useEffect runs when properties change, sees pendingSelectBlockUid
  // 4. useEffect sends FORM_DATA with selectedBlockUid to iframe
  // 5. iframe receives FORM_DATA, calls selectBlock(selectedBlockUid)
  // 6. iframe sends BLOCK_SELECTED back to admin
  // 7. View.jsx receives BLOCK_SELECTED, sets blockUI and calls onSelectBlock
  //
  // The key insight: pendingSelectBlockUid is just a FLAG. The actual formData comes
  // from Form.jsx props. The flushSync ensures the flag is set BEFORE the props update
  // triggers the useEffect, so they arrive at the iframe together.
  // ============================================================================

  // Handle sidebar add - adds inside a container's field as last child
  const handleSidebarAdd = useCallback((parentBlockId, containerConfig) => {
    // Validate parentBlockId - must be PAGE_BLOCK_UID or a valid block ID
    if (parentBlockId == null) {
      throw new Error('[HYDRA] handleSidebarAdd: parentBlockId is required. Use PAGE_BLOCK_UID for page-level blocks.');
    }
    // containerConfig is the descriptor produced by getAllContainerFields
    // (carries fieldName, region, isObjectList, allowedBlocks). No need to
    // re-resolve storage here.
    if (!containerConfig?.region) {
      throw new Error('[HYDRA] handleSidebarAdd: containerConfig with a fieldName is required.');
    }
    const { fieldName, region = 'items', isObjectList = false, allowedBlocks: containerAllowed = null } = containerConfig;

    // Auto-insert if single-schema object_list (no allowedBlocks) or single allowedBlock
    if ((isObjectList && (!containerAllowed || containerAllowed.length <= 1)) || (!isObjectList && containerAllowed?.length === 1)) {
      const blockType = isObjectList ? (containerAllowed?.[0] || null) : containerAllowed[0];
      insertAndSelectBlock(parentBlockId, blockType, 'inside', fieldName, { region });
    } else {
      setPendingAdd({
        mode: 'sidebar',
        parentBlockId,
        fieldName,
        region,
        // Carry the region's resolved constraints so the chooser works even for
        // an empty region (no existing sibling to read them from).
        allowedBlocks: containerAllowed,
        allowedTemplates: containerConfig.allowedTemplates || null,
      });
      setAddNewBlockOpened(true);
    }
  }, [insertAndSelectBlock]);

  // Handle iframe add - inserts AFTER the selected block (as sibling)
  const handleIframeAdd = useCallback(() => {
    // Filter the options by a position `@type` rule: a typeRule-driven container
    // (e.g. table cells) offers only the type(s) the rule wouldn't immediately
    // re-type at this spot — usually one, so we skip the chooser and add directly.
    const bpm = iframeSyncState.blockPathMap;
    const containerConfig = getContainerFieldConfig(selectedBlock, bpm, properties, blocksConfig, intl);
    const allowed = filterAddableTypesByRule(
      iframeAllowedBlocks, properties, bpm, selectedBlock, containerConfig, blocksConfig, intl,
    );
    // Filling an EMPTY placeholder CONVERTS it in place to a real allowedBlock —
    // the region's `defaultBlockType: 'empty'` governs the passive seed, but the
    // '+' must add a real block. Adding a sibling after would leave the empty at
    // index 0, and a single-block region (e.g. a forced announcement) rendered
    // from index 0 would never show the new block. The multi-allowed chooser path
    // already converts empties; this covers the single-allowed auto-insert.
    const selectedIsEmpty =
      getBlockById(properties, bpm, selectedBlock)?.['@type'] === 'empty';
    if (selectedIsEmpty && allowed?.length === 1) {
      const newFormData = convertBlockInPlace(properties, bpm, selectedBlock, allowed[0]);
      const newBpm = buildBlockPathMap(newFormData, blocksConfig, intl);
      onChangeFormData(newFormData);
      setIframeSyncState(prev => ({
        ...prev,
        formData: newFormData,
        blockPathMap: newBpm,
        pendingSelectBlockUid: selectedBlock,
      }));
    } else if (allowed?.length === 1) {
      insertAndSelectBlock(selectedBlock, allowed[0], 'after');
    } else {
      setPendingAdd({ mode: 'iframe', afterBlockId: selectedBlock, allowedBlocks: allowed });
      setAddNewBlockOpened(true);
    }
  }, [iframeAllowedBlocks, selectedBlock, insertAndSelectBlock, iframeSyncState.blockPathMap, properties, blocksConfig, intl, onChangeFormData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Convert a block to newType IN PLACE (container-aware), returning new formData.
  // Container blocks (any region with children) go through reshapeContainerBlock
  // — it carries their children over AND cascade-converts each cell to a type the
  // target region allows (pathMap-aware). A childless block converts its own fields.
  // Shared by the chooser commit and the auto-convert-on-drop/paste paths.
  const convertBlockInPlace = (props, bpm, blockId, newType) => {
    const blockData = getBlockById(props, bpm, blockId);
    if (!blockData) return props;
    const hasChildren = getContainerRegionDescriptors(
      blockData['@type'], blocksConfig, intl, blockData,
    ).some((d) => getChildBlockEntries(blockData, d).length > 0);
    if (hasChildren) {
      return reshapeContainerBlock(props, bpm, blockId, newType, blocksConfig, intl);
    }
    const typeFieldName = bpm?.[blockId]?.typeField || '@type';
    let newBlockData = convertBlockType(blockData, newType, blocksConfig, typeFieldName, intl);
    // Converting a TEMPLATE-MEMBER block keeps it template content — carry its
    // membership over. convertBlockType builds a fresh block from the type's
    // fields, so without this, filling a locked empty (in template-edit-mode)
    // would drop templateId/templateInstanceId/fixed/readOnly and the new block
    // would become per-page (and lose its lock). No-op for normal page blocks.
    for (const k of ['templateId', 'templateInstanceId', 'slotId', 'fixed', 'readOnly']) {
      if (blockData[k] !== undefined) newBlockData = { ...newBlockData, [k]: blockData[k] };
    }
    return updateBlockById(props, bpm, blockId, newBlockData);
  };

  // Commits a chooser action (wrap or convert) once the user picks a target type.
  const commitChooser = (newType) => {
    if (!chooser) return;
    const bpm = iframeSyncState.blockPathMap;
    try {
      if (chooser.kind === 'wrap') {
        const { formData: newFormData, newContainerId } = wrapBlocksInContainer(
          properties, bpm, chooser.blockIds, newType, blocksConfig, intl,
        );
        onChangeFormData(newFormData);
        if (onSetMultiSelected) onSetMultiSelected([]);
        if (onSelectBlock) onSelectBlock(newContainerId);
      } else if (chooser.kind === 'convert' && chooser.pendingPaste) {
        // Ask-first paste: insert a NEW block, converted to the chosen type,
        // after the paste target. One update → one undo.
        const pp = chooser.pendingPaste;
        const converted = convertBlockType(pp.blockData, newType, blocksConfig, '@type', intl);
        const cfg = getContainerFieldConfig(pp.afterBlockId, bpm, properties, blocksConfig, intl);
        let updatedProperties = insertBlockInContainer(
          properties, bpm, pp.afterBlockId, pp.newId, converted, cfg, 'after',
        );
        // The pick placed the block; run `@type` rules in case the position re-types
        // it or a sibling. No second confirm — the pick itself was the ask.
        updatedProperties = applySchemaDefaultsToFormData(
          updatedProperties, buildBlockPathMap(updatedProperties, blocksConfig, intl), blocksConfig, intl,
        );
        onChangeFormData(updatedProperties);
        setIframeSyncState(prev => ({
          ...prev,
          formData: updatedProperties,
          blockPathMap: buildBlockPathMap(updatedProperties, blocksConfig, intl),
          toolbarRequestDone: `paste-convert-${Date.now()}`,
        }));
      } else if (chooser.kind === 'convert') {
        const blockData = getBlockById(properties, bpm, chooser.blockId);
        if (blockData) {
          let updatedProperties = convertBlockInPlace(properties, bpm, chooser.blockId, newType);
          // Ask-first drop: the block hasn't moved yet. Move it (now that it's the
          // chosen type) on the converted formData so convert + move is ONE update
          // (single undo). Dismissing the chooser is a no-op — nothing was moved.
          if (chooser.pendingMove) {
            const bpm2 = buildBlockPathMap(updatedProperties, blocksConfig, intl);
            const pm = chooser.pendingMove;
            const srcParent = bpm2[chooser.blockId]?.parentId || null;
            updatedProperties = moveBlockBetweenContainers(
              updatedProperties, bpm2, chooser.blockId, pm.targetBlockId, pm.insertAfter,
              srcParent, pm.targetParentId, blocksConfig, intl,
            ) || updatedProperties;
            // The same settle the drag path uses: membership for what landed,
            // then the placeholder it landed on. Listing them is all this path
            // does — the order is settleBlockStructure's business.
            const settledDrop = settleBlockStructure(
              updatedProperties,
              buildBlockPathMap(updatedProperties, blocksConfig, intl),
              {
                landed: [chooser.blockId],
                replacedPlaceholders: pm.replaceTargetId ? [pm.replaceTargetId] : [],
              },
              {
                blocksConfig,
                intl,
                uuidGenerator: uuid,
                templateEditMode: templateEditModeRef.current,
                metadata,
                insertAfterById: { [chooser.blockId]: pm.insertAfter },
              },
            );
            updatedProperties = settledDrop.formData;
          }
          // The pick placed the block; run `@type` rules in case its new position
          // re-types it or a sibling. No second confirm — the pick was the ask.
          updatedProperties = applySchemaDefaultsToFormData(
            updatedProperties, buildBlockPathMap(updatedProperties, blocksConfig, intl), blocksConfig, intl,
          );
          onChangeFormData(updatedProperties);
          const newBlockPathMap = buildBlockPathMap(updatedProperties, blocksConfig, intl);
          setIframeSyncState(prev => ({
            ...prev,
            formData: updatedProperties,
            blockPathMap: newBlockPathMap,
            toolbarRequestDone: `convert-block-${Date.now()}`,
          }));
        }
      }
    } catch (err) {
      log('chooser commit failed:', err);
    }
    setChooser(null);
  };

  // Close the wrap/convert chooser on an outside click — it's a bare popup (no Cancel button),
  // so "click away to dismiss" lives here. Clicks inside the .blocks-chooser are ignored; picking
  // a type commits + closes via commitChooser.
  useEffect(() => {
    if (!chooser) return;
    const onDown = (e) => {
      if (e.target.closest('.blocks-chooser')) return;
      setChooser(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [chooser]);

  // v2: UNLOCK a template — snapshot the page (for Reset), re-fetch the template
  // fresh, add the instance to the unlocked set, and tell the iframe. Does NOT
  // lock the rest of the page.
  const enterTemplateEdit = async (instanceId) => {
    // Snapshot the current page so "Reset changes" can revert only this template's
    // blocks later, leaving page edits intact.
    templateSnapshotsRef.current[instanceId] = properties;

    // Re-fetch the template fresh into the cache — templateCacheRef persists across
    // page navigations, so without this we'd commit a stale copy. Skip for a
    // not-yet-saved template (_isNew): a GET would 404 / return a stub and clobber it.
    let editTemplateId = null;
    for (const block of Object.values(iframeSyncState.formData?.blocks || {})) {
      if (block.templateInstanceId === instanceId && block.templateId) {
        editTemplateId = block.templateId;
        break;
      }
    }
    if (editTemplateId && !templateCacheRef.current[editTemplateId]?._isNew) {
      try {
        templateCacheRef.current[editTemplateId] = await new Api().get(editTemplateId);
      } catch {
        // Offline / 404 — keep whatever's cached rather than dropping it.
      }
    }

    const next = [...new Set([...(iframeSyncState.templateEditMode || []), instanceId])];
    setIframeSyncState((prev) => ({
      ...prev,
      templateEditMode: [...new Set([...(prev.templateEditMode || []), instanceId])],
    }));
    postTemplateEditMode(next);
  };

  // v2: LOCK with "Change on all pages" — validate structure, then flush pending
  // inline edits; the flush-complete effect reverse-merges into the template and
  // saves the template document, then drops this instance from the unlocked set.
  const commitTemplateEdit = (instanceId) => {
    const validation = validateTemplatePlaceholders(iframeSyncState.formData);
    if (!validation.valid) {
      const firstError = Object.values(validation.blocksErrors)[0]?._layout;
      toast.error(
        <Toast
          error
          title={firstError?.title || 'Invalid Template Structure'}
          content={firstError?.message || 'Please fix the template structure before locking.'}
        />,
      );
      return false; // keep it unlocked so the user can fix it
    }
    const requestId = `tpl-commit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    pendingTemplateEditExitRef.current = { requestId, prevInstanceId: instanceId };
    setCommittingTemplate(true); // show the saving overlay until finish() clears it
    if (referenceElement?.contentWindow) {
      referenceElement.contentWindow.postMessage({ type: 'FLUSH_BUFFER', requestId }, '*');
    }
    return true;
  };

  // v2: LOCK with "Reset changes" — discard this template's edits by restoring its
  // blocks from the unlock-time snapshot, while KEEPING page-content edits made in
  // the meantime. The template cache is untouched (nothing is saved).
  const resetTemplateEdit = (instanceId) => {
    const snap = templateSnapshotsRef.current[instanceId];
    if (snap) {
      const isInst = (id, blocks) => blocks?.[id]?.templateInstanceId === instanceId;
      // Blocks: drop the instance's current blocks, restore the snapshot's.
      const blocks = {};
      for (const [id, b] of Object.entries(properties.blocks || {})) {
        if (b?.templateInstanceId !== instanceId) blocks[id] = b;
      }
      for (const [id, b] of Object.entries(snap.blocks || {})) {
        if (b?.templateInstanceId === instanceId) blocks[id] = b;
      }
      // Layout: keep the current (page-edited) order of non-instance blocks; splice
      // the snapshot's instance block ids back in at the instance's first position.
      const snapInstanceItems = (snap.blocks_layout?.items || []).filter((id) =>
        isInst(id, snap.blocks),
      );
      const items = [];
      let spliced = false;
      for (const id of properties.blocks_layout?.items || []) {
        if (isInst(id, properties.blocks)) {
          if (!spliced) {
            items.push(...snapInstanceItems);
            spliced = true;
          }
        } else {
          items.push(id);
        }
      }
      if (!spliced) {
        // No surviving instance anchor (all instance blocks were deleted): place the
        // group after the nearest preceding non-instance neighbour from the snapshot.
        const snapItems = snap.blocks_layout?.items || [];
        const firstIdx = snapItems.findIndex((id) => isInst(id, snap.blocks));
        let anchorAt = items.length;
        for (let i = firstIdx - 1; i >= 0; i--) {
          const pos = items.indexOf(snapItems[i]);
          if (pos !== -1) {
            anchorAt = pos + 1;
            break;
          }
        }
        items.splice(anchorAt, 0, ...snapInstanceItems);
      }
      onChangeFormData({
        ...properties,
        blocks,
        blocks_layout: { ...properties.blocks_layout, items },
      });
    }
    const next = (iframeSyncState.templateEditMode || []).filter((id) => id !== instanceId);
    setIframeSyncState((prev) => ({
      ...prev,
      templateEditMode: (prev.templateEditMode || []).filter((id) => id !== instanceId),
    }));
    postTemplateEditMode(next);
    delete templateSnapshotsRef.current[instanceId];
  };

  // Entry point for the sidebar "Edit template" toggle AND the Quanta toolbar lock
  // icon. Unlocking warns first; locking asks what to do with the edits. The actual
  // enter/commit/reset run from the modal's buttons.
  const handleToggleTemplateEditMode = (instanceId) => {
    const unlocked = iframeSyncState.templateEditMode || [];
    if (!unlocked.includes(instanceId)) {
      // Unlocking → warn first.
      setTemplateModal({ kind: 'unlock', instanceId });
      return;
    }
    // Locking → if the template wasn't changed during the unlock session, lock
    // silently (no prompt, no save); otherwise show the Change/Reset/Cancel modal.
    if (isInstanceUnchanged(instanceId, properties)) {
      exitTemplateEditNoSave(instanceId);
    } else {
      setTemplateModal({ kind: 'lock', instanceId });
    }
  };

  return (
    <div id="iframeContainer">
      {/* Saving overlay: the template lock-commit round-trip (flush → reverse-merge →
          PATCH → unlock) has no Volto request spinner and can be slow, so dim the
          editor and block interaction until it settles. Portaled to body so it covers
          the whole editor and can't be raced. */}
      {committingTemplate &&
        createPortal(
          <Dimmer active page>
            <Loader indeterminate>Saving template…</Loader>
          </Dimmer>,
          document.body,
        )}
      {/* v2 template-edit decision modals: unlock warning, lock choice, save gate.
          Portaled to document.body so it escapes #iframeContainer's stacking
          context — otherwise on mobile it renders BEHIND the settings sidebar
          (which sits at a higher z in the mobile ladder). */}
      {templateModal && createPortal((() => {
        const close = () => setTemplateModal(null);
        const { kind, instanceId } = templateModal;
        return (
          <div
            className="template-edit-modal-overlay"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            {kind === 'unlock' && (
              <div className="template-edit-modal template-unlock-modal">
                <h3>Unlock this template to edit it?</h3>
                <p>
                  Changes you make to this template will appear on <strong>every
                  page that uses it</strong> — as soon as you lock it again. The rest
                  of this page stays editable.
                </p>
                <div className="template-edit-modal-actions">
                  <button type="button" className="ui button template-cancel" onClick={close}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="ui primary button template-confirm"
                    onClick={() => {
                      close();
                      enterTemplateEdit(instanceId);
                    }}
                  >
                    Unlock to edit
                  </button>
                </div>
              </div>
            )}
            {kind === 'lock' && (
              <div className="template-edit-modal template-lock-modal">
                <h3>Lock this template</h3>
                <p>What should happen to your edits to this template?</p>
                <div className="template-edit-modal-actions">
                  <button
                    type="button"
                    className="ui primary button template-commit"
                    onClick={() => {
                      close();
                      commitTemplateEdit(instanceId);
                    }}
                  >
                    Change on all pages
                  </button>
                  <button
                    type="button"
                    className="ui button template-reset"
                    onClick={() => {
                      close();
                      resetTemplateEdit(instanceId);
                    }}
                  >
                    Reset changes
                  </button>
                  <button type="button" className="ui button template-cancel" onClick={close}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {kind === 'saveGate' && (
              <div className="template-edit-modal template-save-gate-modal">
                <h3>Lock your templates first</h3>
                <p>
                  You have a template unlocked for editing. Lock it (choosing whether
                  to change it on all pages or reset your changes) before saving the
                  page.
                </p>
                <div className="template-edit-modal-actions">
                  <button type="button" className="ui primary button template-confirm" onClick={close}>
                    OK
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })(), document.body)}
      <OpenObjectBrowser
        origin={iframeSrc && new URL(iframeSrc).origin}
        pendingFieldMedia={pendingFieldMedia}
        onFieldMediaSelected={(fieldName, blockUid, imagePath) => {
          // Update the block's field with the new image path
          const block = getBlockById(properties, iframeSyncState.blockPathMap, blockUid);
          if (!block) {
            setPendingFieldMedia(null);
            return;
          }

          const updatedBlock = { ...block, [fieldName]: imagePath };
          const updatedProperties = updateBlockById(properties, iframeSyncState.blockPathMap, blockUid, updatedBlock);

          // Update Redux via onChangeFormData
          onChangeFormData(updatedProperties);

          // Rebuild blockPathMap and send FORM_DATA to iframe
          const newBlockPathMap = buildBlockPathMap(updatedProperties, config.blocks.blocksConfig, intl);
          setIframeSyncState(prev => ({
            ...prev,
            formData: updatedProperties,
            blockPathMap: newBlockPathMap,
            toolbarRequestDone: `field-media-${Date.now()}`,
          }));

          setPendingFieldMedia(null);
        }}
        onFieldMediaCancelled={() => setPendingFieldMedia(null)}
      />
      {(addNewBlockOpened || chooser) &&
        createPortal(
          <div
            ref={setPopperElement}
            className="add-new-block-popup"
            style={styles.popper}
            {...attributes.popper}
          >
            {chooser ? (
              // Wrap/convert reuses the SAME popper-anchored chooser as add — one popup, bare:
              // pick a type to commit, click away to dismiss (no modal, no title/Cancel).
              <BlockChooser
                showRestricted
                allowedBlocks={chooser.allowedBlocks}
                blocksConfig={blocksConfig}
                currentBlock={chooser.blockId || selectedBlock}
                onInsertBlock={(_id, value) => commitChooser(value['@type'])}
                onMutateBlock={(_id, value) => commitChooser(value['@type'])}
                ref={blockChooserRef}
              />
            ) : (
            <BlockChooser
              onMutateBlock={
                onMutateBlock
                  ? (id, value) => {
                      setAddNewBlockOpened(false);
                      onMutateBlock(id, value);
                    }
                  : null
              }
              onInsertBlock={
                // Check if selected block is empty - if so, use onMutateBlock to replace
                (() => {
                  const selectedBlockData = getBlockById(
                    properties,
                    iframeSyncState.blockPathMap,
                    selectedBlock,
                  );
                  const isEmptyBlock = selectedBlockData?.['@type'] === 'empty';

                  if (isEmptyBlock) return null;

                  return (id, value) => {
                    setAddNewBlockOpened(false);
                    if (pendingAdd?.mode === 'sidebar') {
                      insertAndSelectBlock(pendingAdd.parentBlockId, value['@type'], 'inside', pendingAdd.region, { region: pendingAdd.region });
                    } else {
                      const afterBlockId = pendingAdd?.afterBlockId || selectedBlock;
                      insertAndSelectBlock(afterBlockId, value['@type'], 'after');
                    }
                    setPendingAdd(null);
                  };
                })()
              }
              currentBlock={selectedBlock}
              allowedBlocks={effectiveAllowedBlocks}
              blocksConfig={blocksConfig}
              properties={properties}
              showRestricted={showRestricted}
              ref={blockChooserRef}
              navRoot={navRoot}
              contentType={contentType}
            />
            )}
            {/* Mobile-only back-arrow at bottom-left corner. Hidden on
             * desktop/tablet via .mobile-sheet-close { display: none } in
             * mobile-tablet.css. Serves BOTH popups now that wrap/convert
             * reuses this one chooser (it used to live on the old modal). */}
            <button
              type="button"
              className="mobile-sheet-close"
              aria-label="Close menu"
              onClick={() => {
                setAddNewBlockOpened(false);
                setChooser(null);
              }}
            >
              ←
            </button>
          </div>,
          document.body,
        )}
      {/* "This drop/paste will convert some blocks — OK?" gate. A drop/paste is
       * trialled before committing; if any block's @type changed, confirm here. */}
      <Confirm
        open={!!convertConfirm}
        header="Convert blocks?"
        content={
          convertConfirm ? (
            <div className="content" data-testid="convert-confirm">
              <p>
                This drop will change the type of{' '}
                {convertConfirm.conversions.length} block
                {convertConfirm.conversions.length === 1 ? '' : 's'}:
              </p>
              <ul>
                {convertConfirm.conversions.map((c) => (
                  <li key={c.blockId}>
                    {c.from} → {c.to}
                  </li>
                ))}
              </ul>
            </div>
          ) : null
        }
        confirmButton="Convert"
        cancelButton="Cancel"
        onCancel={() => setConvertConfirm(null)}
        onConfirm={() => {
          const cb = convertConfirm?.onConfirm;
          setConvertConfirm(null);
          if (cb) cb();
        }}
      />
      {/* Slash menu — appears under the field in the iframe where "/" was typed */}
      {slashMenu && referenceElement && slashMenu.fieldRect &&
        createPortal(
          (() => {
            const iframeRect = referenceElement.getBoundingClientRect();
            const menuTop = iframeRect.top + slashMenu.fieldRect.bottom;
            const menuLeft = iframeRect.left + slashMenu.fieldRect.left;
            return (
              <div
                className="power-user-menu"
                style={{
                  position: 'fixed',
                  top: menuTop,
                  left: menuLeft,
                  width: 210,
                  zIndex: 10,
                }}
              >
                <Menu vertical fluid borderless>
                  {slashMenuBlocks.map((block, index) => (
                    <Menu.Item
                      key={block.id}
                      className={block.id}
                      active={index === clampedSlashMenuIndex}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMutateBlock(slashMenu.blockId, { '@type': block.id });
                        setSlashMenu(null);
                        setSlashMenuIndex(0);
                        document.getElementById('previewIframe')?.contentWindow?.postMessage(
                          { type: 'SLASH_MENU_CLOSED' },
                          '*',
                        );
                      }}
                    >
                      <Icon name={block.icon} size="24px" />
                      {intl.formatMessage({ id: block.title, defaultMessage: block.title })}
                    </Menu.Item>
                  ))}
                  {slashMenuBlocks.length === 0 && (
                    <Menu.Item>
                      {intl.formatMessage({ id: 'No matching blocks', defaultMessage: 'No matching blocks' })}
                    </Menu.Item>
                  )}
                </Menu>
              </div>
            );
          })(),
          document.body,
        )}
      {/* Only render when src is ready (ensures name attribute is applied on creation).
          Key on mode + frontend URL ensures iframe remounts when switching edit/view
          or switching frontends (avoids beforeunload dialog from old iframe),
          but persists during SPA navigation within the same mode */}
      {/* Comparing languages: pick the language to read alongside. Only offered
          when the page HAS another language — on a single-language site
          nothing here renders at all. */}
      {isEditMode && translations.length > 0 && (
        <div className="compare-languages" data-testid="compare-languages">
          <span>Compare with</span>
          {translations.map((translation) => (
            <button
              key={translation.language}
              type="button"
              className={
                compareLanguage === translation.language
                  ? 'compare-language active'
                  : 'compare-language'
              }
              aria-pressed={compareLanguage === translation.language}
              onClick={() => {
                setSelectedPane('edit');
                setCompareLanguage(
                  compareLanguage === translation.language
                    ? null
                    : translation.language,
                );
              }}
            >
              {translation.language}
            </button>
          ))}
        </div>
      )}
      {iframeSrc && (
        <div
          className={
            comparePreviewUrl ? 'preview-panes translating' : 'preview-panes'
          }
        >
          {/* Translating: the page being translated FROM, as the site renders
              it. Read-only — no bridge, no editing chrome — beside the draft,
              which is the pane the editor works in. */}
          {comparePreviewUrl && (
            // The pane is inert (its iframe takes no pointer events), so a
            // click lands here — which is how it gets selected.
            <div
              className={
                selectedPane === 'compare'
                  ? 'source-preview-pane selected'
                  : 'source-preview-pane'
              }
              // Which block of the other language is being shown: the
              // counterpart of the one selected next door, or nothing when the
              // selected block was added after the copy.
              data-showing-block={
                (compareContent && selectedBlock
                  ? counterpartBlockId(
                      properties?.blocks,
                      selectedBlock,
                      compareContent?.blocks,
                      buildIdFieldMap(config.blocks.blocksConfig, intl),
                    )
                  : null) || ''
              }
              onClick={() => setSelectedPane('compare')}
              onKeyDown={(e) => e.key === 'Enter' && setSelectedPane('compare')}
              role="button"
              tabIndex={0}
              aria-pressed={selectedPane === 'compare'}
              aria-label={`Show the fields of this page in ${compareLanguage}`}
            >
              <ViewPane
                id="translationSourceIframe"
                title={`This page in ${compareLanguage}`}
                src={comparePreviewUrl}
                // Pushed, not fetched: the same way the compare view shows a
                // version. The pane renders the document we hand it.
                content={compareReadOnlyContent}
                className="source-preview"
                selectable
                // The same block, in the other language — paired by
                // `@canonical`, which the copy recorded. A block added since
                // the copy has no counterpart, and nothing lights up: that is
                // itself worth seeing, because the block is new.
                showBlock={
                  compareContent && selectedBlock
                    ? counterpartBlockId(
                        properties?.blocks,
                        selectedBlock,
                        compareContent?.blocks,
                        buildIdFieldMap(config.blocks.blocksConfig, intl),
                      )
                    : null
                }
                onSelectBlock={(uid) => {
                  // Only when the editor is actually IN that pane. The pane
                  // also echoes back the selection we drive into it from the
                  // page being edited, and that must not take the sidebar.
                  if (
                    typeof document !== 'undefined' &&
                    document.activeElement?.id !== 'translationSourceIframe'
                  ) {
                    return;
                  }
                  setSelectedPane('compare');
                  setCompareSelectedBlock(uid);
                }}
              />
            </div>
          )}
          <iframe
            key={`${isEditMode ? 'edit' : 'view'}-${u}`}
            id="previewIframe"
            name={iframeName}
            title="Preview"
            src={iframeSrc}
            ref={setReferenceElement}
            allow="clipboard-read; clipboard-write"
            suppressHydrationWarning
            style={iframeMaxWidth ? { maxWidth: iframeMaxWidth } : undefined}
          />
        </div>
      )}

      {/* Multi-block selection outlines — individual outline per selected block */}
      {blockUI?.multiSelectedUids?.length > 1 && referenceElement && (() => {
        const rects = blockUI.multiSelectRects || {};
        if (Object.keys(rects).length === 0) return null;
        const iframeRect = referenceElement.getBoundingClientRect();
        return Object.entries(rects).map(([uid, rect]) => (
          <div
            key={`multi-outline-${uid}`}
            className="volto-hydra-block-outline"
            data-outline-style="border"
            data-block-uid={uid}
            style={{
              position: 'fixed',
              left: `${iframeRect.left + rect.left - 2}px`,
              top: `${iframeRect.top + rect.top - 2}px`,
              width: `${rect.width + 4}px`,
              height: `${rect.height + 4}px`,
              background: 'transparent',
              border: '2px solid #007eb1',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
        ));
      })()}

      {/* Single-block outline + underline (hidden during multi-select or selection mode) */}
      {blockUI && blockUI.rect && referenceElement && !selectionMode && !(blockUI.multiSelectedUids?.length > 1) && (() => {
        const isTextMode = !!blockUI.focusedFieldName;
        const iframeLeft = referenceElement.getBoundingClientRect().left;
        const iframeTop = referenceElement.getBoundingClientRect().top;
        return (
        <>
          <div
            className="volto-hydra-block-outline"
            data-outline-style={isTextMode ? 'subtle' : 'border'}
            style={{
              position: 'fixed',
              left: `${iframeLeft + blockUI.rect.left - 2}px`,
              top: `${iframeTop + blockUI.rect.top - 2}px`,
              width: `${blockUI.rect.width + 4}px`,
              height: `${blockUI.rect.height + 4}px`,
              background: 'transparent',
              border: isTextMode ? '1px solid rgba(0, 126, 177, 0.3)' : '2px solid #007eb1',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
          {isTextMode && blockUI.focusedFieldRect && (
            <div
              className="volto-hydra-field-underline"
              style={{
                position: 'fixed',
                left: `${iframeLeft + blockUI.focusedFieldRect.left}px`,
                top: `${iframeTop + blockUI.focusedFieldRect.top + blockUI.focusedFieldRect.height - 1}px`,
                width: `${blockUI.focusedFieldRect.width}px`,
                height: '3px',
                background: '#007eb1',
                pointerEvents: 'none',
                zIndex: 2,
              }}
            />
          )}
        </>
        );
      })()}

      {/* Edge-drag handles — visible chrome rendered admin-side from
          blockUI.canResize. Each visible handle is pointer-events: none so
          mouse events pass through to the iframe-side invisible
          .volto-hydra-edge-handle div underneath, which captures mousedown
          and runs the actual drag (chrome pattern, see docs/architecture.md).
          Hidden during multi-select / selection mode like every other
          single-block visual. */}
      {blockUI?.canResize && blockUI.rect && referenceElement && !selectionMode
       && !(blockUI.multiSelectedUids?.length > 1) && (() => {
        const iframeLeft = referenceElement.getBoundingClientRect().left;
        const iframeTop = referenceElement.getBoundingClientRect().top;
        const r = blockUI.rect;
        const handleStyle = (edge) => {
          const isVertical = edge === 'top' || edge === 'bottom';
          const base = {
            position: 'fixed',
            background: 'rgba(0, 126, 177, 0.35)',
            pointerEvents: 'none',
            zIndex: 2,
          };
          // Each visible handle is 1/3 of the edge length, centred — matches
          // the iframe-side invisible event-capture div underneath.
          const w3 = r.width / 3;
          const h3 = r.height / 3;
          if (isVertical) {
            return {
              ...base,
              left: `${iframeLeft + r.left + w3}px`,
              top: `${iframeTop + (edge === 'top' ? r.top - 3 : r.top + r.height - 3)}px`,
              width: `${w3}px`,
              height: '6px',
            };
          }
          return {
            ...base,
            left: `${iframeLeft + (edge === 'left' ? r.left - 3 : r.left + r.width - 3)}px`,
            top: `${iframeTop + r.top + h3}px`,
            width: '6px',
            height: `${h3}px`,
          };
        };
        return ['top', 'bottom', 'left', 'right']
          .filter((edge) => blockUI.canResize[edge])
          .map((edge) => (
            <div
              key={`edge-handle-${edge}`}
              className="volto-hydra-edge-handle-visual"
              data-edge={edge}
              style={handleStyle(edge)}
            />
          ));
      })()}

      {/* Touch selection mode — checkbox overlays on all visible blocks */}
      {selectionMode && blockUI?.selectionModeRects && referenceElement && (() => {
        const iframeRect = referenceElement.getBoundingClientRect();
        return Object.entries(blockUI.selectionModeRects).map(([uid, rect]) => {
          const isChecked = multiSelected.includes(uid);
          return (
            <div
              key={`sel-${uid}`}
              className="volto-hydra-selection-checkbox"
              data-block-uid={uid}
              data-checked={isChecked ? 'true' : 'false'}
              onClick={() => {
                const checked = multiSelected.includes(uid)
                  ? multiSelected.filter(id => id !== uid)
                  : [...multiSelected, uid];
                if (checked.length === 0) {
                  document.dispatchEvent(new CustomEvent('hydra-exit-selection-mode'));
                } else {
                  if (onSetMultiSelected) onSetMultiSelected(checked);
                }
              }}
              style={{
                position: 'fixed',
                left: `${iframeRect.left + rect.left - 4}px`,
                top: `${iframeRect.top + rect.top + rect.height / 2 - 12}px`,
                width: '24px',
                height: '24px',
                borderRadius: '4px',
                border: `2px solid ${isChecked ? '#007eb1' : '#999'}`,
                background: isChecked ? '#007eb1' : 'white',
                cursor: 'pointer',
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '14px',
                fontWeight: 'bold',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }}
            >
              {isChecked ? '\u2713' : ''}
            </div>
          );
        });
      })()}

      {/* Quanta Toolbar — renders for both single and multi-select */}
      <SyncedSlateToolbar
            selectedBlock={selectedBlock}
            form={iframeSyncState.formData}
            blockPathMap={iframeSyncState.blockPathMap}
            currentSelection={iframeSyncState.selection}
            _selectionSource={iframeSyncState._selectionSource}
            mouseActivityCounter={mouseActivityCounter}
            blockHasEmbed={!!blockUI?.hasEmbed}
            completedFlushRequestId={iframeSyncState.completedFlushRequestId}
            transformAction={iframeSyncState.transformAction}
            onTransformApplied={() => setIframeSyncState(prev => ({ ...prev, transformAction: null }))}
            onChangeFormData={(newFieldValue, selection, formatRequestId, extraBlocks) => {
              log('onChangeFormData callback called, formatRequestId:', formatRequestId,
                'hasFieldValue:', newFieldValue != null, 'extraBlocks:', extraBlocks?.length || 0,
                'selectionPath:', JSON.stringify(selection?.anchor?.path), 'selectionOffset:', selection?.anchor?.offset,
                'value[0].children:', JSON.stringify(newFieldValue?.[0]?.children?.map(c => c.type ? {type: c.type, text: c.children?.[0]?.text} : {text: c.text?.substring(0, 20)})));

              // Apply field value change and/or extra blocks to the latest
              // iframeSyncState (via prev), not the stale form prop snapshot.
              setIframeSyncState(prev => {
                let fd = prev.formData;
                let bpm = prev.blockPathMap;
                let dataChanged = false;

                // Apply field value change to the selected block
                if (newFieldValue != null) {
                  const fieldName = blockUI?.focusedFieldName || 'value';
                  const block = getBlockById(fd, bpm, selectedBlock);
                  const updatedBlock = { ...block, [fieldName]: newFieldValue };
                  fd = updateBlockById(fd, bpm, selectedBlock, updatedBlock);
                  dataChanged = true;
                }

                // Insert extra blocks from paste emitter extraction (images,
                // tables, text blocks split from multi-paragraph paste)
                let pendingSelectBlockUid = null;
                if (extraBlocks?.length > 0) {
                  bpm = buildBlockPathMap(fd, config.blocks.blocksConfig, intl);
                  const containerConfig = getContainerFieldConfig(
                    selectedBlock, bpm, fd, config.blocks.blocksConfig, intl,
                  );
                  let lastId = selectedBlock;
                  for (const [newId, blockData] of extraBlocks) {
                    fd = insertBlockInContainer(fd, bpm, lastId, newId, blockData, containerConfig, 'after');
                    bpm = buildBlockPathMap(fd, config.blocks.blocksConfig, intl);
                    lastId = newId;
                  }
                  pendingSelectBlockUid = lastId;
                  dataChanged = true;
                }

                const newSel = selection || prev.selection;
                log('onChangeFormData updater: prevSelPath:', JSON.stringify(prev.selection?.anchor?.path),
                  'newSelPath:', JSON.stringify(newSel?.anchor?.path), 'newSelOffset:', newSel?.anchor?.offset,
                  'selSameRef:', selection === prev.selection, 'formatRequestId:', formatRequestId);
                return {
                  ...prev,
                  formData: fd,
                  blockPathMap: bpm,
                  selection: newSel,
                  _selectionSource: selection ? 'onChangeFormData:toolbar' : prev._selectionSource,
                  toolbarRequestDone: formatRequestId || prev.toolbarRequestDone,
                  // When data didn't change, tell iframe to skip re-render
                  // (e.g. link cancel — just unblock and restore focus)
                  skipRenderOnSend: !dataChanged && !!formatRequestId,
                  ...(pendingSelectBlockUid ? { pendingSelectBlockUid } : {}),
                };
              });
            }}
            blockUI={blockUI}
            blockFieldTypes={blockFieldTypes}
            iframeElement={referenceElement}
            onDeleteBlock={onDeleteBlock}
            onSelectBlock={onSelectBlock}
            parentId={iframeSyncState.blockPathMap?.[selectedBlock]?.parentId}
            maxToolbarWidth={referenceElement?.getBoundingClientRect()?.width || 400}
            blockActions={iframeSyncState.blockPathMap?.[selectedBlock]?.actions}
            onBlockAction={(actionId) => {
              // Generic action handler - dispatches based on action type
              const pathInfo = iframeSyncState.blockPathMap?.[selectedBlock];

              if (actionId === 'deleteColumn' && pathInfo?.parentAddMode === 'table') {
                const cellIndex = pathInfo.path[pathInfo.path.length - 1];
                const newFormData = deleteTableColumn(properties, iframeSyncState.blockPathMap, selectedBlock);
                if (newFormData) {
                  // Determine what to select after deletion BEFORE triggering re-render
                  let selectBlockId = pathInfo.parentId;

                  if (cellIndex > 0) {
                    // Find the cell in the previous column (same row)
                    const newBlockPathMap = buildBlockPathMap(newFormData, blocksConfig, intl);
                    const rowBlock = getBlockByPath(newFormData, newBlockPathMap[pathInfo.parentId]?.path);
                    if (rowBlock?.cells?.[cellIndex - 1]) {
                      selectBlockId = rowBlock.cells[cellIndex - 1].key;
                    }
                  }

                  // Set pending selection BEFORE form update to prevent sidebar from rendering deleted block
                  flushSync(() => {
                    setIframeSyncState((prev) => ({
                      ...prev,
                      pendingSelectBlockUid: selectBlockId,
                    }));
                  });

                  // Clear current selection and update form
                  onSelectBlock(null);
                  onChangeFormData(newFormData);
                }
              } else if (actionId === 'deleteRow') {
                // Delete row - works from row itself OR from a cell (deletes parent row)
                let rowId = selectedBlock;
                let rowPathInfo = pathInfo;
                let cellIndex = null;

                // If called from a cell, find the parent row and track cell index
                if (pathInfo?.parentAddMode === 'table') {
                  cellIndex = pathInfo.path[pathInfo.path.length - 1];
                  rowId = pathInfo.parentId;
                  rowPathInfo = iframeSyncState.blockPathMap?.[rowId];
                }

                if (rowPathInfo?.addMode === 'table') {
                  const containerConfig = getContainerFieldConfig(rowId, iframeSyncState.blockPathMap, properties, blocksConfig, intl);
                  const rowIndex = rowPathInfo.path[rowPathInfo.path.length - 1];

                  // A row delete is a delete: deleteBlocks removes it and settles what
                  // that disturbed (re-seeding the table if it took the last row),
                  // and brings the lock backstop with it — a row of locked template
                  // chrome is not the author's to remove from a page.
                  const { formData: newFormData, deleted: deletedRows } = deleteBlocks(
                    properties,
                    iframeSyncState.blockPathMap,
                    [rowId],
                    { blocksConfig, intl, uuidGenerator: uuid, templateEditMode: iframeSyncState.templateEditMode, metadata },
                  );
                  if (deletedRows.length > 0) {

                    // Determine what to select after deletion BEFORE triggering re-render
                    // If called from a cell, select corresponding cell in previous row
                    // Otherwise, select the parent table
                    let selectBlockId = rowPathInfo.parentId;

                    if (cellIndex != null && rowIndex > 0) {
                      // Find the previous row and its corresponding cell
                      const newBlockPathMap = buildBlockPathMap(newFormData, blocksConfig, intl);
                      const tableBlock = getBlockByPath(newFormData, newBlockPathMap[rowPathInfo.parentId]?.path);
                      const dataPath = [...(containerConfig.regionPath || []), containerConfig.region || 'rows'];
                      let rows = tableBlock;
                      for (const key of dataPath) {
                        rows = rows?.[key];
                      }
                      const prevRow = rows?.[rowIndex - 1];
                      if (prevRow?.cells?.[cellIndex]) {
                        selectBlockId = prevRow.cells[cellIndex].key;
                      }
                    }

                    // Set pending selection BEFORE form update to prevent sidebar from rendering deleted block
                    flushSync(() => {
                      setIframeSyncState((prev) => ({
                        ...prev,
                        pendingSelectBlockUid: selectBlockId,
                      }));
                    });

                    // Clear current selection and update form
                    onSelectBlock(null);
                    onChangeFormData(newFormData);
                  }
                }
              } else if (actionId === 'addRowBefore' || actionId === 'addRowAfter') {
                // Add row uses existing insertAndSelectBlock with 'before' or 'after'
                // If called from a cell, use the parent row and track cell index for selection
                const action = actionId === 'addRowBefore' ? 'before' : 'after';
                let targetBlock = selectedBlock;
                let selectChildIndex = null;
                if (pathInfo?.parentAddMode === 'table') {
                  // We're in a cell - find its index so we can select corresponding cell in new row
                  // Cell index is the last element in the path
                  selectChildIndex = pathInfo.path[pathInfo.path.length - 1];
                  targetBlock = pathInfo.parentId;
                }
                insertAndSelectBlock(targetBlock, null, action, null, { selectChildIndex });
              } else if (actionId === 'addColumnBefore' || actionId === 'addColumnAfter') {
                // Add column uses insertAndSelectBlock which detects table mode
                const action = actionId === 'addColumnBefore' ? 'before' : 'after';
                insertAndSelectBlock(selectedBlock, null, action);
              }
            }}
            onFieldLinkChange={(fieldName, url, metadata) => {
              let updatedProperties;

              // ONE finalize for every path (page-field, pick, typed, fetched):
              // push the updated form data to Redux + the iframe, rebuild pathMap.
              const finalizeLink = (up) => {
                onChangeFormData(up);
                const newBlockPathMap = buildBlockPathMap(up, config.blocks.blocksConfig, intl);
                setIframeSyncState(prev => ({
                  ...prev,
                  formData: up,
                  blockPathMap: newBlockPathMap,
                  toolbarRequestDone: `field-link-${Date.now()}`,
                }));
              };

              if (selectedBlock === PAGE_BLOCK_UID) {
                // Page-level field - update directly on properties
                // For image fields with metadata, construct NamedBlobImage format
                if (metadata?.image_scales) {
                  const imageField = metadata.image_field || 'image';
                  const scaleInfo = metadata.image_scales[imageField]?.[0];
                  // Resolve relative download paths in scales against the content URL
                  const rawScales = scaleInfo?.scales || {};
                  const resolvedScales = {};
                  for (const [scaleName, scaleData] of Object.entries(rawScales)) {
                    resolvedScales[scaleName] = {
                      ...scaleData,
                      download: scaleData.download?.startsWith('http')
                        ? scaleData.download
                        : `${url}/${scaleData.download}`,
                    };
                  }
                  // Construct NamedBlobImage object format
                  const imageValue = {
                    '@type': 'Image',
                    'download': `${url}/@@images/${imageField}`,
                    'scales': resolvedScales,
                  };
                  updatedProperties = { ...properties, [fieldName]: imageValue };
                } else {
                  updatedProperties = { ...properties, [fieldName]: url };
                }
              } else {
                // Block field - update the block's field with the new URL
                // Use getBlockById to handle both top-level and container blocks
                const block = getBlockById(properties, iframeSyncState.blockPathMap, selectedBlock);
                if (!block) return;

                const blockCfg = config.blocks.blocksConfig[block['@type']];
                const isUrlField = blockCfg && getUrlField(blockCfg) === fieldName;

                // Store a link `value` (object_browser array shape) and its metadata,
                // pull every linked field from the (now full) snapshot, flip edited
                // fields custom, then push FORM_DATA. Shared by pick / typed / fetched.
                const applyLinkValue = (value, extraMeta) => {
                  let updatedBlock = setFieldValue(block, fieldName, value);
                  const meta = extraMeta || metadata;
                  if (meta?.image_scales) {
                    updatedBlock = { ...updatedBlock, image_field: meta.image_field, image_scales: meta.image_scales };
                  }
                  // No pull here — storing the link (full snapshot) is enough; the
                  // copy-from-target widget's reactive pull fills the mapped fields.
                  let up = updateBlockById(properties, iframeSyncState.blockPathMap, selectedBlock, updatedBlock);
                  up = markEditedLinkedFieldsCustom(up, properties, config.blocks.blocksConfig);
                  finalizeLink(up);
                };

                // A TYPED internal URL carries no metadata (unlike a pick). Resolve
                // the target's brain (metadata_fields:'_all') so the stored snapshot
                // carries the full data — the same fetch the sidebar's manual-link
                // input does — then every mapped field pulls from it. No copy-from-
                // target @search: the data lives on the link field afterwards.
                if (typeof url === 'string' && url && isUrlField && isInternalURL(url)) {
                  const path = flattenToAppURL(url);
                  Promise.resolve(
                    dispatch(searchContent(path, { 'path.depth': 0, metadata_fields: '_all', b_size: 1 }, `copy-from-target-${path}`)),
                  )
                    .then((resp) => {
                      const item = (resp?.items || []).find((i) => flattenToAppURL(i['@id']) === path);
                      applyLinkValue([{ ...(item || {}), '@id': path }]);
                    })
                    .catch(() => applyLinkValue([{ '@id': path }]));
                  return;
                }

                // Pick (value already an array with metadata) or an external typed
                // URL (wrap the bare string into the array shape).
                let value = url;
                if (typeof url === 'string' && url && isUrlField) {
                  value = [{ '@id': url }];
                }
                applyLinkValue(value);
                return;
              }

              // Page-level field path finalizes here (block-field path returned above).
              finalizeLink(updatedProperties);
            }}
            onOpenObjectBrowser={(fieldName, blockUid) => {
              // Set pending state to trigger object browser via OpenObjectBrowser component
              setPendingFieldMedia({ fieldName, blockUid });
            }}
            convertibleTypes={(() => {
              const bpm = iframeSyncState.blockPathMap;
              const blockData = getBlockById(properties, bpm, selectedBlock);
              const typeFieldName = bpm?.[selectedBlock]?.typeField || '@type';
              const blockType = blockData?.[typeFieldName];
              const allowedTypes = bpm?.[selectedBlock]?.allowedSiblingTypes;
              const contentTargets = getConvertibleTypes(blockType, blocksConfig, allowedTypes);

              // Container-to-container conversions: source is a container with children.
              // For each OTHER container whose child field accepts all of source's
              // children, offer it as a target. The existing getConvertibleTypes
              // doesn't cover this because it relies on fieldMappings, which are
              // content-level.
              // Child types across ALL regions (blocks_layout + object_list), not just default.
              const childEntries = blockType
                ? getContainerRegionDescriptors(blockData['@type'], blocksConfig, intl, blockData).flatMap((d) =>
                    getChildBlockEntries(blockData, d),
                  )
                : [];
              if (childEntries.length === 0) return contentTargets;

              const childTypes = childEntries
                .map((e) => e.block?.['@type'])
                .filter(Boolean);
              const containerTargets = [];
              const existingTypes = new Set(contentTargets.map(t => t.type));
              for (const [type, cfg] of Object.entries(blocksConfig || {})) {
                if (!cfg?.blockSchema) continue;
                if (type === blockType) continue;
                if (existingTypes.has(type)) continue;
                let schema;
                try {
                  schema = typeof cfg.blockSchema === 'function'
                    ? cfg.blockSchema({ blocksConfig, intl }) : cfg.blockSchema;
                } catch { continue; }
                const props = schema?.properties || {};
                let tgtChildField = null;
                for (const [fn, field] of Object.entries(props)) {
                  if (field?.widget === 'blocks_layout') { tgtChildField = { region: fn, ...field }; break; }
                }
                if (!tgtChildField) continue;
                if (!canContainAll(tgtChildField, childTypes, 0)) continue;
                // Also respect parent's allowedBlocks — new container type must be allowed in its place.
                if (allowedTypes && !allowedTypes.includes(type)) continue;
                containerTargets.push({ type, title: cfg.title || type });
              }
              return [...contentTargets, ...containerTargets];
            })()}
            onOpenConvertChooser={() => {
              // Open BlockChooser overlay seeded with convertibleTypes for the
              // currently selected block. commitChooser handles the actual
              // mutation when the user picks a target.
              const bpm = iframeSyncState.blockPathMap;
              const blockData = getBlockById(properties, bpm, selectedBlock);
              const typeFieldName = bpm?.[selectedBlock]?.typeField || '@type';
              const blockType = blockData?.[typeFieldName];
              const allowedTypes = bpm?.[selectedBlock]?.allowedSiblingTypes;
              const contentTargets = getConvertibleTypes(blockType, blocksConfig, allowedTypes);

              // Child types across ALL regions (blocks_layout + object_list), not just default.
              const childEntries = blockType
                ? getContainerRegionDescriptors(blockData['@type'], blocksConfig, intl, blockData).flatMap((d) =>
                    getChildBlockEntries(blockData, d),
                  )
                : [];
              const containerTargets = [];
              if (childEntries.length > 0) {
                const childTypes = childEntries
                  .map((e) => e.block?.['@type']).filter(Boolean);
                const existing = new Set(contentTargets.map(t => t.type));
                for (const [type, cfg] of Object.entries(blocksConfig || {})) {
                  if (!cfg?.blockSchema || type === blockType || existing.has(type)) continue;
                  let schema;
                  try {
                    schema = typeof cfg.blockSchema === 'function'
                      ? cfg.blockSchema({ blocksConfig, intl }) : cfg.blockSchema;
                  } catch { continue; }
                  let tgt = null;
                  for (const [fn, field] of Object.entries(schema?.properties || {})) {
                    if (field?.widget === 'blocks_layout') { tgt = { region: fn, ...field }; break; }
                  }
                  if (!tgt) continue;
                  if (!canContainAll(tgt, childTypes, 0)) continue;
                  if (allowedTypes && !allowedTypes.includes(type)) continue;
                  containerTargets.push({ type });
                }
              }
              const allTargets = [
                ...contentTargets.map(t => t.type),
                ...containerTargets.map(t => t.type),
              ];
              setChooser({ kind: 'convert', blockId: selectedBlock, allowedBlocks: allTargets });
            }}
            {...(() => {
              // Wrap action props — only when there's a multi-selection that
              // shares a parent and at least one compatible container exists.
              const blockIds = multiSelected || [];
              if (blockIds.length < 1) return {};
              const bpm = iframeSyncState.blockPathMap;
              const firstCC = getContainerFieldConfig(blockIds[0], bpm, properties, blocksConfig, intl);
              if (!firstCC || firstCC.isObjectList) return {};
              for (const id of blockIds.slice(1)) {
                const cc = getContainerFieldConfig(id, bpm, properties, blocksConfig, intl);
                if (!cc || cc.parentId !== firstCC.parentId || cc.region !== firstCC.region) {
                  return {};
                }
              }
              const selectedTypes = blockIds.map((id) => {
                const data = getBlockById(properties, bpm, id);
                return data?.['@type'];
              }).filter(Boolean);
              const parentPath = firstCC.parentId === PAGE_BLOCK_UID
                ? [] : bpm[firstCC.parentId]?.path;
              const parentBlock = getBlockByPath(properties, parentPath);
              const parentItems = parentBlock ? getContainerItems(parentBlock, firstCC) : [];
              const itemsAfter = parentItems.length - blockIds.length + 1;
              const parentAllows = (t) => !firstCC.allowedBlocks || firstCC.allowedBlocks.includes(t);

              const eligibleTypes = [];
              for (const [type, cfg] of Object.entries(blocksConfig || {})) {
                if (!cfg?.blockSchema) continue;
                // A container's child field may be blocks_layout (section, columns) OR an
                // object_list (a slider's `slides`). One descriptor covers both, so a slider is
                // now offered as a wrap target too.
                let childField;
                try { childField = getContainerRegionDescriptors(type, blocksConfig, intl)[0] || null; } catch { continue; }
                if (!childField) continue;
                if (!canContainAll(childField, selectedTypes, 0)) continue;
                if (!parentAllows(type)) continue;
                if (firstCC.maxLength != null && itemsAfter > firstCC.maxLength) continue;
                eligibleTypes.push(type);
              }
              if (eligibleTypes.length === 0) return {};
              return {
                canWrap: true,
                onOpenWrapChooser: () => setChooser({
                  kind: 'wrap', blockIds, allowedBlocks: eligibleTypes,
                }),
              };
            })()}
            {...(() => {
              // Unwrap action props — only render for blocks that ARE containers.
              // For leaf blocks (slate, image, etc.) omit onUnwrap so the menu
              // item doesn't render.
              const bpm = iframeSyncState.blockPathMap;
              if (!selectedBlock || !bpm?.[selectedBlock]) return {};
              const block = getBlockById(properties, bpm, selectedBlock);
              if (!block) return {};
              // Read children from ALL regions + funnel, so a slider (children in `slides`) and a
              // multi-region/mixed container are unwrappable the same as a section.
              const childEntries = getContainerRegionDescriptors(
                block['@type'],
                blocksConfig,
                intl,
                block,
              ).flatMap((d) => getChildBlockEntries(block, d));
              if (childEntries.length === 0) return {}; // not a container with children

              const childTypes = childEntries
                .map((e) => e.block?.['@type'])
                .filter(Boolean);
              const parentCC = getContainerFieldConfig(selectedBlock, bpm, properties, blocksConfig, intl);
              let canUnwrap = false;
              // Symmetric with wrap: works for object_list parents too. getContainerItems +
              // canContainAll + unwrapContainer are all storage-agnostic (funnel), so the
              // old `!parentCC.isObjectList` gate was the last blocks_layout-only assumption.
              if (parentCC) {
                const parentPath = parentCC.parentId === PAGE_BLOCK_UID ? [] : bpm[parentCC.parentId]?.path;
                const parentBlock = getBlockByPath(properties, parentPath);
                const currentCount = parentBlock ? (getContainerItems(parentBlock, parentCC).length - 1) : 0;
                canUnwrap = canContainAll(parentCC, childTypes, currentCount);
              }

              return {
                canUnwrap,
                onUnwrap: () => {
                  try {
                    const { formData: newFormData, promotedIds } = unwrapContainer(
                      properties, bpm, selectedBlock, blocksConfig, intl,
                    );
                    onChangeFormData(newFormData);
                    if (promotedIds.length > 0 && onSelectBlock) {
                      onSelectBlock(promotedIds[0]);
                    }
                  } catch (err) {
                    log('unwrapContainer failed:', err);
                  }
                },
              };
            })()}
            templateEditMode={iframeSyncState.templateEditMode}
            templatePermissions={templateCacheRef.current}
            onToggleTemplateEditMode={handleToggleTemplateEditMode}
            onMakeTemplate={() => {
              // Create a new template from the selected block
              const blockData = getBlockById(properties, iframeSyncState.blockPathMap, selectedBlock);
              if (!blockData) return;

              // Generate a unique template ID and instance ID. Parent folder
              // comes from config (default '/templates') so consumers can
              // host templates anywhere in the content tree without forking
              // the bridge. The user can also retarget the save location
              // via the sidebar 'folder' field after creation.
              const templateCount = Object.values(properties.blocks || {})
                .filter(b => b.templateInstanceId === b.templateId)
                .length;
              const defaultName = `untitled-template-${templateCount + 1}`;
              const templatesFolder = config.settings.templatesPath || '/templates';
              const newTemplateId = `${templatesFolder.replace(/\/$/, '')}/${defaultName}`;
              const newInstanceId = newTemplateId; // For new template, templateInstanceId === templateId

              // Add template fields to the block
              const updatedBlock = {
                ...blockData,
                templateId: newTemplateId,
                templateInstanceId: newInstanceId,
                slotId: 'primary', // Default slot name
              };

              // Update the block in formData
              const updatedProperties = updateBlockById(
                properties,
                iframeSyncState.blockPathMap,
                selectedBlock,
                updatedBlock
              );

              // Create a template document structure in cache. _isNew flags
              // this for the save flow to POST (create on the backend) the
              // first time, then PATCH on subsequent saves. Without _isNew,
              // saveTemplatesRef would PATCH-only and 404 on a real Plone.
              templateCacheRef.current[newTemplateId] = {
                '@id': newTemplateId,
                '@type': 'Document',
                'title': defaultName,
                'blocks': {
                  [selectedBlock]: updatedBlock,
                },
                'blocks_layout': { items: [selectedBlock] },
                _isNew: true,
              };

              // Update Redux
              onChangeFormData(updatedProperties);

              // Rebuild blockPathMap
              const newBlockPathMap = buildBlockPathMap(updatedProperties, blocksConfig, intl);

              // Snapshot for Reset, and enter edit mode for the just-created
              // template instance (no unlock warning — the user explicitly made it).
              templateSnapshotsRef.current[newInstanceId] = updatedProperties;
              const nextEdit = [
                ...new Set([...(iframeSyncState.templateEditMode || []), newInstanceId]),
              ];

              // Find the template instance ID in the new pathMap
              // (it will be created as a virtual container)
              setIframeSyncState(prev => ({
                ...prev,
                formData: updatedProperties,
                blockPathMap: newBlockPathMap,
                toolbarRequestDone: `make-template-${Date.now()}`,
                pendingSelectBlockUid: newInstanceId, // Select the template instance
                templateEditMode: [
                  ...new Set([...(prev.templateEditMode || []), newInstanceId]),
                ], // v2: add to the unlocked set
              }));
              postTemplateEditMode(nextEdit);
            }}
          />

      {/* Add Button — single-block only, hidden during multi-select */}
      {blockUI && blockUI.rect && referenceElement && !(blockUI.multiSelectedUids?.length > 1) &&
        blockUI.addDirection !== 'hidden' && (() => {
            const iframeRect = referenceElement.getBoundingClientRect();
            log('Add button render, blockUI.addDirection:', blockUI.addDirection, 'blockUid:', blockUI.blockUid);
            const isRightDirection = blockUI.addDirection === 'right';

            const buttonWidth = 30;
            const buttonHeight = 30;

            // An empty block is REPLACED, not appended to: its '+' picks the empty's type in
            // place. Draw it in the middle of the block, over the centered '+' glyph hydra
            // renders ([data-hydra-empty]::after) — that glyph is what the editor aims at, and
            // it's the only way to type the block. The 'add after' position (below/right) would
            // leave the glyph dead.
            const emptyPathInfo = iframeSyncState.blockPathMap?.[selectedBlock];
            const isEmptyBlock =
              getBlockType(
                getBlockById(properties, iframeSyncState.blockPathMap, selectedBlock),
                emptyPathInfo?.typeField,
              ) === 'empty';

            let addLeft;
            let addTop;
            if (isEmptyBlock) {
              addLeft = iframeRect.left + blockUI.rect.left + blockUI.rect.width / 2 - buttonWidth / 2;
              addTop = iframeRect.top + blockUI.rect.top + blockUI.rect.height / 2 - buttonHeight / 2;
            } else {
              addLeft = isRightDirection
                ? iframeRect.left + blockUI.rect.left + blockUI.rect.width + 8
                : iframeRect.left + blockUI.rect.left + blockUI.rect.width - buttonWidth;

              const iframeRight = iframeRect.left + iframeRect.width;
              if (addLeft + buttonWidth > iframeRight) {
                // No room to the right — pull the '+' INSIDE the block horizontally.
                addLeft = iframeRect.left + blockUI.rect.left + blockUI.rect.width - buttonWidth - 8;
              }

              if (isRightDirection) {
                // A right-add pulled inside for lack of room was only constrained
                // on the horizontal axis, so keep the button at the block's
                // TOP-right — it was just nudged in. Dropping it to the block's
                // bottom would move it on an axis that never overflowed. The
                // vertical clamp below still pulls it up if a tall block would
                // push it past the canvas bottom.
                addTop = iframeRect.top + blockUI.rect.top;
              } else {
                addTop = iframeRect.top + blockUI.rect.top + blockUI.rect.height + 8;
              }

              // Vertical counterpart of the horizontal clamp above. Sitting the '+' 8px
              // BELOW the block puts it outside the canvas whenever the block ends at the
              // canvas edge — on a phone that is on top of the bottom toolbar, where it
              // paints over Save/Cancel and swallows their clicks. Pull it back INSIDE the
              // block (same move the horizontal clamp above makes) rather than let it
              // escape. Clamp the top edge too, for a block taller than the canvas.
              const iframeBottom = iframeRect.top + iframeRect.height;
              if (addTop + buttonHeight > iframeBottom) {
                addTop = iframeRect.top + blockUI.rect.top + blockUI.rect.height - buttonHeight - 8;
              }
              if (addTop < iframeRect.top) {
                addTop = iframeRect.top + 8;
              }
            }

            const pathInfo = iframeSyncState.blockPathMap?.[selectedBlock];
            const isTableMode = pathInfo?.addMode === 'table' || pathInfo?.parentAddMode === 'table';
            let addIcon;
            let addTitle;
            if (isTableMode) {
              addIcon = isRightDirection
                ? <Icon name={columnAfterSVG} size="20px" />
                : <Icon name={rowAfterSVG} size="20px" />;
              addTitle = isRightDirection ? "Add column" : "Add row";
            } else {
              addIcon = <span style={{ fontSize: '22px', lineHeight: 1 }}>+</span>;
              addTitle = "Add block";
            }

            return (
            <button
              className="volto-hydra-add-button"
              style={{
                position: 'fixed',
                left: `${addLeft}px`,
                top: `${addTop}px`,
                zIndex: 10,
                width: '30px',
                height: '30px',
                background: 'rgba(200, 200, 200, 0.5)',
                color: '#666',
                border: 'none',
                borderRadius: '50%',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0',
              }}
              onClick={handleIframeAdd}
              title={addTitle}
            >
              {addIcon}
            </button>
            );
          })()}

      {/* The compared language's own fields, read-only, while its pane is the
          selected one. Volto shows them by making the sidebar follow whichever
          form was clicked; here the panes are frontends, so the fields come
          from the document the pane was given. */}
      {selectedPane === 'compare' &&
        compareContent &&
        props.schema &&
        typeof document !== 'undefined' &&
        document.getElementById('sidebar') &&
        createPortal(
          <div className="compare-language-fields" data-testid="compare-language-fields">
            {(() => {
              // A block if one was picked in that pane, the page otherwise —
              // the same choice the sidebar makes for the page being edited.
              const picked = compareSelectedBlock
                ? getBlockById(
                    compareContent,
                    buildBlockPathMap(compareContent, config.blocks.blocksConfig, intl),
                    compareSelectedBlock,
                  )
                : null;
              return picked ? (
                <ReadOnlyForm
                  schema={getBlockTypeSchema(
                    picked['@type'],
                    intl,
                    config.blocks.blocksConfig,
                  )}
                  formData={picked}
                  title={`${picked['@type']} (${compareLanguage})`}
                />
              ) : (
                <ReadOnlyForm
                  schema={props.schema}
                  formData={compareContent}
                  title={`${compareContent.title || ''} (${compareLanguage})`}
                />
              );
            })()}
          </div>,
          document.getElementById('sidebar'),
        )}

      {/* Hierarchical sidebar widgets */}
      {/* Use properties (Redux) for formData - it's always up-to-date after onChangeFormData */}
      {/* blockPathMap is updated synchronously before onChangeFormData, so they stay in sync */}
      <ParentBlocksWidget
        selectedBlock={selectedBlock}
        multiSelected={multiSelected}
        blocksErrors={blocksErrors}
        untranslatedIds={untranslatedIds}
        formData={properties}
        blockPathMap={iframeSyncState.blockPathMap}
        templatePermissions={templateCacheRef.current}
        onSelectBlock={onSelectBlock}
        onDeleteBlock={onDeleteBlock}
        onBlockAction={(actionId, blockId) => {
          // Generic action handler - dispatches based on action type
          // Used by sidebar dropdowns to handle table/block actions
          const pathInfo = iframeSyncState.blockPathMap?.[blockId];

          if (actionId === 'deleteColumn' && pathInfo?.parentAddMode === 'table') {
            const cellIndex = pathInfo.path[pathInfo.path.length - 1];
            const newFormData = deleteTableColumn(properties, iframeSyncState.blockPathMap, blockId);
            if (newFormData) {
              let selectBlockId = pathInfo.parentId;
              if (cellIndex > 0) {
                const newBlockPathMap = buildBlockPathMap(newFormData, blocksConfig, intl);
                const rowBlock = getBlockByPath(newFormData, newBlockPathMap[pathInfo.parentId]?.path);
                if (rowBlock?.cells?.[cellIndex - 1]) {
                  selectBlockId = rowBlock.cells[cellIndex - 1].key;
                }
              }
              flushSync(() => {
                setIframeSyncState((prev) => ({
                  ...prev,
                  pendingSelectBlockUid: selectBlockId,
                }));
              });
              onSelectBlock(null);
              onChangeFormData(newFormData);
            }
          } else if (actionId === 'deleteRow') {
            let rowId = blockId;
            let rowPathInfo = pathInfo;
            let cellIndex = null;
            if (pathInfo?.parentAddMode === 'table') {
              cellIndex = pathInfo.path[pathInfo.path.length - 1];
              rowId = pathInfo.parentId;
              rowPathInfo = iframeSyncState.blockPathMap?.[rowId];
            }
            if (rowPathInfo?.addMode === 'table') {
              const containerConfig = getContainerFieldConfig(rowId, iframeSyncState.blockPathMap, properties, blocksConfig, intl);
              const rowIndex = rowPathInfo.path[rowPathInfo.path.length - 1];
              // A row delete is a delete: deleteBlocks removes it and settles what
              // that disturbed (re-seeding the table if it took the last row),
              // and brings the lock backstop with it — a row of locked template
              // chrome is not the author's to remove from a page.
              const { formData: newFormData, deleted: deletedRows } = deleteBlocks(
                properties,
                iframeSyncState.blockPathMap,
                [rowId],
                { blocksConfig, intl, uuidGenerator: uuid, templateEditMode: iframeSyncState.templateEditMode, metadata },
              );
              if (deletedRows.length > 0) {
                let selectBlockId = rowPathInfo.parentId;
                if (cellIndex != null && rowIndex > 0) {
                  const newBlockPathMap = buildBlockPathMap(newFormData, blocksConfig, intl);
                  const tableBlock = getBlockByPath(newFormData, newBlockPathMap[rowPathInfo.parentId]?.path);
                  const dataPath = [...(containerConfig.regionPath || []), containerConfig.region || 'rows'];
                  let rows = tableBlock;
                  for (const key of dataPath) {
                    rows = rows?.[key];
                  }
                  const prevRow = rows?.[rowIndex - 1];
                  if (prevRow?.cells?.[cellIndex]) {
                    selectBlockId = prevRow.cells[cellIndex].key;
                  }
                }
                flushSync(() => {
                  setIframeSyncState((prev) => ({
                    ...prev,
                    pendingSelectBlockUid: selectBlockId,
                  }));
                });
                onSelectBlock(null);
                onChangeFormData(newFormData);
              }
            }
          } else if (actionId === 'addRowBefore' || actionId === 'addRowAfter') {
            const action = actionId === 'addRowBefore' ? 'before' : 'after';
            let targetBlock = blockId;
            let selectChildIndex = null;
            if (pathInfo?.parentAddMode === 'table') {
              selectChildIndex = pathInfo.path[pathInfo.path.length - 1];
              targetBlock = pathInfo.parentId;
            }
            insertAndSelectBlock(targetBlock, null, action, null, { selectChildIndex });
          } else if (actionId === 'addColumnBefore' || actionId === 'addColumnAfter') {
            const action = actionId === 'addColumnBefore' ? 'before' : 'after';
            insertAndSelectBlock(blockId, null, action);
          }
        }}
        onChangeBlock={(blockId, newBlockData) => {
          // DEBUG: trace facets changes through onChangeBlock
          if (newBlockData?.facets) {
            log('[onChangeBlock] blockId:', blockId, 'facets:', newBlockData.facets.length,
              'ids:', newBlockData.facets.map(f => f['@id']));
          }
          // Guard: blockId can be undefined when Volto components like BlockDataForm
          // are missing the block prop (e.g., SearchBlockEdit doesn't pass block to BlockDataForm)
          if (!blockId) {
            console.warn(
              '[HYDRA] onChangeBlock called with undefined blockId. ' +
              'This is likely a Volto bug where BlockDataForm is used without a block prop. ' +
              'Data keys:', Object.keys(newBlockData || {}),
              'Stack:', new Error().stack
            );
            return;
          }

          // Handle page-level changes (PAGE_BLOCK_UID) - merge directly into formData
          if (blockId === PAGE_BLOCK_UID) {
            const newFormData = { ...properties, ...newBlockData };
            validateAndLog(newFormData, 'onChangeBlock (page-level)', blockFieldTypes);
            onChangeFormData(newFormData);
            return;
          }

          // Rebuild blockPathMap from current properties to ensure it's up to date
          const currentBlockPathMap = buildBlockPathMap(properties, config.blocks.blocksConfig, intl);

          // Get old block data before the update (for sync detection)
          const oldBlockData = getBlockById(properties, currentBlockPathMap, blockId);
          log('onChangeBlock: blockId:', blockId, 'oldVariation:', oldBlockData?.variation, 'newVariation:', newBlockData?.variation);

          // Find container config (works for both page-level and nested blocks)
          const pathInfo = currentBlockPathMap[blockId];
          if (!pathInfo) {
            throw new Error(`[HYDRA] onChangeBlock: block ${blockId} not in pathMap`);
          }
          const containerConfig = getContainerFieldConfig(
            blockId,
            currentBlockPathMap,
            properties,
            blocksConfig,
            intl,
          );

          let newFormData = mutateBlockInContainer(
            properties,
            currentBlockPathMap,
            blockId,
            newBlockData,
            containerConfig,
          );

          // Sync child @type if parent has inheritSchemaFrom and typeField changed
          newFormData = syncChildBlockTypes(
            newFormData,
            currentBlockPathMap,
            blockId,
            oldBlockData,
            newBlockData,
            config.blocks.blocksConfig,
            intl,
          );

          // Validate data from sidebar before using it
          validateAndLog(newFormData, 'onChangeBlock (sidebar)', blockFieldTypes);
          onChangeFormData(newFormData);
        }}
        templateEditMode={iframeSyncState.templateEditMode}
        onChangeTemplateSettings={(instanceId, settings) => {
          // Update template settings in templateCache
          const pathInfo = iframeSyncState.blockPathMap?.[instanceId];
          const templateId = pathInfo?.templateId || instanceId;
          if (templateCacheRef.current[templateId]) {
            templateCacheRef.current[templateId] = {
              ...templateCacheRef.current[templateId],
              ...settings,
            };
          }
          // Update blockData for the virtual template instance
          const newBlockPathMap = { ...iframeSyncState.blockPathMap };
          if (newBlockPathMap[instanceId]) {
            newBlockPathMap[instanceId] = {
              ...newBlockPathMap[instanceId],
              blockData: {
                ...newBlockPathMap[instanceId].blockData,
                ...settings,
              },
            };
            setIframeSyncState(prev => ({
              ...prev,
              blockPathMap: newBlockPathMap,
            }));
          }
        }}
        onToggleTemplateEditMode={handleToggleTemplateEditMode}
      />
      <ChildBlocksWidget
        selectedBlock={selectedBlock}
        formData={properties}
        blockPathMap={iframeSyncState.blockPathMap}
        onSelectBlock={onSelectBlock}
        onAddBlock={(parentBlockId, containerConfig, options) => {
          if (options?.afterBlockId) {
            // Template slot section: add after specific block
            const afterId = options.afterBlockId;
            const afterPathInfo = iframeSyncState.blockPathMap?.[afterId];
            const allowed = afterPathInfo?.allowedSiblingTypes || null;
            if (allowed?.length === 1) {
              insertAndSelectBlock(afterId, allowed[0], 'after');
            } else {
              setPendingAdd({ mode: 'iframe', afterBlockId: afterId });
              setAddNewBlockOpened(true);
            }
          } else {
            handleSidebarAdd(parentBlockId, containerConfig);
          }
        }}
        onMoveBlock={(parentBlockId, region, newOrder) => {
          const newFormData = reorderBlocksInContainer(
            properties,
            iframeSyncState.blockPathMap,
            parentBlockId,
            region,
            newOrder,
            config.blocks?.blocksConfig,
            intl,
          );
          onChangeFormData(newFormData);
        }}
        onChangeFormData={onChangeFormData}
        templateEditMode={iframeSyncState.templateEditMode}
      />
    </div>
  );
};

export default Iframe;
