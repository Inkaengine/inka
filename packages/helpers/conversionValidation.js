/**
 * Conversion graph: which block types can become which, and whether that graph
 * is actually navigable.
 *
 * Pure module — no React, no Volto config, no DOM. That matters: a consuming
 * frontend's block-sanity gate imports it straight from Playwright
 * (@volto-hydra/helpers/conversionValidation.js). The admin's blockSync.js
 * re-exports every name here; THIS file is the SSOT.
 */

import { ADDRESS_SOURCE, RETIRED_ADDRESS_SOURCE } from './catalogAddress.js';
import { CATALOG_SOURCE_KINDS, SOURCE_TYPES, conversionFor, isAccepted, sourceKind, targetKind, widgetToTargetType } from './mappingConversions.js';

export const DEFAULT_TYPE_FIELDS = new Set(Object.keys(CATALOG_SOURCE_KINDS));

/**
 * The catalog fields a registry's `@default` mappings may read, each with its
 * kind: Inka's standard ones, and every source a mapping widget declares in its
 * `sourceFields`. Inka can't know a site's catalog (a site adds metadata
 * columns: a file's type, a page count); the frontend says which it has there.
 * A declared source of a type Inka has no conversion for is left out (and
 * reported by fieldMappingProblems).
 *
 * @param {Object} blocksConfig - the full block registry
 * @returns {Object} source → kind
 */
export function catalogSourceKinds(blocksConfig) {
  const kinds = { ...CATALOG_SOURCE_KINDS };
  const visit = (properties) => {
    for (const def of Object.values(properties || {})) {
      if (def?.widget === 'field_mapping') {
        for (const [source, sourceDef] of Object.entries(def.sourceFields || {})) {
          if (source !== ADDRESS_SOURCE && !SOURCE_TYPES.includes(sourceDef?.type)) continue;
          if (source === RETIRED_ADDRESS_SOURCE || source in kinds) continue;
          kinds[source] = sourceKind(source, sourceDef);
        }
      }
      if (def?.widget === 'object' && def.schema) visit(def.schema.properties);
    }
  };
  for (const [type, config] of Object.entries(blocksConfig || {})) visit(propertiesOf(config, type));
  return kinds;
}

/**
 * Check if a block config has a valid @default mapping.
 * Valid means all keys are catalog fields (catalogSourceKinds).
 */
export function hasValidDefault(blockConfig, catalogKinds) {
  if (!catalogKinds) throw new Error('hasValidDefault needs the registry\'s catalogSourceKinds');
  const defaultMapping = blockConfig?.fieldMappings?.['@default'];
  if (!defaultMapping) return false;
  return Object.keys(defaultMapping).every(key => key in catalogKinds);
}

/**
 * Structural signature of a block: which fields it has, and what kind each is.
 *
 * Two blocks with the same signature are interchangeable to an author — the
 * same data in the same arrangement, drawn differently — so they should be
 * convertible. Container fields recurse into their item schema, because an
 * object_list of {title, description} and an object_list of {title, href} are
 * NOT the same shape even though both are "an object_list called items".
 *
 * Returns null when the block has no schema. Unknown shape is not equal shape;
 * a registry full of schema-less blocks must not read as one giant clash.
 */
export function shapeSignature(blockConfig) {
  const properties = blockConfig?.blockSchema?.properties;
  if (!properties || typeof properties !== 'object') return null;
  const parts = Object.keys(properties)
    .sort()
    .map(name => {
      const field = properties[name];
      const kind = field?.widget || field?.type || 'unknown';
      const nested = field?.schema?.properties;
      if (nested) {
        const inner = Object.keys(nested)
          .sort()
          .map(k => `${k}:${nested[k]?.widget || nested[k]?.type || 'unknown'}`)
          .join(',');
        return `${name}:${kind}{${inner}}`;
      }
      return `${name}:${kind}`;
    });
  return parts.length > 0 ? parts.join('|') : null;
}

