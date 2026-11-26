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

/**
 * Whether a canvas field's value is drawn as itself: among `drawn` (the
 * addresses a render's links, forms, embeds and images point at), resolved
 * against `base`.
 *
 * A link is its exact address — another query is another address, so a search
 * page drawn only as the start of each result's search is not drawn. A
 * picture is its item or any scale of it (`<item>/@@images/…`). A field whose
 * value never appears as itself is a setting, edited in the sidebar, so the
 * coverage rule has no annotation to ask for.
 */
export function drawnAsItself(kind, value, drawn, base) {
  const ref = Array.isArray(value) ? value[0] : value;
  const raw = typeof ref === 'string' ? ref : ref?.['@id'];
  if (!raw) return false;
  // A site path (no host of its own) is the same item wherever it is drawn
  // from: frontends serve images, and some links, from the API's host.
  const onSite = !/^[a-z][a-z0-9+.-]*:/i.test(raw);
  const want = new URL(raw, base);
  const path = want.pathname.replace(/\/$/, '');
  return drawn.some((d) => {
    const got = new URL(d, base);
    if (!onSite && got.origin !== want.origin) return false;
    const gotPath = got.pathname.replace(/\/$/, '');
    if (kind === 'link') return gotPath === path && got.search === want.search;
    return gotPath === path || gotPath.startsWith(`${path}/`);
  });
}
