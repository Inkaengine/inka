/**
 * The field mappings the editor would have stored, on content that wasn't
 * saved through it (a conversion, a fixture, a migration).
 *
 * The editor stores, on a block with a mapping widget, the widget's default
 * for the item type picked, every entry with its conversion. The listing's
 * renderer has no schema, so it converts by exactly that and refuses a block
 * without it. This gives other content the same: the default where there is
 * none, a conversion for each entry with none (the mapping rule's, as the
 * widget records), the address under `getURL`. Entries keep their choices.
 * `plone-content field-mappings` runs it over a content tree.
 *
 * Pure: returns a new page.
 */
import { RETIRED_ADDRESS_SOURCE, ADDRESS_SOURCE } from './catalogAddress.js';
import { getBlockById, updateBlockById } from './blockPath.js';
import { buildBlockPathMap } from './buildBlockPathMap.js';
import { computeSmartDefaults } from './blockSync.js';
import { conversionFor, sourceKind } from './mappingConversions.js';

function propertiesOf(blocksConfig, type, intl) {
  const schema = blocksConfig?.[type]?.blockSchema;
  const resolved = typeof schema === 'function' ? schema({ formData: {}, data: {}, intl }) : schema;
  return resolved?.properties;
}

/** One block's mappings, as the editor would store them (the block unchanged when they are). */
function blockWithMappings(block, id, blocksConfig, intl) {
  const props = propertiesOf(blocksConfig, block['@type'], intl);
  let out = block;
  for (const [name, def] of Object.entries(props || {})) {
    if (def?.widget !== 'field_mapping') continue;
    const typeField = Object.keys(props).find((field) => props[field]?.filterConvertibleFrom);
    const itemType = typeField && block[typeField];
    const itemProps = itemType && propertiesOf(blocksConfig, itemType, intl);
    if (!itemProps) {
      throw new Error(
        `Block ${id} (${block['@type']}) has no item type with fields (${typeField} is ${JSON.stringify(itemType)}), ` +
          `so there is no mapping to store: set its item type.`,
      );
    }
    const sources = def.sourceFields || {};
    const stored = block[name];
    const mapping =
      stored && Object.keys(stored).length > 0
        ? stored
        : computeSmartDefaults(sources, { properties: itemProps }, blocksConfig[itemType].fieldMappings);
    const typed = {};
    for (const [key, entry] of Object.entries(mapping)) {
      const source = key === RETIRED_ADDRESS_SOURCE ? ADDRESS_SOURCE : key;
      const field = typeof entry === 'string' ? entry : entry?.field;
      if (typeof entry === 'object' && entry?.type) {
        typed[source] = entry;
        continue;
      }
      const kind = sources[source] ? sourceKind(source, sources[source]) : def.vocabulary ? 'text' : undefined;
      if (!kind) throw new Error(`Block ${id}: "${key}" isn't a source its mapping offers (${Object.keys(sources).join(', ')}).`);
      const type = conversionFor(kind, itemProps[field]);
      if (type === undefined) {
        throw new Error(`Block ${id}: "${key}" → "${field}" — a ${kind} can't become what ${itemType}'s "${field}" holds.`);
      }
      typed[source] = { field, type };
    }
    if (JSON.stringify(typed) !== JSON.stringify(stored)) out = { ...out, [name]: typed };
  }
  return out;
}

/**
 * @param {Object} page - a page (or any form data with blocks)
 * @param {Object} blocksConfig - the site's block definitions
 * @param {Object} intl - { formatMessage }
 * @returns {Object} the page with every mapping as the editor stores it
 */
export function withFieldMappings(page, blocksConfig, intl) {
  const pathMap = buildBlockPathMap(page, blocksConfig, intl);
  let out = page;
  for (const id of Object.keys(pathMap)) {
    if (id === '_page') continue;
    const block = getBlockById(out, pathMap, id);
    if (!block?.['@type']) continue;
    const next = blockWithMappings(block, id, blocksConfig, intl);
    if (next !== block) out = updateBlockById(out, pathMap, id, next);
  }
  return out;
}