/**
 * Is this block (or its object_list items) shaped like a listing item?
 *
 * A listing item is a content result: a title, and at least one more of the
 * canonical @default fields — description, image, a link, a date, Subject.
 * A block whose own fields are those fields IS a rendering of a search result
 * whether or not anyone wired it up, so it should be reachable from a listing
 * via fieldMappings['@default'].
 *
 * `title` alone doesn't count: a section heading has a title and is nothing
 * like a search result. Requiring a second canonical field is what separates
 * "happens to have a title" from "is an item".
 *
 * Looks through an object_list at the ITEM shape, because features / process /
 * testimonials hold their listing-item-shaped content one level down — those
 * are exactly the blocks an author wants to point a listing at.
 */
function isListingItemShaped(blockConfig) {
  const properties = blockConfig?.blockSchema?.properties;
  if (!properties) return false;

  // What ties a block to a content OBJECT: a link, a picture of it, when it
  // happened, how it's tagged. `description` is deliberately absent — every
  // container block has a title+description heading, and treating that pair as
  // an item flagged the form block as a search result.
  const IDENTIFYING = new Set([
    '@id', 'href', 'link', 'url',
    'image', 'preview_image', 'preview_image_link', 'hasPreviewImage',
    'created', 'modified', 'effective', 'expires', 'start', 'end',
    'Subject', 'subjects',
  ]);

  const looksLikeItem = (props) => {
    if (!props) return false;
    const names = Object.keys(props);
    return names.includes('title') && names.some(n => IDENTIFYING.has(n));
  };

  if (looksLikeItem(properties)) return true;
  return Object.values(properties).some(
    field => field?.widget === 'object_list' && looksLikeItem(field?.schema?.properties),
  );
}

/**
 * Validate the conversion graph across the WHOLE registry.
 *
 * fieldMappingProblems() checks each mapping against the schemas it names; it is blind to the
 * two failures that actually strand authors — and both fail silently, because
 * the symptom is an absence: a dropdown that offers nothing.
 *
 *   no-mappings        No block declares fieldMappings at all. Every
 *                      getConvertibleTypes() call returns [] and block
 *                      conversion is, in effect, not shipped.
 *   unreachable-shape  Two blocks share a shape but no common conversion
 *                      target. Reachability is transitive and a shared hub is
 *                      enough — a direct edge between the pair is not required.
 *   unknown-target     A mapping names a block type that isn't registered
 *                      (typo, or a block that was renamed/removed). The edge
 *                      silently never forms.
 *
 * @param {Object} blocksConfig - the full block configuration registry
 * @returns {Array<{rule: string, message: string, types?: string[]}>} problems
 */
