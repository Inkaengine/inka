/**
 * The fields a block edits on the canvas through a picker: pictures and links.
 *
 * One answer, read by discovery (which picks examples that set them) and by the
 * render check (which looks for their edit annotations), so the two never
 * disagree about which fields those are. Pure.
 */

/**
 * The annotation a schema field is edited through, if any. `image` /
 * `object_browser` say what kind of picker the field wants; text and textarea
 * are deliberately absent (an image's `alt` is a sidebar attribute, and a
 * textarea is not uniformly canvas content).
 *
 * @returns {{ kind: 'media' | 'link', attr: string } | null}
 */
export function canvasFieldKind(prop) {
  const w = prop?.widget;
  const mode = prop?.mode;
  if (w === 'image' || (w === 'object_browser' && mode === 'image')) return { kind: 'media', attr: 'data-edit-media' };
  if (w === 'object_browser' && mode === 'link') return { kind: 'link', attr: 'data-edit-link' };
  return null;
}

const hasValue = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

/** The canvas fields (canvasFieldKind) `blockData` gives a value, in schema order. */
export function canvasFieldsSet(schema, blockData) {
  return Object.entries(schema?.properties ?? {})
    .filter(([field, prop]) => canvasFieldKind(prop) && hasValue(blockData?.[field]))
    .map(([field]) => field);
}
