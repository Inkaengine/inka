/**
 * Template merging utilities.
 *
 * The admin's side of the template merge. Pure data, like the rest of the
 * helpers: no Volto, DOM or bridge imports.
 */

import {
  expandTemplates,
  adoptTemplate,
  assertAllExpanded,
  getChildFields,
  ensureMutablePath,
  getChildBlockEntries,
  setChildBlockEntries,
  isUnlabelledDefinition,
} from './index.js';

/**
 * Merge templates into page data. Expands template references in every blocks field via
 * the public merge (expandTemplates), then re-enters every container the result holds,
 * as a frontend does: the merge expands one list per call, so a container's children, a
 * template's own or a plain container's, are only expanded when it is re-entered.
 *
 * The rules: docs/frontend-guide/templates.md "How the Merge Works". The reverse
 * direction is mergeInstanceIntoTemplate, the same merge. Both are checked by
 * mergeTemplates.rules.test.js.
 *
 * @param {Object} page - Page formData
 * @param {Object} options
 * @param {Function} options.loadTemplate - Async function: (templateId) => Promise<templateData>
 * @param {Object} options.pageBlocksFields - Map of field names to field config (e.g. { blocks_layout: { allowedLayouts: [...] } })
 * @param {Function} options.uuidGenerator - Mints the ids of blocks new to the page
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

function adoptUnlabelledDefinition(page, idFieldMap) {
  if (!isUnlabelledDefinition(page, idFieldMap) || !page['@id']) return { ...page };
  return { ...adoptTemplate(page, new URL(page['@id'], 'http://x').pathname) };
}

export async function mergeTemplatesIntoPage(page, options = {}) {
  const {
    loadTemplate,
    pageBlocksFields = { items: {} },
    uuidGenerator,
    skipOwnTemplate = false,
    preloadedTemplates = {},
    firstInsert,
    idFieldMap,
  } = options;

  // A definition need not name itself: opened for editing, a document whose top-level
  // blocks hold slots but name no template IS a template definition. Label its own
  // blocks with its path (adoptTemplate — the same rule a template applied to a page
  // follows), so it comes up exactly as a definition that names itself does.
  let result = skipOwnTemplate ? adoptUnlabelledDefinition(page, idFieldMap) : { ...page };
  const allNewTemplateIds = new Set();

  // Options every expand call shares, top level and every re-entry.
  const expandOptions = (templateState) => ({
    templateState,
    loadTemplate,
    preloadedTemplates,
    uuidGenerator,
    firstInsert,
  });

  // READ docs/architecture.md "Merging templates: every container is expanded, by
  // whoever renders" before changing this. Do not remove it as redundant.
  //
  // Re-enter every container of a block, at every depth — the frontend contract,
  // which the admin keeps too. The merge has no schema and expands one list per call,
  // so a container's children are expanded only when it is re-entered, a template's
  // own containers included. The SAME templateState throughout: it holds what each
  // template left waiting, and recognises what is already expanded. Regions are read and written through the helpers'
  // storage-agnostic accessors (blocks_layout regions and object_list arrays alike).
  async function expandContainers(block, templateState) {
    const fields = getChildFields(block, idFieldMap, { allObjectLists: true, templateChildren: true });
    if (fields.length === 0) return block;
    // setChildBlockEntries writes into its argument; INITIAL_DATA arrives frozen.
    const out = { ...block, ...(block.blocks ? { blocks: { ...block.blocks } } : {}) };
    for (const field of fields) {
      const entries = getChildBlockEntries(out, field);
      if (entries.length === 0) continue;
      const items = field.isObjectList
        ? await expandTemplates(entries.map((entry) => entry.block), {
            ...expandOptions(templateState),
            idField: field.idField,
          })
        : await expandTemplates(entries.map((entry) => entry.id), {
            ...expandOptions(templateState),
            blocks: Object.fromEntries(entries.map((entry) => [entry.id, entry.block])),
          });
      const expanded = [];
      for (const { '@uid': id, ...child } of items) {
        expanded.push({ id, block: await expandContainers(child, templateState) });
      }
      // A filled region's blocks replace the template's, which waited under other ids.
      if (!field.isObjectList) {
        const kept = new Set(expanded.map(({ id }) => id));
        const container = ensureMutablePath(out, field.regionPath || []);
        container.blocks = { ...container.blocks };
        for (const { id } of entries) {
          if (!kept.has(id)) delete container.blocks[id];
        }
      }
      setChildBlockEntries(out, field, expanded);
    }
    return out;
  }

  // Expand one page-level blocks field via the PUBLIC merge, then re-enter each
  // emitted block's containers, and reshape the items back into a blocks dict + layout.
  async function expandBlocksField(blocks, layout, allowedLayouts, templateState) {
    const items = await expandTemplates(layout, {
      ...expandOptions(templateState),
      blocks,
      allowedLayouts,
    });

    const newBlocks = {};
    const newLayout = [];
    for (const item of items) {
      const { '@uid': blockId, ...block } = item;
      newLayout.push(blockId);
      newBlocks[blockId] = await expandContainers(block, templateState);
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

    // The ids the merge mints are seeded by where they are, this page's field
    // included, so another page's (or field's) differ.
    const templateState = { scope: `${page['@id']}#${fieldName}` };
    const { blocks: newBlocks, layout: newLayout } = await expandBlocksField(
      fieldBlocks,
      layout,
      allowedLayouts,
      templateState
    );
    assertAllExpanded(templateState);

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

/**
 * Every block of one template instance, wherever it sits — the page's top level, a
 * footer region, or inside a container at any depth — and the order each region
 * holds them in, keyed by the region's path. Read through the helpers' container
 * accessors (blocks_layout regions and object_list fields alike), never from
 * formData.blocks alone: an instance inside a container is not there (CLAUDE.md,
 * "Block Access"; docs/architecture.md, "Merging templates").
 *
 * @param {Object} formData - the page
 * @param {string} instanceId
 * @param {Object} idFieldMap - { blockType: { field: idField } }
 * @returns {{ blocks: Object, regions: Object, layouts: Object }} the instance's
 *   blocks, the order of its blocks in each region, and each region's full order
 */
