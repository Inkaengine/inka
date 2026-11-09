import { getChildBlockEntries, getChildFields } from './index.js';
import { SLATE_SCHEMA, joined, nodeText, schemaOf, templateOwned } from './blockText.js';
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
