/**
 * A frontend's entry for a block, applied to the admin's own entry for it.
 *
 * One rule, used by the admin (View.jsx, on INIT) and the mock parent alike,
 * so a test harness never sees a different block than the editor does:
 *
 * - Each key the frontend sends REPLACES the admin's value for that key —
 *   a `blockSchema` or `schema` included: the frontend renders the block, so
 *   its schema is the block's, not a set of fields merged into the admin's.
 * - Keys it does not send keep the admin's value, so an entry carrying only
 *   rules (a text block's `schemaEnhancer`) adds to the admin's block.
 * - `schemaEnhancer` CHAINS, the admin's first: an enhancer is a change to a
 *   schema, not the schema. Two recipes chain as a list of recipes. An admin
 *   enhancer that is a FUNCTION cannot be put in a recipe list, so it comes
 *   back as `previousEnhancer` for the caller to chain (the admin's
 *   createSchemaEnhancerFromRecipe takes it).
 * - Except over a frontend's own schema: an entry with a `blockSchema` or
 *   `schema` owns the WHOLE schema, so the admin's enhancer is not applied —
 *   it changes the admin's schema (adds its fields, seeds its regions), and
 *   laid over the frontend's it offered fields the frontend never said it
 *   renders. Only the frontend's own enhancer stands. Variations follow the
 *   same rule (View.jsx empties the admin's for a block with a frontend schema).
 *
 * A block the admin does NOT have takes the frontend entry as it is, and
 * needs a `title` and a `group` from it — compulsory, never made up from the
 * key: a chooser entry with an invented name is a bug hidden, not fixed.
 *
 * Every `allowedBlocks` list the entry carries, at any depth of its schema,
 * must be block type names only: a gap (a stray comma) or a null would offer
 * an unnamed type in the chooser.
 *
 * @returns {{ entry: object, previousEnhancer: Function | undefined }}
 */
export function mergeFrontendBlock(blockType, adminEntry, frontendEntry) {
  checkAllowedBlocks(blockType, frontendEntry, [], new WeakSet());
  if (!adminEntry) {
    if (!frontendEntry.title || !frontendEntry.group) {
      throw new Error(
        `Block "${blockType}" from the frontend needs a \`title\` and a \`group\` ` +
          `(got title: ${JSON.stringify(frontendEntry.title)}, group: ${JSON.stringify(frontendEntry.group)})`,
      );
    }
    return { entry: frontendEntry, previousEnhancer: undefined };
  }
  const entry = { ...adminEntry, ...frontendEntry };
  if (frontendEntry.blockSchema || frontendEntry.schema) {
    if (frontendEntry.schemaEnhancer) entry.schemaEnhancer = frontendEntry.schemaEnhancer;
    else delete entry.schemaEnhancer;
    return { entry, previousEnhancer: undefined };
  }
  const before = adminEntry.schemaEnhancer;
  const added = frontendEntry.schemaEnhancer;
  if (!before || !added) return { entry, previousEnhancer: undefined };
  if (typeof before === 'function') return { entry, previousEnhancer: before };
  const asList = (r) => (Array.isArray(r) ? r : [r]);
  entry.schemaEnhancer = [...asList(before), ...asList(added)];
  return { entry, previousEnhancer: undefined };
}

function checkAllowedBlocks(blockType, node, path, seen) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    node.forEach((item, i) => checkAllowedBlocks(blockType, item, [...path, i], seen));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'allowedBlocks' && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'string' || !value[i]) {
          throw new Error(
            `Block "${blockType}": allowedBlocks at ${path.length ? path.join('.') : 'the block'} ` +
              `has [${i}] = ${value[i] === undefined ? 'undefined' : JSON.stringify(value[i])}`,
          );
        }
      }
    } else {
      checkAllowedBlocks(blockType, value, [...path, key], seen);
    }
  }
}
