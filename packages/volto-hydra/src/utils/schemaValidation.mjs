/**
 * Schema Validation Utilities — pure, dependency-free.
 *
 * These mirror the per-block validation Hydra runs in
 * `applySchemaDefaultsToFormData` (blockSync.js). Extracted here as
 * pure functions so they can be reused from test runners, CI gates, and any
 * other tool that needs to know "would Hydra strip this value on load?"
 * without pulling in Volto's registry / React contexts / blockPath helpers.
 *
 * Originally lived inline in `./blockSync.js`; that module now
 * re-exports from here. Single source of truth.
 *
 * NO imports. Keep it that way — that's the whole point.
 */

/**
 * Check if a value is valid for a field definition.
 * Returns true if valid, false if invalid.
 *
 * For Choice fields with `choices`: value must be one of the allowed choices —
 *   or, where the field takes SEVERAL of them, a list of them.
 * For `enum` fields (JSON Schema style): value must be in enum.
 * For objects with `propertyNames.enum`: every key must be allowed.
 * For objects with `additionalProperties.enum`: every non-empty value must be allowed.
 * Otherwise (no constraints): always valid.
 */

/** The tokens a `choices` list allows, however each entry is written. */
function choiceTokens(choices) {
  return new Set(
    choices.map((c) => {
      if (c === undefined || c === null) return c;
      if (Array.isArray(c)) return c[0];
      return c.value ?? c.token ?? c;
    }),
  );
}

export function isValidValue(value, fieldDef) {
  // For choice fields: check if value is one of the allowed choices.
  //
  // A field can take SEVERAL of them, and then it holds an array — Volto's
  // ArrayWidget is `type: 'array'` with these same `choices`, and hands back a
  // list of tokens. Each ELEMENT is what has to be in the vocabulary; the list
  // itself never is, so comparing it whole failed every multi-select there is.
  // Not cosmetically: `applySchemaDefaultsToBlock` nulls what this rejects, so
  // loading a page in the editor emptied the field — no edit, no save, no word
  // said. (Found on a form block's `send: ['recipient']`, the setting that
  // decides whether a submission is emailed to anyone: opening the page stopped
  // the form mailing.)
  //
  // `items.choices` is the same declaration in JSON Schema's shape, which is how
  // plone.restapi serialises a List of Choice.
  const choices = fieldDef.choices ?? fieldDef.items?.choices;
  if (choices) {
    const validValues = choiceTokens(choices);
    return Array.isArray(value)
      ? value.every((v) => validValues.has(v))
      : validValues.has(value);
  }

  // Button-bar widgets (ButtonsWidget: size/align/layout) declare their options
  // in `actions` (the array of button values). Same contract as `choices` — the
  // editor only offers these, so a stored value outside them can't be authored.
  if (Array.isArray(fieldDef.actions)) {
    return fieldDef.actions.includes(value);
  }

  // For enum fields (JSON Schema style)
  if (fieldDef.enum) {
    return fieldDef.enum.includes(value);
  }

  // For objects with propertyNames.enum - validate each property key
  if (fieldDef.propertyNames?.enum && typeof value === 'object' && value !== null) {
    const validKeys = new Set(fieldDef.propertyNames.enum);
    if (!Object.keys(value).every((k) => validKeys.has(k))) {
      return false;
    }
  }

  // For objects with additionalProperties.enum - validate each property value
  if (fieldDef.additionalProperties?.enum && typeof value === 'object' && value !== null) {
    const validValues = new Set(fieldDef.additionalProperties.enum);
    const invalidValues = Object.entries(value).filter(([k, v]) => v && !validValues.has(v));
    if (invalidValues.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[isValidValue] Invalid values found:', invalidValues, 'validValues:', [...validValues]);
      return false;
    }
  }

  // No validation constraints - value is valid
  return true;
}

/**
 * Apply schema defaults to a block.
 *
 * Two passes:
 *   1. For each field, if `isValidValue(currentValue, fieldDef)` is false,
 *      null it. (This is the strip that surprises content authors.)
 *   2. For each field where the schema has a `default` and the current
 *      value is empty (undefined, null, or {}), apply the default.
 *
 * Returns the original blockData reference (not a copy) when nothing was
 * modified — callers rely on this to detect no-op updates cheaply.
 *
 * @param {Object} blockData - The block's current data
 * @param {Object} schema - The block's schema (with enhancers already applied)
 * @returns {Object} - Block data with defaults applied (or original if no changes)
 */