export function instanceContent(formData, instanceId, idFieldMap) {
  const blocks = {};
  const regions = {};
  const layouts = {};
  const visit = (container, path) => {
    for (const field of getChildFields(container, idFieldMap, { allObjectLists: true })) {
      const entries = getChildBlockEntries(container, field);
      const key = `${path}/${[...(field.regionPath || []), field.region].join('/')}`;
      layouts[key] = entries.map((entry) => entry.id);
      const own = entries
        .filter((entry) => entry.block?.templateInstanceId === instanceId)
        .map((entry) => entry.id);
      if (own.length) regions[key] = own;
      for (const { id, block } of entries) {
        if (block?.templateInstanceId === instanceId) blocks[id] = block;
        else if (block) visit(block, `${path}/${id}`);
      }
    }
  };
  visit(formData, '');
  return { blocks, regions, layouts };
}

/**
 * The page without the editor's `empty` placeholders, at any depth. A
 * placeholder is not page content, and is never stored (a page save strips
 * them too). Merged into a template it was stored as the template's own block,
 * and, counted as the `default` slot in a region the page stores before the
 * slot's own, it moved the slot there (inka#705).
 */
function withoutPlaceholders(container, idFieldMap) {
  const fields = getChildFields(container, idFieldMap, { allObjectLists: true });
  if (!fields.length) return container;
  const out = { ...container };
  for (const field of fields) {
    const kept = getChildBlockEntries(container, field)
      .filter(({ block }) => block?.['@type'] !== 'empty')
      .map(({ id, block }) => ({ id, block: withoutPlaceholders(block, idFieldMap) }));
    setChildBlockEntries(out, field, kept);
  }
  // A blocks_layout region's entries are added to the shared dict, never taken
  // out of it: drop what no region lists any more.
  if (out.blocks && out.blocks_layout) {
    const listed = new Set(Object.values(out.blocks_layout).flat());
    out.blocks = Object.fromEntries(Object.entries(out.blocks).filter(([id]) => listed.has(id)));
  }
  return out;
}

/**
 * "Change on all pages": one template instance on a page, merged into its template.
 * The instance's own blocks, wherever it sits (instanceContent), in its own order:
 * the merge reads a page's top-level regions, and a nested instance is not in them.
 *
 * The same merge as opening a page, the other way round: the rules are
 * docs/frontend-guide/templates.md "How the Merge Works", checked both ways by
 * mergeTemplates.rules.test.js.
 *
 * @param {Object} template - the template document, as stored
 * @param {Object} page - the page holding the instance
 * @param {string} instanceId
 * @param {Object} options - idFieldMap, and uuidGenerator for the ids of blocks new to the template
 * @returns {Promise<{merged: Object, newTemplateIds: string[]}>} the template to save
 */
export async function mergeInstanceIntoTemplate(template, page, instanceId, { idFieldMap, uuidGenerator }) {
  const instance = instanceContent(withoutPlaceholders(page, idFieldMap), instanceId, idFieldMap);
  const instancePage = {
    ...page,
    blocks: instance.blocks,
    blocks_layout: { items: Object.values(instance.regions).flat() },
  };
  return mergeTemplatesIntoPage(template, {
    loadTemplate: async () => instancePage,
    uuidGenerator,
    idFieldMap,
  });
}
