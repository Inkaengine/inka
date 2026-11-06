import {
  getChildBlockEntries,
  getChildFields,
  slateNodesText,
  translatableFieldIds,
} from '@volto-hydra/helpers';
import { isObjectListRegion } from './regionWidgets.js';

/**
 * What a page is found by: the text of each top-level block's whole subtree, stored as
 * that block's `searchableText`. plone.restapi prefers that field to any adapter; the
 * backend walks top-level blocks in layout order and stops at it. See the frontend guide,
 * "Search text".
 *
 * A block's own text: the fields a person writes, as the schema for that block resolves
 * them (translatableFieldIds, the same answer a translator gets), so a field it isn't showing
 * is left out. A block type that needs another order names its fields (`searchableFields`
 * in its config: plain data, because a frontend's config crosses the bridge as JSON).
 */

const joined = (parts) => parts.map((part) => part.trim()).filter(Boolean).join(' ');

function fieldText(value) {
  if (typeof value === 'string') return value;
  return Array.isArray(value) ? slateNodesText(value) : '';
}

// A block the template owns: it is on every page using it, so it finds none of them.
const templateOwned = (block) => block.fixed && block.readOnly;

function blockText(block, options, parts) {
  const type = block['@type'];
  if (type === 'empty') return;
  const schema = options.schemaFor(block);
  if (!schema) {
    throw new Error(`Search text: no schema for block type "${type}"`);
  }
  nodeText(block, schema, !templateOwned(block), options, parts, undefined, options.fieldsFor?.(type));
}

// A block, or an object or item inside one. `own` is whether its fields are the page's;
// its children decide for themselves.
function nodeText(node, schema, own, options, parts, idField, namedFields) {
  const properties = schema.properties || {};
  if (own) {
    const fields = namedFields?.filter((id) => id in properties) ?? translatableFieldIds(schema);
    for (const id of fields) {
      if (id !== idField) parts.push(fieldText(node[id]));
    }
  }
  for (const [field, def] of Object.entries(properties)) {
    if (def?.widget === 'object' && def.schema) {
      if (node[field]) nodeText(node[field], def.schema, own, options, parts);
    } else if (isObjectListRegion(def)) {
      for (const item of node[field] || []) {
        const type = item[def.typeField || '@type'];
        if (type) blockText({ ...item, '@type': type }, options, parts);
        else if (def.schema) nodeText(item, def.schema, own, options, parts, def.idField);
        else throw new Error(`Search text: no type or schema for an item of "${field}"`);
      }
    } else if (def?.widget === 'blocks_layout') {
      regionText(node, field, options, parts);
    }
  }
  // Regions the schema doesn't declare (a container's default `items`). Its objects'
  // are reached through the objects above.
  for (const field of getChildFields(node)) {
    if (!field.regionPath && !(field.region in properties)) {
      regionText(node, field.region, options, parts);
    }
  }
}

function regionText(node, region, options, parts) {
  for (const { block } of getChildBlockEntries(node, { region })) {
    blockText(block, options, parts);
  }
}

// Only a top-level block carries text: nested, it would be indexed twice.
function withoutNestedText(value) {
  if (Array.isArray(value)) return value.map(withoutNestedText);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'searchableText') out[key] = withoutNestedText(child);
  }
  return out;
}

/**
 * The page with `searchableText` set on each top-level block, in every region. A block with
 * no text has none. Blocks no region lists are left as they are: they aren't on the page.
 *
 * @param {Object} formData - the page
 * @param {Object} options
 * @param {function(Object): Object|null} options.schemaFor - this block's resolved schema;
 *   null for a type nothing registers, which throws: we can't say what such a block holds
 * @param {function(string): string[]|undefined} [options.fieldsFor] - the fields a block type
 *   names for its text, in order, in place of the default; its children still follow
 * @returns {Object} a new page; the input is not changed
 */
export function withSearchableText(formData, options) {
  const blocks = { ...formData.blocks };
  for (const field of getChildFields(formData)) {
    if (field.regionPath) continue;
    for (const { id, block } of getChildBlockEntries(formData, field)) {
      const parts = [];
      blockText(block, options, parts);
      const text = joined(parts);
      const clean = withoutNestedText(block);
      blocks[id] = text ? { ...clean, searchableText: text } : clean;
    }
  }
  return { ...formData, blocks };
}
