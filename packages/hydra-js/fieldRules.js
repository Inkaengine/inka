/**
 * fieldRules — the rule language a block's schemaEnhancer recipe declares
 * (`{ fieldRules: { field: rule } }`): show, hide or redefine a field, and
 * flag it with an `error` (blocks the save) or a `warning` (advice), when a
 * `when` condition over the block's data, its parent's, the page's, or its
 * position holds.
 *
 * Lives in hydra-js — no Volto, no React — so everything that has to agree
 * on what a rule means can share ONE implementation: the admin (blockSync's
 * recipe converter), buildBlockPathMap's offline gates, and the content
 * validator (`plone-content schema --schemas`), which reports every
 * `hydraRuleError` / `hydraRuleWarning` a rule sets on stored content.
 *
 * The admin keeps live state a rule can read — the schema context (the block
 * being edited, its path map) and each block's unsaved form data — and
 * registers it with setFieldRulesContextProvider. Offline callers pass
 * `blockId`, `blockPathMap` and `pageFormData` in the enhancer args and need
 * no provider.
 */

import {
  resolveFieldPath as resolveBlockFieldPath,
  getFieldValue,
  getFieldDef,
  getFieldTypeString,
  getBlockType,
  getChildBlockEntries,
  isSlateFieldType,
  slateNodesText,
} from '../helpers/index.js';
import { isObjectListRegion } from './regionWidgets.js';

// Same value as PAGE_BLOCK_UID in hydra.js — defined locally to avoid
// importing from @volto-hydra/hydra-js (which would pull in Volto deps).
const PAGE_BLOCK_UID = '_page';

let contextProvider = null;
let liveBlockDataProvider = null;

/**
 * Register the admin's live state: `context()` is where a rule finds the
 * current block and path map when the enhancer is called without them, and
 * `liveBlockData(blockId, fallback)` returns a block's data as the form holds
 * it right now (unsaved edits included). Offline callers register nothing: a
 * rule then reads another block from the page data it was given, by the path
 * buildBlockPathMap recorded for it.
 */
export function setFieldRulesContextProvider({ context, liveBlockData } = {}) {
  contextProvider = context || null;
  liveBlockDataProvider = liveBlockData || null;
}

/** A block's data, by the path the block path map recorded for it. */
function blockFromPath(formData, blockPathMap, blockId) {
  const path = blockPathMap?.[blockId]?.path;
  if (!formData || !Array.isArray(path)) return null;
  return path.reduce((node, key) => (node == null ? node : node[key]), formData);
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
export function createFieldRulesEnhancer(rulesConfig) {
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

export function evaluateFieldRule(rule, formData, args) {
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
/**
 * The element types in a slate value, in document order (a node before the
 * nodes inside it): `[p, strong]` for a paragraph with bold text in it. Text
 * leaves have no type and are not listed.
 * @private
 */
function slateElementTypes(value) {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n && typeof n === 'object' && Array.isArray(n.children)) {
        if (typeof n.type === 'string') out.push(n.type);
        walk(n.children);
      }
    }
  };
  walk(value);
  return out;
}

/** A slate value: a non-empty list of element nodes. @private */
function isSlateValue(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((n) => n && typeof n === 'object' && Array.isArray(n.children))
  );
}

/**
 * The element types of every slate field a block holds — its own fields only;
 * the blocks inside a container are visited as blocks in their own right.
 *
 * Read off the VALUE: a rule about another block has no schema for it (only
 * the current block's is in `args.schema`), and a slate value is unambiguous
 * by shape — a list of nodes that each have `children`.
 * @private
 */
function blockStyles(block) {
  if (!block || typeof block !== 'object') return [];
  const out = [];
  for (const [key, value] of Object.entries(block)) {
    if (key === 'blocks' || key === 'blocks_layout') continue;
    if (isSlateValue(value)) out.push(...slateElementTypes(value));
  }
  return out;
}

/**
 * The page's blocks in READING ORDER: the order the page lays them out —
 * regions in the order the parent's data lists them, each region's blocks in
 * order, and a container before the blocks inside it. Built from the block
 * path map (every block's parent and region) and the parents' own layout.
 * Cached per path map: the map is rebuilt whenever the structure changes.
 * @private
 */
const readingOrderCache = new WeakMap();