export function validateConversionRegistry(blocksConfig) {
  if (!blocksConfig || Object.keys(blocksConfig).length === 0) {
    // Refuse to answer about an empty registry. Reporting "no block declares
    // fieldMappings" here would be true and useless — the caller handed us
    // nothing, which is a different bug from a registry that forgot mappings.
    throw new Error(
      'validateConversionRegistry: refusing to validate an empty registry. ' +
      'Pass config.blocks.blocksConfig after INIT.',
    );
  }

  const problems = [];
  const types = Object.keys(blocksConfig);

  // --- rule: unknown-target -------------------------------------------------
  for (const type of types) {
    const mappings = blocksConfig[type]?.fieldMappings;
    if (!mappings) continue;
    for (const target of Object.keys(mappings)) {
      if (target === '@default') continue;
      if (!blocksConfig[target]) {
        problems.push({
          rule: 'unknown-target',
          types: [type],
          message:
            `Block "${type}" declares fieldMappings["${target}"], but no block ` +
            `type "${target}" is registered. The conversion edge never forms.`,
        });
      }
    }
  }

  // --- rule: no-mappings ----------------------------------------------------
  const withMappings = types.filter(t => blocksConfig[t]?.fieldMappings);
  if (withMappings.length === 0) {
    problems.push({
      rule: 'no-mappings',
      types: [],
      message:
        `Conversion is unavailable across the entire registry: no block declares ` +
        `fieldMappings (${types.length} block types checked). Every ` +
        `getConvertibleTypes() call returns [], so the block-type dropdown is ` +
        `empty everywhere.`,
    });
    // Rule 2 would now fire for every same-shape pair, all with the same root
    // cause. Report the cause once instead of the fallout many times.
    return problems;
  }


  // --- rule: missing-default -----------------------------------------------
  // Anything shaped like a listing item should be produceable FROM a listing.
  for (const type of types) {
    if (!isListingItemShaped(blocksConfig[type])) continue;
    if (blocksConfig[type]?.fieldMappings?.['@default']) continue;
    problems.push({
      rule: 'missing-default',
      types: [type],
      message:
        `Block "${type}" is shaped like a listing item (title plus other ` +
        `content fields) but declares no fieldMappings['@default'], so it can ` +
        `never be produced from a listing and no listing can be pointed at it. ` +
        `Add fieldMappings: { '@default': { title: '…', description: '…' } } ` +
        `mapping the canonical item fields onto this block's own field names.`,
    });
  }

  // --- rule: unreachable-shape ---------------------------------------------
  const byShape = new Map();
  for (const type of types) {
    const signature = shapeSignature(blocksConfig[type]);
    if (!signature) continue;
    if (!byShape.has(signature)) byShape.set(signature, []);
    byShape.get(signature).push(type);
  }

  // Reachable set per type, including the type itself: A and B have a common
  // target if A can become B, B can become A, or both can become some C.
  const reach = new Map(
    types.map(t => [
      t,
      new Set([t, ...getConvertibleTypes(t, blocksConfig).map(c => c.type)]),
    ]),
  );

  for (const [signature, group] of byShape) {
    if (group.length < 2) continue;
    const stranded = group.filter(a =>
      group.some(b => {
        if (a === b) return false;
        for (const target of reach.get(a)) {
          if (reach.get(b).has(target)) return false;
        }
        return true;
      }),
    );
    if (stranded.length > 0) {
      problems.push({
        rule: 'unreachable-shape',
        types: stranded,
        message:
          `Blocks ${stranded.map(t => `"${t}"`).join(', ')} have the same shape ` +
          `(${signature}) but share no common conversion target, so an author ` +
          `who picks the wrong one cannot switch. Add fieldMappings pointing ` +
          `them at a common type — reachability is transitive, so one shared ` +
          `hub is enough.`,
      });
    }
  }

  return problems;
}

/**
 * Get block types that the given source type can be converted to.
 *
 * Scans all blocks to find ones reachable from the source type through
 * fieldMappings. Types without fieldMappings never appear in results.
 *
 * Edge rules:
 * - Explicit fieldMappings[currentType] always creates an edge.
 * - @default only creates an edge if BOTH types have valid @default mappings
 *   (keys from the canonical set: @id, title, description, image).
 *   Types with invalid @default keys (e.g., form fields, facets) are ignored.
 *
 * @param {string} sourceType - The current block's @type
 * @param {Object} blocksConfig - Block configuration registry
 * @returns {Array} - Array of { type, title } objects for convertible types
 */
