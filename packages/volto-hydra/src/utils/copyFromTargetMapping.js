/**
 * The pure core of copy-from-target: which block fields a link fills, and the
 * custom/linked record. Free of Volto (no registry, no URL helpers), so the
 * block converter (blockSync) can use it in bundles that run without Volto.
 * copyFromTarget.js re-exports all of it.
 */
import { getMappingTarget, getFieldType } from './blockSync';

/**
 * The `@target` mapping ({ sourceAttr: destField | {field,type} }) or null.
 *
 * Copy-from-target is ON BY DEFAULT: a block with a link field but no explicit
 * `@target` falls back to a normalized `@default` — so any link-bearing block
 * that already declares its canonical content shape pulls from the link without
 * extra wiring (the teaser case). An explicit `@target` always wins. A block
 * with no link field (nothing to pull from) returns null.
 */
export function getTargetMapping(blockConfig) {
  const explicit = blockConfig?.fieldMappings?.['@target'];
  if (explicit && Object.keys(explicit).length > 0) return explicit;

  const def = blockConfig?.fieldMappings?.['@default'];
  if (!def || !getUrlField(blockConfig)) return null;

  // Pass-through, same contract as the listing expander (helpers `convertFieldValue`
  // + `widgetToTargetType`): copy every declared source key VERBATIM to its dest
  // field; the value's type is derived from the dest field's widget at pull time,
  // so `title`, `description`, `Subject`, `created`, `image`, … all flow with no
  // per-field wiring. `@id` is the link itself (it already populates the url field),
  // never a pulled display field, so it is the one key skipped.
  const synthesized = {};
  for (const [source, dest] of Object.entries(def)) {
    if (source === '@id') continue;
    const destField = getMappingTarget(dest);
    if (!destField) continue;
    synthesized[source] = destField;
  }
  return Object.keys(synthesized).length > 0 ? synthesized : null;
}

/**
 * The fields of a block's schema, whether it is an object or a FUNCTION of the
 * block's data (an admin block's often is: Volto's teaser and image). Only the
 * fields' kinds are read here — which is the link, which widget a destination
 * has — so labels are irrelevant and a schema function is given an `intl`
 * that answers with each message's default text.
 */
const DEFAULT_TEXT_INTL = { formatMessage: (message) => message.defaultMessage };
export function schemaProperties(blockConfig, blockData) {
  const schema = blockConfig?.blockSchema;
  const resolved =
    typeof schema === 'function'
      ? schema({ formData: blockData, data: blockData, intl: DEFAULT_TEXT_INTL })
      : schema;
  return resolved?.properties || {};
}

/** Destination (block) field names the @target mapping writes to. */
export function targetDestinations(mapping) {
  return new Set(
    Object.values(mapping).map(getMappingTarget).filter(Boolean),
  );
}

/**
 * The block's link/url field — where the target snapshot (selectedItemAttrs)
 * lives. It's just the link-typed field in the schema ("the url is the link in
 * the fieldmapping"). Returns the field name or null.
 */
export function getUrlField(blockConfig) {
  const props = schemaProperties(blockConfig, {});
  for (const [name, def] of Object.entries(props)) {
    if (getFieldType(def) === 'link') return name;
  }
  return null;
}

/** Block key holding the set of fields the editor has taken CUSTOM (overridden). */
export const CUSTOM_FIELDS_KEY = '_customFields';

/** Return blockData with `field` marked custom (immutable). */
export function withFieldCustom(blockData, field) {
  const set = new Set(blockData?.[CUSTOM_FIELDS_KEY] || []);
  set.add(field);
  return { ...blockData, [CUSTOM_FIELDS_KEY]: [...set] };
}
