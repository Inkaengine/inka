/**
 * The page as the save writes it: each block holding only what its schema
 * declares. A conversion keeps a block's other fields while editing, so switching
 * the type back restores them (convertBlockType); the save drops what the final
 * type doesn't declare, which is what the content check requires of stored
 * content. Which fields may stay beside the declared ones is shared with the
 * check (@volto-hydra/helpers/storedFields.js).
 */
import { undeclaredFieldsOf } from '@volto-hydra/helpers/storedFields.js';
import { collectFieldRules, fieldsRulesMayAdd } from '@volto-hydra/helpers/fieldRules.js';
import { buildBlockPathMap } from './blockPath';
import { resolveEffectiveBlockSchema } from './blockSync';

/**
 * @param {Object} formData - the page
 * @param {Object} options
 * @param {Object} options.blocksConfig - the block registry
 * @param {Object} options.intl - react-intl (for schema factories)
 * @returns {Object} a copy of the page; the input is not changed
 */
export function withoutUndeclaredFields(formData, { blocksConfig, intl }) {
  if (!blocksConfig) throw new Error('withoutUndeclaredFields needs the block registry (blocksConfig)');
  const pathMap = buildBlockPathMap(formData, blocksConfig, intl);
  const out = structuredClone(formData);
  for (const [blockId, entry] of Object.entries(pathMap)) {
    // `_page` and the map's own keys (`_schemas`) are not blocks, and nor is a
    // template instance: the editor groups a template's blocks by it, and it has
    // no path because nothing stores it.
    if (blockId.startsWith('_') || !entry?.blockType || entry.path === null) continue;
    // The stored object itself, by its path (getBlockById may hand back a copy).
    const block = entry.path.reduce((node, key) => node?.[key], out);
    // A template's locked copy is the template's: the merge takes it from there.
    if (!block || block.readOnly === true) continue;
    const schema = resolveEffectiveBlockSchema(blockId, formData, pathMap, blocksConfig, intl);
    if (!schema?.properties) continue;
    const def = blocksConfig[entry.blockType];
    const fields = [
      ...Object.keys(schema.properties),
      ...Object.keys(def?.blockSchema?.properties ?? {}),
      ...fieldsRulesMayAdd(collectFieldRules(def?.schemaEnhancer)),
    ];
    const identityFields = [entry.idField, entry.typeField].filter(Boolean);
    const defaultsPrefix = def?.schemaEnhancer?.inheritSchemaFrom?.defaultsField ?? null;
    for (const field of undeclaredFieldsOf(block, { fields, identityFields, defaultsPrefix })) delete block[field];
  }
  return out;
}
