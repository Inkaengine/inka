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
 *
 * @returns {{ entry: object, previousEnhancer: Function | undefined }}
 */
export function mergeFrontendBlock(adminEntry, frontendEntry) {
  if (!adminEntry) return { entry: frontendEntry, previousEnhancer: undefined };
  const entry = { ...adminEntry, ...frontendEntry };
  const before = adminEntry.schemaEnhancer;
  const added = frontendEntry.schemaEnhancer;
  if (!before || !added) return { entry, previousEnhancer: undefined };
  if (typeof before === 'function') return { entry, previousEnhancer: before };
  const asList = (r) => (Array.isArray(r) ? r : [r]);
  entry.schemaEnhancer = [...asList(before), ...asList(added)];
  return { entry, previousEnhancer: undefined };
}