export function applySchemaDefaultsToBlock(blockData, schema) {
  if (!schema?.properties || !blockData) return blockData;

  let modified = false;
  const newData = { ...blockData };

  for (const [fieldName, fieldDef] of Object.entries(schema.properties)) {
    // widget:'object' — recurse so the object's OWN fields (block.content.*)
    // get their defaults/validation too. Descend objects only; a region
    // (object_list/blocks_layout) is a container handled elsewhere and must NOT
    // be walked here.
    if (fieldDef.widget === 'object' && fieldDef.schema?.properties) {
      const current = newData[fieldName];
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        const nested = applySchemaDefaultsToBlock(current, fieldDef.schema);
        if (nested !== current) {
          newData[fieldName] = nested;
          modified = true;
        }
      }
      continue;
    }

    const currentValue = blockData[fieldName];

    // First: validate current value - clear if invalid
    if (currentValue !== undefined && currentValue !== null) {
      if (!isValidValue(currentValue, fieldDef)) {
        newData[fieldName] = null;
        modified = true;
      }
    }
  }

  // Second pass: apply defaults to empty/null fields
  for (const [fieldName, fieldDef] of Object.entries(schema.properties)) {
    if (fieldDef.widget === 'object') continue; // handled by recursion above
    if (fieldDef.default === undefined) continue;

    const currentValue = newData[fieldName];

    // Check if current value is "empty" (needs default)
    const needsDefault =
      currentValue === undefined ||
      currentValue === null ||
      (typeof currentValue === 'object' &&
        !Array.isArray(currentValue) &&
        Object.keys(currentValue).length === 0);

    if (needsDefault) {
      newData[fieldName] = fieldDef.default;
      modified = true;
    }
  }

  return modified ? newData : blockData;
}

/**
 * Apply schema defaults to a block, with support for function defaults.
 * Function defaults receive context: { containerId, field, position, allBlocks, blockPathMap }
 *
 * @param {Object} blockData - The block's current data
 * @param {Object} schema - The block's schema (with enhancers applied)
 * @param {Object} context - Context for function defaults
 * @returns {Object} - Block data with defaults applied (or original if no changes)
 */
export function applySchemaDefaultsToBlockWithContext(blockData, schema, context = {}) {
  if (!schema?.properties || !blockData) return blockData;

  let modified = false;
  const newData = { ...blockData };

  for (const [fieldName, fieldDef] of Object.entries(schema.properties)) {
    // widget:'object' — recurse (with context, for function defaults on nested
    // fields). Descend objects only, never a region.
    if (fieldDef.widget === 'object' && fieldDef.schema?.properties) {
      const current = newData[fieldName];
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        const nested = applySchemaDefaultsToBlockWithContext(current, fieldDef.schema, context);
        if (nested !== current) {
          newData[fieldName] = nested;
          modified = true;
        }
      }
      continue;
    }

    const currentValue = blockData[fieldName];
    if (currentValue !== undefined && currentValue !== null) {
      if (!isValidValue(currentValue, fieldDef)) {
        newData[fieldName] = null;
        modified = true;
      }
    }
  }

  for (const [fieldName, fieldDef] of Object.entries(schema.properties)) {
    if (fieldDef.widget === 'object') continue; // handled by recursion above
    if (fieldDef.default === undefined) continue;

    const currentValue = newData[fieldName];

    const needsDefault =
      currentValue === undefined ||
      currentValue === null ||
      (typeof currentValue === 'object' &&
        !Array.isArray(currentValue) &&
        Object.keys(currentValue).length === 0);

    if (needsDefault) {
      const defaultValue = typeof fieldDef.default === 'function'
        ? fieldDef.default(context)
        : fieldDef.default;

      if (defaultValue !== undefined) {
        newData[fieldName] = defaultValue;
        modified = true;
      }
    }
  }

  return modified ? newData : blockData;
}
