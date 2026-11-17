/**
 * The blocks a page's template owns, which a markdown export leaves out.
 *
 * A page made from a template stores copies of the template's locked blocks: the
 * admin's save writes the merged page. They are the template's, not the page's: every
 * reader merges the template in, and the merge takes a locked block from the template.
 * Written into the page's markdown, each is a tagged copy of the template's words.
 *
 * A block is the template's when it is locked (`fixed` and `readOnly`), names another
 * page as its template, and that template still has a locked block in its slot (one it
 * no longer has would not come back). A locked block that holds blocks of its own stays:
 * a layout's regions hold the page's content.
 */

// Every block in a page, at any depth of blocks dicts.
function* allBlocks(container) {
  for (const block of Object.values(container?.blocks ?? {})) {
    yield block;
    yield* allBlocks(block);
  }
}

const isLocked = (block) => block?.fixed === true && block?.readOnly === true;
const holdsBlocks = (block) => Object.keys(block?.blocks ?? {}).length > 0;

function templateOwns(block, pageId, { pathOf, load }) {
  if (!isLocked(block) || !block.templateId || holdsBlocks(block)) return false;
  const path = pathOf(block.templateId);
  if (path === pageId) return false; // the template's own page
  const template = path && load(path);
  if (!template) throw new Error(`${pageId}: template ${block.templateId} is not in the content`);
  for (const own of allBlocks(template)) {
    if (isLocked(own) && own.slotId === block.slotId) return true;
  }
  return false;
}

// The container without the blocks `drop` names, from its blocks and every layout list.
function without(container, drop) {
  if (!container?.blocks) return container;
  const blocks = {};
  for (const [id, block] of Object.entries(container.blocks)) {
    if (!drop.has(block)) blocks[id] = without(block, drop);
  }
  const layout = {};
  for (const [region, ids] of Object.entries(container.blocks_layout ?? {})) {
    layout[region] = Array.isArray(ids) ? ids.filter((id) => id in blocks) : ids;
  }
  return { ...container, blocks, blocks_layout: layout };
}

/**
 * The page without the blocks its templates own.
 *
 * @param {Object} page - a stored page, with `@id` its served path
 * @param {Object} templates
 * @param {function(string): string|null} templates.pathOf - a template reference's path
 *   (a `resolveuid/…` or a path)
 * @param {function(string): Object|undefined} templates.load - the page at a path
 * @returns {Object} a new page; the input is not changed
 */
function withoutTemplateOwnedBlocks(page, templates) {
  const drop = new Set();
  for (const block of allBlocks(page)) {
    if (templateOwns(block, page['@id'], templates)) drop.add(block);
  }
  return drop.size ? without(page, drop) : page;
}

module.exports = { withoutTemplateOwnedBlocks };
