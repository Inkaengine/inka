/**
 * Which field definitions are REGIONS: fields whose items are sub-blocks —
 * blocks with ids, selectable on the canvas, seeded when empty, added with +.
 *
 * `widget: 'blocks_layout'` always is. `widget: 'object_list'` is by default;
 * `subBlocks: false` makes it a plain list of objects instead, edited with
 * Volto's object-list widget in the sidebar and stored as it is — for items
 * that cannot be edited where they are drawn, like a dropdown's options.
 */

/** An object_list whose items are sub-blocks (the default). */
export function isObjectListRegion(fieldDef) {
  return fieldDef?.widget === 'object_list' && fieldDef.subBlocks !== false;
}

/** A field whose items are sub-blocks: a blocks_layout, or an object_list region. */
export function isRegionField(fieldDef) {
  return fieldDef?.widget === 'blocks_layout' || isObjectListRegion(fieldDef);
}
