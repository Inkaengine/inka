/**
 * The blocks Inka itself provides. Every other block a site uses is its
 * frontend's to declare (its blocks config, sent at initBridge).
 *
 * `slate`: the rich text every region's text is written in. Its schema (the
 * `value` field the bridge and the text editor work on) is Inka's, so a
 * frontend adds rules to it but never declares it.
 */
export const INKA_BLOCK_TYPES = ['slate'];

/**
 * Every block an `allowedBlocks` list names, at any depth of a block's config
 * or the page's schema, that is neither declared nor Inka's own. A name nobody
 * declares is a block the editor can't offer, edit or draw: the editor refuses
 * to load on one (View.jsx, validateFrontendConfig) and the content check
 * reports it, from the same function.
 *
 * @param {Object} blocksConfig - the frontend's blocks, by type
 * @param {Object} [pageSchema] - the page's schema, whose regions name blocks too
 * @returns {{ rule: string, types: string[], message: string }[]}
 */
export function undeclaredBlockProblems(blocksConfig, pageSchema = null) {
  const known = (type) => INKA_BLOCK_TYPES.includes(type) || Object.hasOwn(blocksConfig || {}, type);
  const problems = [];
  const visit = (owner, node, path, seen) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(owner, item, [...path, i], seen));
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'allowedBlocks' && Array.isArray(value)) {
        for (const type of value) {
          if (typeof type !== 'string' || known(type)) continue;
          problems.push({
            rule: 'undeclared-block',
            types: [owner],
            message:
              `${owner}: allowedBlocks at ${path.length ? path.join('.') : 'the block'} ` +
              `names "${type}", which the frontend doesn't declare`,
          });
        }
      } else {
        visit(owner, value, [...path, key], seen);
      }
    }
  };
  for (const [type, config] of Object.entries(blocksConfig || {})) {
    visit(type, config, [], new WeakSet());
  }
  if (pageSchema) visit('page', pageSchema, [], new WeakSet());
  return problems;
}