export function getConvertibleTypes(sourceType, blocksConfig, allowedTypes = null) {
  if (!sourceType || !blocksConfig) return [];

  // Source block must have fieldMappings defined to be convertible
  const sourceConfig = blocksConfig[sourceType];
  if (!sourceConfig?.fieldMappings) return [];

  const catalogKinds = catalogSourceKinds(blocksConfig);
  // BFS to find all reachable types through the conversion graph
  const reachable = new Set();
  const queue = [sourceType];
  const visited = new Set([sourceType]);

  while (queue.length > 0) {
    const currentType = queue.shift();

    for (const [blockType, blockConfig] of Object.entries(blocksConfig)) {
      if (visited.has(blockType)) continue;
      if (!blockConfig.fieldMappings) continue;

      // Explicit mapping from currentType → blockType
      if (blockConfig.fieldMappings[currentType]) {
        reachable.add(blockType);
        visited.add(blockType);
        queue.push(blockType);
        continue;
      }

      // @default: only if BOTH types have valid @default (canonical keys)
      if (blockConfig.fieldMappings['@default'] &&
          hasValidDefault(blockConfig, catalogKinds) &&
          hasValidDefault(blocksConfig[currentType], catalogKinds)) {
        reachable.add(blockType);
        visited.add(blockType);
        queue.push(blockType);
      }
    }
  }

  // Filter by container's allowedTypes if provided
  const allowedSet = allowedTypes ? new Set(allowedTypes) : null;

  // Convert to array of { type, title }
  return Array.from(reachable)
    .filter(blockType => !allowedSet || allowedSet.has(blockType))
    .map(blockType => ({
      type: blockType,
      title: blocksConfig[blockType]?.title || blockType,
    }));
}

// The one widget → conversion derivation lives with the mapping rule.
export { widgetToTargetType } from './mappingConversions.js';

/**
 * Keys Inka writes on a block itself, never an author's field: a mapping may
 * not write onto them. A list's own idField/typeField join them for the types
 * that are its items.
 */
const INKA_BLOCK_KEYS = new Set([
  '@id',
  '@type',
  '@uid',
  'templateId',
  'templateInstanceId',
  'slotId',
  'fixed',
  'readOnly',
  '_pullFrom',
  'image_field',
  'image_scales',
  'blocks',
  'blocks_layout',
]);

/** What each conversion `type` (convertFieldValue's targetType) produces. */
const PRODUCES = {
  string: 'text',
  textarea: 'text',
  image: 'text',
  slate: 'slate',
  link: 'links',
  image_link: 'links',
  array: 'list',
  // Passed through unchanged: nothing to compare.
  object: null,
  number: null,
  integer: null,
  boolean: null,
};

const ACCEPTS_BY_TARGET = {
  link: 'links',
  image_link: 'links',
  image: 'text',
  string: 'text',
  textarea: 'text',
  slate: 'slate',
};

const isRegionDef = (def) =>
  def?.widget === 'blocks_layout' || def?.widget === 'object_list';

/** What a field holds, as a kind a conversion can be compared with, or null. */
function acceptedKind(def) {
  if (!def || isRegionDef(def)) return null;
  const target = widgetToTargetType(def.widget, def);
  if (target) return ACCEPTS_BY_TARGET[target];
  if (def.type === 'string') return 'text';
  if (def.type === 'array') return 'list';
  return null;
}

/**
 * The fields of the block types that have no schema: a slate block always
 * stores its text in `value`. What the editor knows of them too.
 */
export const SCHEMALESS_BLOCK_FIELDS = {
  slate: { value: { title: 'Text', type: 'array', widget: 'slate' } },
  detachedSlate: { value: { title: 'Text', type: 'array', widget: 'slate' } },
};

/** A block config's schema properties. A schema that is a function is called with no data. */
function propertiesOf(blockConfig, type) {
  if (!blockConfig?.blockSchema && SCHEMALESS_BLOCK_FIELDS[type]) return SCHEMALESS_BLOCK_FIELDS[type];
  const schema = blockConfig?.blockSchema;
  const resolved =
    typeof schema === 'function'
      ? schema({
          formData: {},
          data: {},
          intl: { formatMessage: (message) => message?.defaultMessage ?? message?.id },
        })
      : schema;
  return resolved?.properties || {};
}

/**
 * The field a mapping names on `type`, or null: a field, a `/`-path through
 * `widget: 'object'` fields, or a region path `<region>/<type|*>/<field>` onto
 * that region's children.
 */