function readingOrder(pageFormData, blockPathMap, blockData) {
  if (!blockPathMap || !pageFormData) return null;
  const cached = readingOrderCache.get(blockPathMap);
  if (cached) return cached;
  const children = new Map();
  for (const [id, entry] of Object.entries(blockPathMap)) {
    if (id === '_schemas' || !entry || typeof entry !== 'object' || !entry.parentId) continue;
    if (!children.has(entry.parentId)) children.set(entry.parentId, []);
    children.get(entry.parentId).push(id);
  }
  const placeOf = (parentId, id) => {
    const entry = blockPathMap[id];
    const parent = parentId === PAGE_BLOCK_UID ? pageFormData : blockData(parentId);
    const holder = (entry.regionPath || []).reduce((n, k) => (n == null ? n : n[k]), parent);
    const regions = Object.keys(holder?.blocks_layout || {});
    if (entry.isObjectListItem) {
      const tail = entry.path[entry.path.length - 1];
      const rank = Object.keys(holder || {}).indexOf(entry.region);
      return [regions.length + Math.max(rank, 0), typeof tail === 'number' ? tail : 0];
    }
    return [
      Math.max(regions.indexOf(entry.region), 0),
      (holder?.blocks_layout?.[entry.region] || []).indexOf(id),
    ];
  };
  const order = [];
  const visit = (parentId) => {
    const kids = (children.get(parentId) || [])
      .map((id) => [id, placeOf(parentId, id)])
      .sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]);
    for (const [id] of kids) {
      order.push(id);
      visit(id);
    }
  };
  visit(PAGE_BLOCK_UID);
  readingOrderCache.set(blockPathMap, order);
  return order;
}

const READING_ORDER_FIELDS = /^@(styles|types)(Before|After)$/;

function resolveWhenField(fieldPath, formData, args) {
  const hydraContext = contextProvider?.();
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
  // Reading-order surfaces — what comes before / after this block on the page,
  // nearest first: `@stylesBefore`/`@stylesAfter` list the slate element types
  // of that text, `@typesBefore`/`@typesAfter` the block types. They read the
  // whole page, so they need the path map and the page's data; without them
  // (buildBlockPathMap's generic first pass) the answer is unknown — unset.
  const readingField = fieldName.replace(/^(?:\.\.\/)+/, '').match(READING_ORDER_FIELDS);
  if (readingField) {
    const pageFormData = args?.pageFormData || hydraContext?.formData;
    const dataOf = (id) =>
      liveBlockDataProvider
        ? liveBlockDataProvider(id, { formData: pageFormData, blockPathMap })
        : blockFromPath(pageFormData, blockPathMap, id);
    const order = readingOrder(pageFormData, blockPathMap, dataOf);
    const at = order ? order.indexOf(targetBlockId) : -1;
    if (at < 0) return { kind: 'unset', fieldPath };
    const [, what, side] = readingField;
    const ids = side === 'Before' ? order.slice(0, at).reverse() : order.slice(at + 1);
    const value = ids.flatMap((id) => {
      const data = dataOf(id);
      if (what === 'types') return [getBlockType(data)];
      const styles = blockStyles(data);
      return side === 'Before' ? styles.reverse() : styles;
    });
    return { kind: 'array', value, fieldPath };
  }

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
    block = liveBlockDataProvider
      ? liveBlockDataProvider(targetBlockId, { formData: args?.pageFormData, blockPathMap })
      : blockFromPath(args?.pageFormData, blockPathMap, targetBlockId);
  }

  // `a.b.0.c` addresses field `a` and then walks into its value. A field's own
  // name never contains a dot, so the split is unambiguous.
  const [headField, ...valuePath] = fieldName.split('.');
  if (valuePath.length > 0) fieldName = headField;

  // `<field>@styles` — the element types in a slate field, in document order.
  if (fieldName.endsWith('@styles')) {
    const value = block ? getFieldValue(block, fieldName.slice(0, -'@styles'.length)) : undefined;
    return { kind: 'array', value: slateElementTypes(value), fieldPath };
  }

  const def = schema ? getFieldDef(schema, fieldName) : undefined;

  // REGION → array of child block TYPES. object_list via widget, blocks_layout via
  // the shared dict (incl. empty) OR a schema-declared blocks_layout field (so a
  // region with no data yet — e.g. pass-1 resolution with formData={} — counts 0
  // rather than throwing on a numeric op, mirroring object_list). A typed
  // object_list stores its type in a `typeField`; blocks_layout children carry
  // `@type` — getBlockType handles both.
  // A plain list (`subBlocks: false`) is a value, not a region.
  const isObjectList = isObjectListRegion(def);
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
export function evaluateWhenCondition(when, formData, args) {
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
 *   firstOf           — array: narrow to its first item in the set; the other
 *                       operators then apply to that item (unset when none)
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
  // firstOf — narrow a list to its first item that is in the set; the other
  // operators then apply to that item ("the nearest heading before me is an
  // h2"). No such item is unset, so only the presence questions can match.
  if ('firstOf' in operators) {
    assertKind('firstOf', surface, ['array']);
    const set = requireSet('firstOf', operators.firstOf);
    const found = value.find((v) => set.includes(v));
    const { firstOf: _firstOf, ...rest } = operators;
    return evaluateOperators(
      found === undefined
        ? { kind: 'unset', fieldPath: surface.fieldPath }
        : { kind: 'string', value: found, fieldPath: surface.fieldPath },
      rest,
    );
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
