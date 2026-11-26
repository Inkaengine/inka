/**
 * What edit_blocks' `update` makes of a block: the fields its `set` names
 * change, and nothing else does (inka#674). Both are in stored shape.
 *
 * - A field set to null is removed: the one way to take away a field, a stray
 *   one included (a block's background stored where nothing reads it).
 * - A field that is an object of fields (`styles`, an objectBlocks' `content`:
 *   widget "object" with a schema of its own) takes the fields named, by the
 *   same rules, and keeps the rest. Changing one style keeps the others.
 * - A region named (`blocks_layout.<region>`, with its blocks in `blocks`)
 *   becomes the blocks sent, kept by id; a block it no longer lists is gone.
 *   A container's regions share `blocks`, so the other regions keep theirs.
 * - Any other value is replaced whole: a link (its object is the target's
 *   summary, which a merge would leave stale), a list, rich text.
 *
 * `schema` is the block type's blockSchema as getBlockSchemas gives it:
 * `properties`, with a nested `schema` for an object of fields.
 */

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function patchBlock(block, patch, schema) {
  const out = { ...block };
  const properties = schema?.properties ?? {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'blocks' || key === 'blocks_layout') continue;
    const facts = properties[key];
    if (value === null) {
      delete out[key];
    } else if (facts?.widget === 'object' && facts.schema && isPlainObject(value)) {
      out[key] = patchBlock(isPlainObject(block[key]) ? block[key] : {}, value, facts.schema);
    } else {
      out[key] = value;
    }
  }
  if (patch.blocks_layout !== undefined || patch.blocks !== undefined) {
    if (!isPlainObject(patch.blocks_layout) || !isPlainObject(patch.blocks)) {
      throw new Error('a region is changed by naming it: its blocks and its layout come together');
    }
    const blocks = { ...block.blocks };
    const layout = { ...block.blocks_layout };
    for (const [region, ids] of Object.entries(patch.blocks_layout)) {
      for (const id of layout[region] ?? []) delete blocks[id];
      for (const id of ids) {
        if (!patch.blocks[id]) throw new Error(`region ${region} lists ${id}, which the change does not give`);
        blocks[id] = patch.blocks[id];
      }
      layout[region] = ids;
    }
    out.blocks = blocks;
    out.blocks_layout = layout;
  }
  return out;
}
