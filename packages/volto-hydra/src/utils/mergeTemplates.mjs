/**
 * Template merging utilities.
 *
 * This module is intentionally free of Volto-specific imports (immer, lodash,
 * @plone/volto) so that unit tests in hydra-js can import it directly.
 */

import { expandTemplates } from '@volto-hydra/helpers';

/**
 * Merge templates into page data. Expands template references in every blocks field via
 * the public merge (expandTemplates), which fully expands all nested regions
 * (blocks_layout + object_list) at apply time. No admin-side re-entry or schema walk.
 *
 * @param {Object} page - Page formData
 * @param {Object} options
 * @param {Function} options.loadTemplate - Async function: (templateId) => Promise<templateData>
 * @param {Object} options.pageBlocksFields - Map of field names to field config (e.g. { blocks_layout: { allowedLayouts: [...] } })
 * @param {Function} options.uuidGenerator - UUID generator function (required)
 * @param {string} options.filterInstanceId - Only process blocks matching this instance ID
 * @param {boolean} options.skipOwnTemplate - Set when preparing a document to be
 *   EDITED (the INITIAL_DATA path): don't merge it against its own template. Off
 *   by default because the reverse direction — capturing a page's edits back into
 *   a template — is deliberately a document merged against itself, and the two are
 *   structurally identical (same shapes, same self-reference). Only the caller
 *   knows which way the content is meant to flow, and the editing path is the one
 *   that has to say so.
 * @param {Object} options.preloadedTemplates - Pre-loaded template cache
 * @returns {Promise<{merged: Object, newTemplateIds: string[]}>}
 */
/**
 * The ids by which THIS document is referenced as a template: its path, and the
 * resolveuid form of its UID. A template's own blocks carry one of these in
 * `templateId` (the fixtures use both spellings), and a `templateId` may also
 * arrive as a full URL.
 *
 * @param {Object} page - Page formData
 * @returns {(templateId: string) => boolean} predicate: "is this me?"
 */
function ownTemplateMatcher(page) {
  const ids = new Set();
  if (page?.['@id']) ids.add(new URL(page['@id'], 'http://x').pathname);
  if (page?.UID) ids.add(`resolveuid/${page.UID}`);
  return (templateId) => {
    if (!templateId || typeof templateId !== 'string') return false;
    if (ids.has(templateId)) return true;
    // Path-compare so an absolute URL matches the same document.
    return ids.has(new URL(templateId, 'http://x').pathname);
  };
}

/**
 * Give a template definition's own blocks an instance id, so the editor treats
 * them as a template member and offers the unlock toggle. Editing a definition
 * goes through the SAME unlock gesture as editing it from a page — the lock is
 * what says "this changes everywhere", which is no less true on the definition
 * page — and that gesture keys on `templateInstanceId`
 * (isBlockInEditedTemplate). Stored definition blocks carry only `templateId`,
 * so the toggle never appeared and the blocks were locked with no way to unlock.
 *
 * The id is the templateId itself, matching what forced layouts already do
 * (`templateInstanceId === templateId`) and staying deterministic — a minted
 * uuid would differ on every load. `readOnly` is left exactly as stored: it
 * describes how the block behaves on pages that USE the template and has to
 * survive a save. Applying the template to a page is unaffected, since the
 * expand path never reads a definition's stored instance ids — it generates
 * fresh per-application ones.
 *
 * @param {Object} block
 * @param {(templateId: string) => boolean} isOwnTemplate
 * @returns {Object} the block, with definition-side instance ids filled in
 */
function stampDefinitionInstanceIds(block, isOwnTemplate) {
  if (!block || typeof block !== 'object') return block;
  let next = block;
  if (isOwnTemplate(block.templateId) && !block.templateInstanceId) {
    next = { ...next, templateInstanceId: block.templateId };
  }
  for (const [key, value] of Object.entries(next)) {
    if (!value || typeof value !== 'object') continue;
    const nested = key === 'blocks' ? value : value.blocks;
    if (!nested || typeof nested !== 'object') continue;
    const stampedNested = {};
    for (const [uid, child] of Object.entries(nested)) {
      stampedNested[uid] = stampDefinitionInstanceIds(child, isOwnTemplate);
    }
    next =
      key === 'blocks'
        ? { ...next, blocks: stampedNested }
        : { ...next, [key]: { ...value, blocks: stampedNested } };
  }
  return next;
}