function fieldAt(type, path, blocksConfig) {
  const segments = path.split('/');
  const properties = propertiesOf(blocksConfig[type], type);
  if (segments.length === 3 && isRegionDef(properties[segments[0]])) {
    const [region, childType, field] = segments;
    const allowed = properties[region].allowedBlocks || null;
    const candidates = childType === '*' ? allowed || [] : [childType];
    for (const candidate of candidates) {
      if (allowed && !allowed.includes(candidate)) continue;
      const def = propertiesOf(blocksConfig[candidate], candidate)[field];
      if (def) return def;
    }
    return null;
  }
  let props = properties;
  for (let i = 0; i < segments.length; i += 1) {
    const def = props?.[segments[i]];
    if (!def) return null;
    if (i === segments.length - 1) return def;
    if (def.widget !== 'object' || !def.schema) return null;
    props = def.schema.properties;
  }
  return null;
}

/** For each type, the id and type fields of the lists it is an item of. */
function listKeysByItemType(blocksConfig) {
  const keys = {};
  const visit = (properties) => {
    for (const def of Object.values(properties || {})) {
      if (def?.widget === 'object_list') {
        for (const itemType of def.allowedBlocks || []) {
          keys[itemType] = keys[itemType] || new Set();
          if (def.idField) keys[itemType].add(def.idField);
          if (def.typeField) keys[itemType].add(def.typeField);
        }
      }
      if (def?.widget === 'object' && def.schema) visit(def.schema.properties);
    }
  };
  for (const config of Object.values(blocksConfig)) visit(propertiesOf(config));
  return keys;
}

const renamedAddressMessage = (where) =>
  `${where}: the address is mapped from "${ADDRESS_SOURCE}" now, not "${RETIRED_ADDRESS_SOURCE}". ` +
  `Plone reads every "${RETIRED_ADDRESS_SOURCE}" in a block as a link, so a stored mapping keyed by it can't be saved. Rename the key to "${ADDRESS_SOURCE}".`;

/**
 * Every fieldMappings entry in the registry that doesn't make sense against the
 * schemas it names. An empty list means they all do.
 *
 * Each mapping, `source: target` or `source: { field, type }`, is checked for:
 *
 *   bad-mapping          it names no field.
 *   unknown-source       a `@default` / `@target` source that isn't a catalog
 *                        field (DEFAULT_TYPE_FIELDS); a type-to-type source the
 *                        other type has no field for.
 *   unknown-destination  the block has no such field (or region path).
 *   id-destination       it writes onto `@id`, `@type`, one of Inka's own keys,
 *                        or the idField / typeField of a list the block is an
 *                        item of: an id is never content.
 *   unknown-type         its `type` is no conversion Inka has.
 *   type-mismatch        its `type` produces something the field can't hold
 *                        (a link onto a text field, slate onto a textarea).
 *
 * Pure, so the editor runs it when the frontend's config arrives (and refuses
 * to load on any) and the content check runs it in CI.
 *
 * @param {Object} blocksConfig - the full block registry
 * @returns {Array<{rule: string, types: string[], message: string}>}
 */
