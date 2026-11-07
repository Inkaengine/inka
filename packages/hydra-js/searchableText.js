import {
  getChildBlockEntries,
  getChildFields,
  slateNodesText,
  translatableFieldIds,
} from '@volto-hydra/helpers';
import { buildBlockPathMap, getBlockSchema } from './buildBlockPathMap.js';

/**
 * What a page is found by. plone.restapi's indexer visits every block in a block's `blocks` or
 * `data.blocks`, and reads each one's `searchableText` if it has one. So each block it visits
 * carries its own text, plus the text of whatever it can't reach: object lists (table cells,
 * form questions) and regions in any other object. Nothing is indexed twice. See the frontend
 * guide, "Search text".
 *
 * A block's own text: the fields a person writes, as the schema for that block resolves them
 * (translatableFieldIds, the same answer a translator gets), so a field it isn't showing is
 * left out. A block type that needs another order names its fields (`searchableFields` in its
 * config: plain data, because a frontend's config crosses the bridge as JSON).
 */

const joined = (parts) => parts.map((part) => part.trim()).filter(Boolean).join(' ');

// A string, slate, a list of strings, or what a block names from a picked item
// (`[{ '@id', title }]`).
function fieldText(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  if (value.every((node) => typeof node === 'string')) return value.join(' ');
  if (value.some((node) => typeof node?.title === 'string')) {
    return value.map((node) => node?.title ?? '').join(' ');
  }
  return slateNodesText(value);
}

// A block the template owns: it is on every page using it, so it finds none of them.
const templateOwned = (block) => block.fixed && block.readOnly;

function schemaOf(block, id, options) {
  const schema = options.schemaFor(block, id);
  if (!schema) {
    throw new Error(`Search text: no schema for block type "${block['@type']}"`);
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
function nodeText(node, schema, own, options, parts, { idField, namedFields, visited } = {}) {
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
      for (const item of node[field] || []) {
        const type = item[def.typeField || '@type'];
        if (type) unreachedBlockText({ ...item, '@type': type }, item[def.idField || '@id'], options, parts);
        else if (def.schema) nodeText(item, def.schema, own, options, parts, { idField: def.idField });
        else throw new Error(`Search text: no type or schema for an item of "${field}"`);
      }
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

function regionText(node, region, options, parts) {
  for (const { id, block } of getChildBlockEntries(node, { region })) {
    unreachedBlockText(block, id, options, parts);
  }
}

// A copy with no search text at any depth: what follows sets it where it belongs.
function withoutText(value) {
  if (Array.isArray(value)) return value.map(withoutText);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'searchableText') out[key] = withoutText(child);
  }
  return out;
}

// The blocks in a map, each with its text. Unlisted ones are left: they aren't on the page.
function withBlockTexts(container, options) {
  const blocks = { ...container.blocks };
  for (const field of getChildFields(container)) {
    if (field.regionPath || field.isObjectList) continue;
    for (const { id, block } of getChildBlockEntries(container, field)) {
      blocks[id] = withText(block, id, options);
    }
  }
  return { ...container, blocks };
}

function withText(block, id, options) {
  const type = block['@type'];
  if (type === 'empty') return block;
  const parts = [];
  nodeText(block, schemaOf(block, id, options), !templateOwned(block), options, parts, {
    namedFields: options.fieldsFor?.(type),
    visited: true,
  });
  const text = joined(parts);
  let out = block;
  // A slate block's text is what restapi reads from it anyway.
  if (text && text !== block.plaintext) out = { ...out, searchableText: text };
  if (out.blocks?.constructor === Object) out = withBlockTexts(out, options);
  if (out.data?.blocks) out = { ...out, data: withBlockTexts(out.data, options) };
  return out;
}

// Inka holds the core text block's schema, not a frontend's config.
const SLATE_SCHEMA = { properties: { value: { widget: 'slate' } } };

/**
 * What `withSearchableText` needs for a page, from a blocks config.
 *
 * @param {Object} blocksConfig - the site's block definitions
 * @param {Object} intl - { formatMessage }
 * @param {Object} page - the page, for rules that read it or a block's parent
 */
export function searchTextOptions(blocksConfig, intl, page) {
  const blockPathMap = buildBlockPathMap(page, blocksConfig, intl);
  return {
    schemaFor: (block, id) => {
      const type = block['@type'];
      if (!blocksConfig[type]) return type === 'slate' ? SLATE_SCHEMA : null;
      return getBlockSchema(type, intl, blocksConfig, block, page, id, blockPathMap) ?? (type === 'slate' ? SLATE_SCHEMA : {});
    },
    fieldsFor: (type) => blocksConfig[type]?.searchableFields,
  };
}

/**
 * The page with `searchableText` set on each block plone.restapi's indexer will visit. A block
 * with no text has none.
 *
 * @param {Object} formData - the page
 * @param {Object} options
 * @param {function(Object, string): Object|null} options.schemaFor - this block's resolved schema;
 *   null for a type nothing registers, which throws: we can't say what such a block holds
 * @param {function(string): string[]|undefined} [options.fieldsFor] - the fields a block type
 *   names for its text, in order, in place of the default
 * @returns {Object} a new page; the input is not changed
 */
export function withSearchableText(formData, options) {
  return withBlockTexts({ ...formData, blocks: withoutText(formData.blocks) }, options);
}
