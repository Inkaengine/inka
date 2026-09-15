/**
 * Conversion graph: which block types can become which, and whether that graph
 * is actually navigable.
 *
 * Pure module — no React, no Volto config, no DOM. That matters: the block-
 * sanity gate in a consuming frontend imports this straight from Playwright,
 * the same way it imports schemaValidation.mjs. blockSync.js re-exports every
 * name here for backward compat; THIS file is the SSOT.
 */

export const DEFAULT_TYPE_FIELDS = new Set([
  '@id',
  'title',
  'description',
  'image',
  'hasPreviewImage',
  'Subject',
  'created',
  'modified',
  'effective',
  'expires',
  'start',
  'end',
]);

/**
 * Check if a block config has a valid @default mapping.
 * Valid means all keys are from the canonical @default field set.
 */
export function hasValidDefault(blockConfig) {
  const defaultMapping = blockConfig?.fieldMappings?.['@default'];
  if (!defaultMapping) return false;
  return Object.keys(defaultMapping).every(key => DEFAULT_TYPE_FIELDS.has(key));
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
 * validateFieldMappings() sees one block at a time, which makes it blind to the
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
          hasValidDefault(blockConfig) &&
          hasValidDefault(blocksConfig[currentType])) {
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