export function fieldMappingProblems(blocksConfig) {
  const problems = [];
  const listKeys = listKeysByItemType(blocksConfig || {});
  const report = (rule, type, message) => problems.push({ rule, types: [type], message });
  const catalogKinds = catalogSourceKinds(blocksConfig);

  // A mapping widget's sourceFields are what the editor offers to map from;
  // they're stored as the listing's mapping keys, so `@id` is out there too.
  const visitWidgets = (type, properties, where) => {
    for (const [name, def] of Object.entries(properties || {})) {
      if (def?.widget === 'field_mapping' && def.sourceFields && RETIRED_ADDRESS_SOURCE in def.sourceFields) {
        report('unknown-source', type, renamedAddressMessage(`${where}.${name}.sourceFields['${RETIRED_ADDRESS_SOURCE}']`));
      }
      for (const [source, sourceDef] of Object.entries(def?.widget === 'field_mapping' ? def.sourceFields || {} : {})) {
        if (source !== ADDRESS_SOURCE && !SOURCE_TYPES.includes(sourceDef?.type)) {
          report('unknown-type', type, `${where}.${name}.sourceFields['${source}'] has type ${JSON.stringify(sourceDef?.type)}; a source's type is one Inka converts (${SOURCE_TYPES.join(', ')}).`);
        }
      }
      if (def?.widget === 'object' && def.schema) visitWidgets(type, def.schema.properties, `${where}.${name}`);
    }
  };
  for (const [type, config] of Object.entries(blocksConfig || {})) {
    visitWidgets(type, propertiesOf(config), type);
  }

  for (const [type, config] of Object.entries(blocksConfig || {})) {
    const mappings = config?.fieldMappings;
    if (!mappings) continue;
    const reserved = new Set([...INKA_BLOCK_KEYS, ...(listKeys[type] || [])]);

    for (const [from, mapping] of Object.entries(mappings)) {
      const isCatalog = from === '@default' || from === '@target';
      const where = `${type}.fieldMappings['${from}']`;
      if (!isCatalog && !blocksConfig[from]) continue; // validateConversionRegistry's unknown-target
      for (const [source, value] of Object.entries(mapping || {})) {
        if (from === '@target' && source === '@source') continue; // names the link, not a field
        const field = typeof value === 'string' ? value : value?.field;
        const conversion = typeof value === 'object' && value ? value.type : undefined;
        if (typeof field !== 'string' || field === '') {
          report('bad-mapping', type, `${where}['${source}'] names no field: ${JSON.stringify(value)}. Write a field name, or { field, type }.`);
          continue;
        }
        // A value↔container bridge (convertValueContainer): on the value block,
        // keyed by the container, { <own field>: '<container region>/<type>/<field>' }.
        const segments = field.split('/');
        if (
          !isCatalog &&
          segments.length === 3 &&
          !isRegionDef(propertiesOf(config)[segments[0]]) &&
          isRegionDef(propertiesOf(blocksConfig[from], from)[segments[0]])
        ) {
          if (!fieldAt(type, source, blocksConfig)) {
            report('unknown-destination', type, `${where}['${source}'] bridges "${type}" field "${source}", which it doesn't have.`);
          }
          if (!fieldAt(from, field, blocksConfig)) {
            report('unknown-source', type, `${where}['${source}'] bridges to "${field}" on "${from}", which no child it allows has.`);
          }
          continue;
        }
        if (isCatalog && source === RETIRED_ADDRESS_SOURCE) {
          report('unknown-source', type, renamedAddressMessage(`${where}['${source}']`));
        } else if (from === '@default' && !(source in catalogKinds)) {
          report('unknown-source', type, `${where}['${source}']: "${source}" is not a catalog field. A ${from} source is a linked item's field (${Object.keys(catalogKinds).join(', ')}); a site's own catalog field is declared in a mapping widget's sourceFields.`);
        }
        if (!isCatalog && !(source in catalogKinds) && !fieldAt(from, source, blocksConfig)) {
          report('unknown-source', type, `${where}['${source}']: block type "${from}" has no field "${source}".`);
        }
        // A region path names the block's own region first (a table cell's
        // list is called `blocks`), so only a plain field is checked here.
        const isRegionPath =
          field.split('/').length === 3 && isRegionDef(propertiesOf(config)[field.split('/')[0]]);
        if (!isRegionPath && reserved.has(field.split('/')[0])) {
          report('id-destination', type, `${where}['${source}'] writes onto "${field}", which is Inka's (an id, a type, or a template mark), never content.`);
          continue;
        }
        // Onto each child a region path makes: never its id or type.
        if (isRegionPath) {
          const [regionName, , childField] = field.split('/');
          const region = propertiesOf(config)[regionName];
          if (INKA_BLOCK_KEYS.has(childField) || childField === region.idField || childField === region.typeField) {
            report('id-destination', type, `${where}['${source}'] writes onto "${field}", the id or type of each item in "${regionName}", never content.`);
            continue;
          }
        }
        const def = fieldAt(type, field, blocksConfig);
        if (!def) {
          report('unknown-destination', type, `${where}['${source}'] writes onto "${field}", but block type "${type}" has no such field.`);
          continue;
        }
        if (conversion !== undefined && !(conversion in PRODUCES)) {
          report('unknown-type', type, `${where}['${source}'] converts with type "${conversion}", which is not one Inka has (${Object.keys(PRODUCES).join(', ')}).`);
          continue;
        }
        // A catalog source's kind is known: the rule the mapping widget offers
        // by decides. An entry with no `type` is given the one the rule records
        // (on a listing, and when pulled); one with a type must name one that
        // gives what the field holds.
        if (isCatalog) {
          const kind = catalogKinds[source];
          // Not a catalog field: reported above for @default; for @target, an
          // attribute of the linked page, whose kind isn't known.
          if (!kind) continue;
          const fits = conversion !== undefined ? isAccepted(kind, def, conversion) : conversionFor(kind, def) !== undefined;
          if (!fits) {
            const how = conversion !== undefined ? `converted as ${conversion}` : 'by any conversion';
            const fix = conversionFor(kind, def);
            const instead = fix !== undefined ? ` Write { field: '${field}', type: '${fix}' }.` : ` A ${kind} can't become what "${field}" holds.`;
            report('type-mismatch', type, `${where}['${source}'] puts a ${kind} ${how} into "${field}" (${targetKind(def) ?? 'not a mapping target'}).${instead}`);
          }
          continue;
        }
        if (conversion === undefined) continue;
        if (!(conversion in PRODUCES)) {
          report('unknown-type', type, `${where}['${source}'] converts with type "${conversion}", which is not one Inka has (${Object.keys(PRODUCES).join(', ')}).`);
          continue;
        }
        const produced = PRODUCES[conversion];
        const accepted = acceptedKind(def);
        if (produced && accepted && produced !== accepted) {
          report('type-mismatch', type, `${where}['${source}'] converts to ${conversion} (${produced}), but "${field}" holds ${accepted}.`);
        }
      }
    }
  }
  return problems;
}

