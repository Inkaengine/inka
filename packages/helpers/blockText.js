import { getChildBlockEntries, getChildFields, translatableFieldIds } from './index.js';
import { isObjectListRegion, regionIdField } from './regionWidgets.js';

/**
 * A block's text, as a person reads it: the fields a person writes, as the schema for that
 * block resolves them (translatableFieldIds, the same answer a translator gets), so a field it
 * isn't showing is left out, and the text of the blocks inside it. Search indexes it
 * (searchableText.js) and a rule measures it (fieldRules.js, `<field>@chars`).
 *
 * `options.schemaFor(block, id)` gives a block's resolved schema; `options.fieldsFor(type)` the
 * fields a block type names for its text, in order, in place of the default.
 */

export const joined = (parts) => parts.map((part) => part.trim()).filter(Boolean).join(' ');

// Slate's words. Its own shape says where one word can end: an element holds either
// blocks (only elements: paragraphs, list items) or inline content (text leaves, with
// any inline element between them). Blocks are separate words; inline content runs on,
// so a bold syllable stays inside its word.
function slateText(nodes) {
  if (!Array.isArray(nodes)) return '';
  const inline = nodes.some((node) => typeof node?.text === 'string');
  const parts = nodes.map((node) => (typeof node?.text === 'string' ? node.text : slateText(node?.children)));
  return inline ? parts.join('') : joined(parts);
}

// A string, slate, a list of strings, or what a block names from a picked item
// (`[{ '@id', title }]`).
export function fieldText(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  if (value.every((node) => typeof node === 'string')) return value.join(' ');
  if (value.some((node) => typeof node?.title === 'string')) {
    return value.map((node) => node?.title ?? '').join(' ');
  }
  return slateText(value);
}

// A block the template owns: it is on every page using it, so it finds none of them.
export const templateOwned = (block) => block.fixed && block.readOnly;

export function schemaOf(block, id, options) {
  const schema = options.schemaFor(block, id);
  if (!schema) {
    throw new Error(`Block text: no schema for block type "${block['@type']}"`);
  }
  return schema;
}

// The text of a block no visit will reach, and of everything in it.
function unreachedBlockText(block, id, options, parts) {
  const type = block['@type'];
  if (type === 'empty') return;
  nodeText(block, schemaOf(block, id, options), !templateOwned(block), options, parts, {
    namedFields: options.fieldsFor?.(type),
  });
}

// A block, or an object or item inside one. `own` is whether its fields are the page's; its
// children decide for themselves. `visited` is a node whose regions restapi walks itself.
export function nodeText(node, schema, own, options, parts, { idField, namedFields, visited } = {}) {
  const properties = schema.properties || {};
  if (own) {
    const fields = namedFields?.filter((id) => id in properties) ?? translatableFieldIds(schema);
    for (const id of fields) {
      if (id !== idField) parts.push(fieldText(node[id]));
    }
  }
  for (const [field, def] of Object.entries(properties)) {
    if (def?.widget === 'object' && def.schema) {
      if (node[field]) {
        nodeText(node[field], def.schema, own, options, parts, { visited: visited && field === 'data' });
      }
    } else if (def?.widget === 'object_list') {
      objectListText(node, field, def, own, options, parts);
    } else if (def?.widget === 'blocks_layout' && !visited) {
      regionText(node, field, options, parts);
    }
  }
  // Regions the schema doesn't declare (a container's default `items`). Its objects'
  // are reached through the objects above.
  for (const field of getChildFields(node)) {
    if (!field.regionPath && !(field.region in properties) && !visited) {
      regionText(node, field.region, options, parts);
    }
  }
}

export function regionText(node, region, options, parts) {
  for (const { id, block } of getChildBlockEntries(node, { region })) {
    unreachedBlockText(block, id, options, parts);
  }
}


function objectListText(node, field, def, own, options, parts) {
  for (const item of node[field] || []) {
    const type = item[def.typeField || '@type'];
    if (type) unreachedBlockText({ ...item, '@type': type }, item[regionIdField(def, `field "${field}"`)], options, parts);
    else if (def.schema) nodeText(item, def.schema, own, options, parts, { idField: def.idField });
    else throw new Error(`Block text: no type or schema for an item of "${field}"`);
  }
}

// Inka holds the core text block's schema, not a frontend's config.
export const SLATE_SCHEMA = { properties: { value: { widget: 'slate' } } };

/**
 * The text of one field of a block. A region (blocks_layout or object_list) is the text of
 * everything in it, at any depth, a space between blocks; any other field is its own text,
 * whole: a textarea keeps its line breaks, slate's paragraphs are a space apart.
 *
 * @param {Object} node - the block
 * @param {string} field - the field's name
 * @param {Object|undefined} def - the field's definition, when the block's schema is known
 * @param {Object} options - as for nodeText: `schemaFor`, and optionally `fieldsFor`
 * @returns {string}
 */
export function fieldTextOf(node, field, def, options) {
  const parts = [];
  if (isObjectListRegion(def)) {
    objectListText(node, field, def, !templateOwned(node), options, parts);
  } else if (def?.widget === 'blocks_layout' || Array.isArray(node?.blocks_layout?.[field])) {
    regionText(node, field, options, parts);
  } else {
    return fieldText(node?.[field]);
  }
  return joined(parts);
}
