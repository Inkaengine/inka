/**
 * Form data validation utilities for Volto Hydra.
 *
 * Validates content/form data at system boundaries:
 * - Data from postMessages (INLINE_EDIT_DATA from hydra.js)
 * - Data from sidebar edits (onChangeBlock)
 *
 * Uses plain JS checks (no external dependencies).
 */

import {
  isSlateFieldType,
  getChildFields,
  getChildBlockEntries,
  getFieldValue,
} from './index.js';

// Re-export for convenience
export { isSlateFieldType };

/**
 * Validation error with context information
 */
export class ValidationError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'ValidationError';
    this.context = context; // { blockId, field, path, node }
  }
}

// ============================================================================
// Slate Validation
// ============================================================================

/**
 * Check if a node is a valid Slate text leaf.
 * Text leaves have 'text' (string) and NO 'children' or 'type'.
 */
export function isSlateTextNode(node) {
  return (
    node !== null &&
    typeof node === 'object' &&
    typeof node.text === 'string' &&
    !('children' in node) &&
    !('type' in node)
  );
}

/**
 * Check if a node is a valid Slate element.
 * Elements have 'children' array and NO 'text' property.
 */
export function isSlateElementNode(node) {
  return (
    node !== null &&
    typeof node === 'object' &&
    Array.isArray(node.children) &&
    !('text' in node)
  );
}

/**
 * Validate a Slate node recursively.
 * @returns {Array<ValidationError>}
 */
export function validateSlateNode(
  node,
  path = [],
  blockId = null,
  field = null,
) {
  const errors = [];
  const context = { blockId, field, path };

  if (!node || typeof node !== 'object') {
    errors.push(
      new ValidationError(
        `Invalid Slate node: expected object, got ${typeof node}`,
        { ...context, node },
      ),
    );
    return errors;
  }

  // CRITICAL: Detect corruption where node has BOTH text AND (type OR children)
  // This is the exact bug pattern: { text: "", type: "li", children: [...] }
  if ('text' in node && ('type' in node || 'children' in node)) {
    errors.push(
      new ValidationError(
        `Corrupted Slate node: has 'text' property but also '${
          'type' in node ? 'type' : 'children'
        }'. Text leaves must not have type/children.`,
        { ...context, node },
      ),
    );
  }

  // Validate element nodes recursively
  if (Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      const childErrors = validateSlateNode(
        node.children[i],
        [...path, i],
        blockId,
        field,
      );
      errors.push(...childErrors);
    }
  }

  return errors;
}

/**
 * Validate a Slate value (array of nodes).
 * @returns {Array<ValidationError>}
 */
export function validateSlateValue(value, blockId = null, field = 'value') {
  if (!Array.isArray(value)) {
    return [
      new ValidationError(`Slate value must be an array, got ${typeof value}`, {
        blockId,
        field,
        node: value,
      }),
    ];
  }

  const errors = [];
  for (let i = 0; i < value.length; i++) {
    errors.push(...validateSlateNode(value[i], [i], blockId, field));
  }
  return errors;
}

// ============================================================================
// Block Validation
// ============================================================================

/**
 * Get slate field names for a block type from blockFieldTypes map.
 *
 * @param {string} blockType - Block @type (e.g., 'slate', 'hero')
 * @param {Object} blockFieldTypes - Map of blockType -> fieldName -> fieldType
 * @returns {Array<string>} - Array of field names that are slate fields
 */
export function getSlateFieldsForBlockType(blockType, blockFieldTypes) {
  if (!blockType || !blockFieldTypes) {
    // Default: check 'value' field for unknown blocks
    return ['value'];
  }

  const fieldTypes = blockFieldTypes[blockType];
  if (!fieldTypes) {
    // Unknown block type - check 'value' as fallback
    return ['value'];
  }

  // Return all fields with slate type (handles both 'slate' and 'array:slate' formats)
  return Object.entries(fieldTypes)
    .filter(([_, type]) => isSlateFieldType(type))
    .map(([fieldName]) => fieldName);
}

/**
 * Validate a single block's data.
 * Checks all Slate fields within the block based on its schema.
 *
 * @param {string} blockId - Block UID
 * @param {Object} blockData - Block data object
 * @param {Object} blockFieldTypes - Map of blockType -> fieldName -> fieldType
 * @returns {Array<ValidationError>}
 */
export function validateBlock(blockId, blockData, blockFieldTypes = {}) {
  const errors = [];

  if (!blockData || typeof blockData !== 'object') {
    return errors; // Empty/null blocks are valid (will be filled later)
  }

  const blockType = blockData['@type'];
  const slateFields = getSlateFieldsForBlockType(blockType, blockFieldTypes);

  for (const fieldName of slateFields) {
    const fieldValue = getFieldValue(blockData, fieldName);
    if (fieldValue && Array.isArray(fieldValue)) {
      errors.push(...validateSlateValue(fieldValue, blockId, fieldName));
    }
  }

  return errors;
}

