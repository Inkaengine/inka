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

/**
 * The field a list region's items are keyed by, as its schema names it.
 *
 * It differs per list — a slider's slides are keyed by `@id`, a table's rows
 * by `key`, a form's fields by `field_id` — and only the block's schema knows
 * which. A list region that does not say throws: an assumed field reads every
 * item's id as undefined, and a reorder, delete or edit then matches nothing.
 *
 * @param {Object} fieldDef - the region's field definition
 * @param {string} where - names the block and field, for the error
 */
export function regionIdField(fieldDef, where) {
  if (!fieldDef?.idField) {
    throw new Error(
      `${where}: this object_list region declares no idField. Name the field its ` +
        "items are keyed by ('@id', 'key', 'field_id', ...): none is assumed.",
    );
  }
  return fieldDef.idField;
}
