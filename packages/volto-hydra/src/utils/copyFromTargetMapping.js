/**
 * The pure core of copy-from-target: which block fields a link fills, and the
 * record of which ones it owns. Free of Volto (no registry, no URL helpers), so
 * the block converter (blockSync) can use it in bundles that run without Volto.
 * copyFromTarget.js re-exports all of it.
 *
 * A block SAYS what the link owns, in `_pullFrom`:
 *
 *   "_pullFrom": { "href": ["title", "description"] }
 *
 * read as "pull those fields from `href`". Nothing else is pulled.
 *
 * The record used to be the inverse — `_customFields` listed the exceptions, so
 * a field ABSENT from it was pulled. Absence is what every writer that is not
 * the editor's own form produces: `plone.exportimport`, the restapi, and
 * `edit_blocks` over MCP all write a title and no record, so an authored title
 * was replaced by the link target's on the next page open (inka#595). The
 * editor can carry meaning in code and in UI labels; an agent has neither
 * channel, so what decides whether an author's words survive has to be a value
 * on the block.
 *
 * Absence now means nothing is pulled. An EMPTY list is not absence: it names a
 * source that owns nothing, which is the state after unticking every toggle,
 * and it is what lets the sidebar still offer re-linking.
 */
import { getMappingTarget, getFieldType } from './blockSync';

/** Block key holding, per link field, the fields that link owns. */
export const PULL_FROM_KEY = '_pullFrom';

/** Mapping keys that name machinery rather than a target attribute to copy. */
const MAPPING_META = new Set(['@id', '@source']);

/**
 * The `@target` mapping ({ sourceAttr: destField | {field,type} }) or null.
 *
 * Copy-from-target is ON BY DEFAULT: a block with a link field but no explicit
 * `@target` falls back to a normalized `@default` — so any link-bearing block
 * that already declares its canonical content shape can pull from the link
 * without extra wiring (the teaser case). An explicit `@target` always wins. A
 * block with no link field (nothing to pull from) returns null.
 *
 * `@id` and `@source` are stripped: both name the LINK itself rather than an
 * attribute to copy onto a field. Left in, `@source` would read as a mapping
 * whose destination is the link field.
 */
export function getTargetMapping(blockConfig) {
  const explicit = blockConfig?.fieldMappings?.['@target'];
  if (explicit && Object.keys(explicit).length > 0) {
    const out = {};
    for (const [source, dest] of Object.entries(explicit)) {
      if (MAPPING_META.has(source)) continue;
      out[source] = dest;
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  const def = blockConfig?.fieldMappings?.['@default'];
  if (!def || linkFields(blockConfig).length === 0) return null;

  // Pass-through, same contract as the listing expander (helpers `convertFieldValue`
  // + `widgetToTargetType`): copy every declared source key VERBATIM to its dest
  // field; the value's type is derived from the dest field's widget at pull time,
  // so `title`, `description`, `Subject`, `created`, `image`, … all flow with no
  // per-field wiring.
  const synthesized = {};
  for (const [source, dest] of Object.entries(def)) {
    if (MAPPING_META.has(source)) continue;
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

/** Every link-typed field the block declares, in schema order. */
export function linkFields(blockConfig) {
  return Object.entries(schemaProperties(blockConfig, {}))
    .filter(([, def]) => getFieldType(def) === 'link')
    .map(([name]) => name);
}

/**
 * The link field a pull reads its target from — DECLARED, never guessed.
 *
 * In order: an explicit `@target`'s `'@source'`; else `@default`'s `'@id'`
 * entry, which already states where the target's identity lands; else the one
 * link field, when a block has exactly one.
 *
 * A block with several link fields and no declaration THROWS. The old version
 * took the first link field in schema order, which is not a rule — in a real
 * site config that picked a hero's *video file* over its button link, and a
 * button's dead `url: 'Link (legacy)'` over the `href` the author picks with.
 * Both were quiet only because a legacy string yields no `[0]['@id']`; tidying
 * the legacy field away would have woken them.
 *
 * Returns null for a block with no link field at all.
 */
export function getSourceField(blockConfig) {
  const declared = blockConfig?.fieldMappings?.['@target']?.['@source'];
  if (declared) return declared;

  const fromDefault = getMappingTarget(
    blockConfig?.fieldMappings?.['@default']?.['@id'],
  );
  if (fromDefault) return fromDefault;

  const links = linkFields(blockConfig);
  if (links.length === 0) return null;
  if (links.length === 1) return links[0];
  throw new Error(
    `${blockConfig?.id || 'block'} declares several link fields (${links.join(', ')}) ` +
      `and none of them as the pull source. Name it with fieldMappings['@target']['@source'], ` +
      `or map the target's '@id' to it in fieldMappings['@default'].`,
  );
}

/** The link field `field` is pulled from, per the block's record, or null. */
export function sourceFieldFor(field, blockData) {
  const record = blockData?.[PULL_FROM_KEY];
  if (!record) return null;
  for (const [linkField, fields] of Object.entries(record)) {
    if (Array.isArray(fields) && fields.includes(field)) return linkField;
  }
  return null;
}

/** Whether the block says a link owns `field`. */
export function isFieldPulled(field, blockData) {
  return sourceFieldFor(field, blockData) !== null;
}

/** Return blockData with `field` pulled from `linkField` (immutable). */
export function withFieldPulled(blockData, field, linkField) {
  const record = blockData?.[PULL_FROM_KEY] || {};
  const listed = record[linkField] || [];
  if (listed.includes(field)) return blockData;
  return {
    ...blockData,
    [PULL_FROM_KEY]: { ...record, [linkField]: [...listed, field] },
  };
}

/**
 * Return blockData with `field` no longer pulled — the author has claimed it.
 *
 * The source KEY stays even when its list empties. Dropping it would forget
 * which link the fields came from, which is the mistake the old
 * `withFieldLinked` made in mirror image (it deleted `_customFields` on empty).
 */
export function withFieldNotPulled(blockData, field) {
  const linkField = sourceFieldFor(field, blockData);
  if (!linkField) return blockData;
  const record = blockData[PULL_FROM_KEY];
  return {
    ...blockData,
    [PULL_FROM_KEY]: {
      ...record,
      [linkField]: record[linkField].filter((f) => f !== field),
    },
  };
}

/** A field holds nothing an author would miss. */
const isEmptyValue = (value) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

/**
 * The mapped fields a fresh link pick should link: the EMPTY ones.
 *
 * Picking a link must not overwrite words already written, so a field that
 * holds something stays the author's. This is Volto's own guard on its teaser
 * (`if (id === 'href' && !isEmpty(value) && !data.title && !data.description)`),
 * kept rather than reinvented.
 */
export function fieldsToPullOnPick(blockConfig, blockData) {
  const mapping = getTargetMapping(blockConfig);
  if (!mapping) return [];
  const properties = schemaProperties(blockConfig, blockData);
  const out = [];
  for (const dest of targetDestinations(mapping)) {
    if (!properties[dest]) continue;
    if (!isEmptyValue(blockData?.[dest])) continue;
    out.push(dest);
  }
  return out;
}