// ============================================================================
// Form Data Validation
// ============================================================================

/**
 * Validate entire form data structure.
 * Checks blocks, blocks_layout, and all Slate fields.
 *
 * @param {Object} formData - Full form data object
 * @param {Object} blockFieldTypes - Map of blockType -> fieldName -> fieldType (from extractBlockFieldTypes)
 * @returns {{ valid: boolean, errors: Array<ValidationError> }}
 */
export function validateFormData(formData, blockFieldTypes = {}) {
  const errors = [];

  if (!formData || typeof formData !== 'object') {
    return { valid: true, errors: [] };
  }

  const blocks = formData.blocks || {};
  const blocksLayout = formData.blocks_layout || {};

  // Validate each block
  for (const blockId of Object.keys(blocks)) {
    const blockData = blocks[blockId];
    errors.push(...validateBlock(blockId, blockData, blockFieldTypes));
  }

  // Check every region of blocks_layout references valid blocks. A blocks_layout
  // value may hold multiple named regions (sub-keys) — `items`, `footer`, etc.
  for (const region of Object.keys(blocksLayout)) {
    const ids = blocksLayout[region];
    if (!Array.isArray(ids)) continue;
    for (const blockId of ids) {
      if (!blocks[blockId]) {
        errors.push(
          new ValidationError(
            `blocks_layout region references non-existent block`,
            { blockId, field: 'blocks_layout', region },
          ),
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Logging
// ============================================================================

/**
 * Log validation errors in a human-readable format.
 *
 * @param {Array<ValidationError>} errors
 * @param {string} source - Where validation was triggered (e.g., "INLINE_EDIT_DATA", "onChangeBlock")
 */
export function logValidationErrors(errors, source = '') {
  if (errors.length === 0) return;

  console.error(
    `[VALIDATION] ${source ? `${source}: ` : ''}${errors.length} error(s) found:`,
  );

  for (const error of errors) {
    const ctx = error.context || {};
    const location = [
      ctx.blockId && `block=${ctx.blockId}`,
      ctx.field && `field=${ctx.field}`,
      ctx.path?.length && `path=[${ctx.path.join(',')}]`,
    ]
      .filter(Boolean)
      .join(' ');

    console.error(`  ${location}: ${error.message}`);
    if (ctx.node) {
      console.error(`    Node: ${JSON.stringify(ctx.node).substring(0, 200)}`);
    }
  }
}

/**
 * Validate and log errors. Returns true if valid.
 *
 * @param {Object} formData - Form data to validate
 * @param {string} source - Source identifier for logging
 * @param {Object} blockFieldTypes - Map of blockType -> fieldName -> fieldType
 * @returns {boolean}
 */
export function validateAndLog(formData, source, blockFieldTypes = {}) {
  const { valid, errors } = validateFormData(formData, blockFieldTypes);
  if (!valid) {
    logValidationErrors(errors, source);
  }
  return valid;
}

// ============================================================================
// Template Validation
// ============================================================================

/**
 * The slot-grouping rules for ONE ordered region of blocks — same-slotId contiguous, different
 * slot groups separated by a fixed block. Adds any violations to `blocksErrors`. Shared by every
 * region (page + nested container, blocks_layout + object_list) so the rules apply everywhere.
 *
 * @param {Array<{id: string, block: Object}>} entries - the region's ordered child blocks
 * @param {Object} blocksErrors - accumulator, keyed by block id
 * @param {string} region - the region, for the report (`items`, `contentLayout.main`)
 */
function validateRegionSlots(entries, blocksErrors, region) {
  const slotGroups = new Map(); // slotId -> [{ blockId, index }]
  let lastSlotId = null;

  for (let i = 0; i < entries.length; i++) {
    const { id: blockId, block } = entries[i];
    const isFixed = block?.fixed === true;

    // A template's block is matched to a page's by its slot. One that names
    // none belongs nowhere: the merge drops it, or moves it to another region on
    // every save (inka#708). Fixed blocks too, and the editor's placeholders.
    if (block?.templateId && !block.slotId) {
      blocksErrors[blockId] = {
        _layout: {
          rule: 'unnamed-slot',
          region,
          templateId: block.templateId,
          title: 'Unnamed Slot',
          message:
            `This block belongs to the template ${block.templateId} but names no slot, so ` +
            'pages using the template have nowhere to put it. Name its slot.',
        },
      };
      continue;
    }

    if (isFixed) {
      lastSlotId = null; // Reset - fixed block separates groups
      continue;
    }

    const slotId = block?.slotId;
    if (!slotId) continue;

    // Track for contiguity check
    if (!slotGroups.has(slotId)) {
      slotGroups.set(slotId, []);
    }
    slotGroups.get(slotId).push({ blockId, index: i });

    // Check: different slot groups adjacent without fixed block between
    if (lastSlotId !== null && lastSlotId !== slotId) {
      blocksErrors[blockId] = {
        _layout: {
          rule: 'fixed-between-slots',
          slots: [lastSlotId, slotId],
          region,
          title: 'Missing Fixed Block',
          message: `Slot groups "${lastSlotId}" and "${slotId}" must be separated by a fixed block.`,
        },
      };
    }

    lastSlotId = slotId;
  }

  // Check: same slotId blocks must be contiguous
  for (const [slotId, group] of slotGroups) {
    for (let i = 1; i < group.length; i++) {
      if (group[i].index !== group[i - 1].index + 1) {
        const blockId = group[i].blockId;
        // Don't overwrite if already has an error
        if (!blocksErrors[blockId]) {
          blocksErrors[blockId] = {
            _layout: {
              rule: 'slot-contiguous',
              slots: [slotId],
              region,
              title: 'Placeholder Position',
              message: `This slot block is not adjacent to others in the "${slotId}" group. Move this block or the previous one to make them contiguous.`,
            },
          };
        }
      }
    }
  }
}

/**
 * Validate template slot structure across EVERY region of the whole tree — the page's regions AND
 * every nested container's regions (blocks_layout AND object_list) — not just the page `items`
 * region. Walks region-aware via getChildFields + getChildBlockEntries, so a slot-grouping
 * violation in a footer region or inside a slider's `slides` is reported, not silently ignored.
 *
 * Rules:
 * 1. Blocks with the same slotId must be adjacent (contiguous), per region
 * 2. Different slot groups must be separated by a fixed block, per region
 * 3. A block of a template names its slot (ordinary page blocks have none)
 * 4. A slot is in one region of its template instance, not two — at every depth: a
 *    block and a block inside it never share one
 *
 * @param {Object} formData - Page data with blocks and blocks_layout
 * Each error's `_layout` also says what was found, as data: `rule` (`unnamed-slot`,
 * `fixed-between-slots`, `slot-contiguous`, `slot-in-one-place`), the `slots` and
 * `region`(s) involved — for a caller that words its own report (the content check).
 *
 * @returns {{ valid: boolean, blocksErrors: Object }} Validation result with Volto-compatible blocksErrors
 */
export function validateTemplatePlaceholders(formData, idFieldMap = null) {
  const blocksErrors = {};
  const visited = new Set();
  // A slot is one place in its template: per instance (or, on a template's own
  // page, per template), the region each slot id was first seen in.
  const slotRegions = new Map(); // instance -> Map(slotId -> region)

  const visit = (container, where) => {
    if (!container || typeof container !== 'object' || visited.has(container)) {
      return;
    }
    visited.add(container);
    // Schemas, not the merge's templateId shortcut: this is not a merge, and
    // the map names each object_list AND the key its items are addressed by.
    // Called without one, object_list regions are not walked — the slot rules
    // then skip a slider's slides or a form's subblocks in silence.
    for (const field of getChildFields(container, idFieldMap, { allObjectLists: true })) {
      const entries = getChildBlockEntries(container, field);
      const region = where ? `${where}.${field.region}` : field.region;
      validateRegionSlots(entries, blocksErrors, region);
      for (const { id: blockId, block } of entries) {
        const instance = block?.templateId && (block.templateInstanceId || block.templateId);
        if (instance && block.slotId && !blocksErrors[blockId]) {
          if (!slotRegions.has(instance)) slotRegions.set(instance, new Map());
          const seen = slotRegions.get(instance);
          const first = seen.get(block.slotId);
          if (first === undefined) seen.set(block.slotId, region);
          else if (first !== region) {
            blocksErrors[blockId] = {
              _layout: {
                rule: 'slot-in-one-place',
                slots: [block.slotId],
                regions: [first, region],
                title: 'Slot In Two Places',
                message:
                  `The slot "${block.slotId}" is in both ${first} and ${region}. A slot is one place ` +
                  'in its template: give this one its own name.',
              },
            };
          }
        }
      }
      for (const { block } of entries) visit(block, `${block?.['@type'] ?? 'block'}`);
    }
  };

  visit(formData, '');
  return { valid: Object.keys(blocksErrors).length === 0, blocksErrors };
}
