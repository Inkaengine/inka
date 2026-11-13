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
import { isAccepted, conversionFor, sourceKind } from './mappingConversions.js';

const MISSING =
  'This block has no field mapping, so its results have nothing to show. Pick its item type again to set one.';

/** The item type the mapping maps onto: the field the block picks it with. */
function itemTypeOf(schema, blockData) {
  const typeField = Object.keys(schema.properties).find(
    (name) => schema.properties[name]?.filterConvertibleFrom,
  );
  return typeField ? blockData[typeField] : undefined;
}

function itemProperties(blocksConfig, itemType) {
  const schema = blocksConfig?.[itemType]?.blockSchema;
  const resolved =
    typeof schema === 'function'
      ? schema({ formData: {}, data: {}, intl: { formatMessage: (m) => m?.defaultMessage ?? m?.id } })
      : schema;
  return resolved?.properties;
}

/**
 * @param {Object} args
 * @param {Object} args.schema - the block's effective schema
 * @param {Object} args.blockData - the block as stored
 * @param {Object} args.blocksConfig - the block registry (the item type's schema)
 * @returns {Object} fieldName → [messages]; empty when every mapping is valid
 */
export function fieldMappingErrors({ schema, blockData, blocksConfig }) {
  const errors = {};
  for (const [name, def] of Object.entries(schema?.properties || {})) {
    if (def?.widget !== 'field_mapping') continue;
    const messages = [];
    const mapping = blockData?.[name];
    if (!mapping || typeof mapping !== 'object' || Object.keys(mapping).length === 0) {
      errors[name] = [MISSING];
      continue;
    }
    const itemType = itemTypeOf(schema, blockData);
    const itemProps = itemProperties(blocksConfig, itemType);
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
      // A vocabulary's columns are offered beside the declared sources, as text.
      const kind = sources[source]
        ? sourceKind(source, sources[source])
        : def.vocabulary
          ? 'text'
          : undefined;
      if (!kind) {
        messages.push(`"${source}" isn't a source this mapping offers (${Object.keys(sources).join(', ')}).`);
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