/**
 * Every block field NAMED `@id`, at any depth (a block's fields, an object
 * field's, an untyped object list's items). Plone reads every `@id` in stored
 * block data as a link: a string that names a page is rewritten to that page's
 * resolveuid, and anything else crashes the save. A link keeps its `@id`
 * inside the field's value, which is fine; a field may not be called that.
 *
 * @param {Object} blocksConfig - the full block registry
 * @returns {Array<{rule: string, types: string[], nested: boolean, message: string}>}
 *   `nested` is false for one of the block's own fields.
 */
export function reservedFieldProblems(blocksConfig) {
  const problems = [];
  const visit = (type, properties, where) => {
    for (const [name, def] of Object.entries(properties || {})) {
      if (name === '@id') {
        problems.push({
          rule: 'reserved-field',
          types: [type],
          nested: where !== type,
          message: `${where}.@id: a field can't be named "@id". Plone reads every "@id" in a block as a link, so it rewrites or refuses what this field holds. Give the field another name.`,
        });
      }
      if (def?.widget === 'object' && def.schema) {
        visit(type, def.schema.properties, `${where}.${name}`);
      }
      if (def?.widget === 'object_list' && def.schema) {
        visit(type, def.schema.properties, `${where}.${name}[]`);
      }
    }
  };
  for (const [type, config] of Object.entries(blocksConfig || {})) {
    visit(type, propertiesOf(config), type);
  }
  return problems;
}
