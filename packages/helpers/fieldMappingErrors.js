/**
 * A block with a mapping widget (`widget: 'field_mapping'`: a listing, a feed)
 * always has a stored mapping, and every entry of it is valid.
 *
 * The block's results are expanded where there is no schema, by what is stored:
 * a mapping that is missing, or an entry with no conversion or the wrong one,
 * renders nothing or the wrong shape. Picking the item type stores the
 * widget's default, so content saved through the editor has one; content
 * written another way must too. The save and the offline content check both
 * run this (through blockFieldErrors).
 *
 * Pure.
 */
import { ADDRESS_SOURCE, RETIRED_ADDRESS_SOURCE } from './catalogAddress.js';
import { columnKind, isAccepted, conversionFor, sourceKind } from './mappingConversions.js';

const MISSING =
  'This block has no field mapping, so its results have nothing to show. Pick its item type again to set one.';

function propertiesOf(blocksConfig, type) {
  const schema = blocksConfig?.[type]?.blockSchema;
  const resolved =
    typeof schema === 'function'
      ? schema({ formData: {}, data: {}, intl: { formatMessage: (m) => m?.defaultMessage ?? m?.id } })
      : schema;
  return resolved?.properties;
}

/**
 * The item type the mapping maps onto: the field the block picks it with,
 * read from the block type's own schema. In a container that picks the type,
 * the parent controls that field and the effective schema drops it; the block
 * still stores it.
 */
function itemTypeOf(blocksConfig, blockData) {
  const props = propertiesOf(blocksConfig, blockData?.['@type']) || {};
  const typeField = Object.keys(props).find((name) => props[name]?.filterConvertibleFrom);
  return typeField ? blockData[typeField] : undefined;
}

/**
 * @param {Object} args
 * @param {Object} args.schema - the block's effective schema
 * @param {Object} args.blockData - the block as stored
 * @param {Object} args.blocksConfig - the block registry (the item type's schema)
 * @param {Object} [args.site] - { contentTypes, pageType }: what a site's own
 *   column holds (columnKind); needed only by a mapping that maps one
 * @returns {Object} fieldName → [messages]; empty when every mapping is valid
 */
export function fieldMappingErrors({ schema, blockData, blocksConfig, site }) {
  const errors = {};
  for (const [name, def] of Object.entries(schema?.properties || {})) {
    if (def?.widget !== 'field_mapping') continue;
    const messages = [];
    const mapping = blockData?.[name];
    if (!mapping || typeof mapping !== 'object' || Object.keys(mapping).length === 0) {
      errors[name] = [MISSING];
      continue;
    }
    const itemType = itemTypeOf(blocksConfig, blockData);
    const itemProps = propertiesOf(blocksConfig, itemType);
    if (!itemProps) {
      errors[name] = [`This block's item type, ${JSON.stringify(itemType)}, has no fields to map onto.`];
      continue;
    }
    const sources = def.sourceFields || {};
    for (const [source, entry] of Object.entries(mapping)) {
      if (source === RETIRED_ADDRESS_SOURCE) {
        messages.push(`"${source}" is the address's old name: map it from "${ADDRESS_SOURCE}".`);
        continue;
      }
      const field = entry?.field;
      if (typeof entry !== 'object' || !entry?.type) {
        messages.push(`"${source}" stores no conversion: each entry is { field, type }.`);
        continue;
      }
      if (!sources[source] && !def.vocabulary) {
        messages.push(`"${source}" isn't a source this mapping offers (${Object.keys(sources).join(', ')}).`);
        continue;
      }
      // A vocabulary's columns are offered beside the declared sources, each
      // holding what its field on the content types holds.
      const { kind, problem } = sources[source]
        ? { kind: sourceKind(source, sources[source]) }
        : columnKind(source, site);
      if (!kind) {
        messages.push(problem);
        continue;
      }
      const target = itemProps[field];
      if (!target) {
        messages.push(`"${source}" maps onto no field "${field}" of ${itemType}.`);
        continue;
      }
      if (!isAccepted(kind, target, entry.type)) {
        const fix = conversionFor(kind, target);
        messages.push(
          `"${source}" → "${field}" as ${entry.type}: a ${kind} can't become what "${field}" holds that way` +
            (fix === undefined ? '; map it onto another field.' : `; use ${fix}.`),
        );
      }
    }
    if (messages.length) errors[name] = messages;
  }
  return errors;
}