export async function mergeTemplatesIntoPage(page, options = {}) {
  const {
    loadTemplate,
    pageBlocksFields = { items: {} },
    uuidGenerator,
    filterInstanceId,
    skipOwnTemplate = false,
    preloadedTemplates = {},
    firstInsert,
    idFieldMap,
  } = options;

  let result = { ...page };
  const allNewTemplateIds = new Set();

  // Expand one page-level blocks field via the PUBLIC merge. That merge fully expands
  // every nested region (blocks_layout regions AND object_list arrays) at apply time,
  // so there is NO admin-side re-entry or schema walk — we run expandTemplates once and
  // reshape its items back into a blocks dict + layout, using each emitted block (with
  // its nested content already filled) as-is.
  async function expandBlocksField(blocks, layout, allowedLayouts, templateState) {
    const items = await expandTemplates(layout, {
      blocks,
      templateState,
      loadTemplate,
      preloadedTemplates,
      allowedLayouts,
      uuidGenerator,
      filterInstanceId,
      firstInsert,
      idFieldMap, // { blockType: { field: idField } } — admin-resolved from the schema
    });

    const newBlocks = {};
    const newLayout = [];
    for (const item of items) {
      const { '@uid': blockId, ...block } = item;
      newLayout.push(blockId);
      newBlocks[blockId] = block;
    }

    for (const tid of templateState.newTemplateIds || []) {
      allNewTemplateIds.add(tid);
    }

    return { blocks: newBlocks, layout: newLayout };
  }

  // Process each page-level blocks field. A blocks field's name is the key in
  // the shared `blocks_layout` dict (default 'items'); all share result.blocks.
  // Writing each field's list back under blocks_layout[fieldName] preserves the
  // sibling fields (e.g. footer) — rebuilding the whole dict would drop them.
  const fieldsToProcess = Object.keys(pageBlocksFields).length > 0
    ? pageBlocksFields
    : { items: {} }; // Default to the main 'items' blocks field

  // Only the caller preparing a document for EDITING asks for this. Merging a
  // page's edits back INTO its template is deliberately a document merged against
  // its own template (`loadTemplate: async () => formData`), and it is the far
  // more common call, so guarding by default drops every "Change on all pages"
  // edit and every capture the unit tests cover. Opt in, don't opt out.
  const isOwnTemplate = skipOwnTemplate ? ownTemplateMatcher(page) : () => false;

  for (const [fieldName, fieldDef] of Object.entries(fieldsToProcess)) {
    const blocksData = result.blocks || {};
    const layout = result.blocks_layout?.[fieldName] || [];
    // A page is never merged against its OWN template. Forcing a document's
    // template onto itself either re-inserts what is already there (harmless but
    // pointless) or — when the template is forced into a different region than
    // the one its definition blocks live in — removes them and re-inserts
    // nothing, leaving the definition page an empty shell. The save path has
    // always known this (`getUniqueTemplateIds(...).filter(id => id !== currentPath)`);
    // the load path did not, so a footer template opened in the editor showed
    // nothing to edit.
    const declaredLayouts = fieldDef?.allowedLayouts || null;
    const externalLayouts = declaredLayouts?.filter((id) => !isOwnTemplate(id)) ?? null;
    const allowedLayouts = externalLayouts?.length ? externalLayouts : null;

    if (layout.length === 0 && !allowedLayouts) {
      // No layout items and no forced layout - leave this field as-is
      continue;
    }

    // Build a blocks subset for this field (only blocks it references)
    const fieldBlocks = {};
    for (const blockId of layout) {
      if (blocksData[blockId]) {
        fieldBlocks[blockId] = blocksData[blockId];
      }
    }

    // This field holds the document's own definition blocks — leave their content
    // exactly as stored, so the template can be authored on its own page, and
    // give them the instance id the unlock toggle keys on.
    if (Object.values(fieldBlocks).some((block) => isOwnTemplate(block?.templateId))) {
      const stamped = { ...result.blocks };
      for (const [uid, block] of Object.entries(fieldBlocks)) {
        stamped[uid] = stampDefinitionInstanceIds(block, isOwnTemplate);
      }
      result.blocks = stamped;
      continue;
    }

    const templateState = {};
    const { blocks: newBlocks, layout: newLayout } = await expandBlocksField(
      fieldBlocks,
      layout,
      allowedLayouts,
      templateState
    );

    // Remove old field blocks dropped during template processing, then merge in
    // the new blocks. Blocks from other fields must remain.
    const updatedBlocks = { ...result.blocks };
    for (const oldId of Object.keys(fieldBlocks)) {
      if (!newBlocks[oldId]) {
        delete updatedBlocks[oldId];
      }
    }
    result.blocks = { ...updatedBlocks, ...newBlocks };
    result.blocks_layout = { ...result.blocks_layout, [fieldName]: newLayout };
  }

  return {
    merged: result,
    newTemplateIds: Array.from(allNewTemplateIds),
  };
}
