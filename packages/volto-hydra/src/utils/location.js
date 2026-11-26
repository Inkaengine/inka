/**
 * A Location criterion's value, as the listing widget shows it: the place
 * (`base`), whether only what is under it is listed (`childrenOnly`), and
 * Plone's `::depth`.
 *
 * Inka's listing locations end in `/` (the place and what is under it) or `/*`
 * (only what is under it); see the frontend guide's "Locations". The place is a
 * folder's UID for an Absolute path, and for a Relative path `.` (here), `..`
 * (the parent), or `/*`, `/*\/*`, `/*\/*\/*` (the page's 2nd, 3rd and 4th level
 * section, the site root being the 1st).
 *
 * A value with neither ending (Volto's `.`, `..`, `uid::1`) means what it means
 * to Plone: the place is a result except at depth 1. It reads as that and is
 * written back with the ending that keeps that meaning. A value whose depth is
 * not a number is kept as it is, so it is shown rather than lost.
 */
const NONE = { base: '', childrenOnly: false, depth: null };

export function parseLocation(value) {
  if (!value) return NONE;
  const sep = value.lastIndexOf('::');
  let body = value;
  let depth = null;
  if (sep !== -1) {
    const depthText = value.substring(sep + 2);
    if (!/^\d+$/.test(depthText)) return { ...NONE, base: value };
    body = value.substring(0, sep);
    depth = Number(depthText);
  }
  if (body === '/' || body === '/*') {
    // `/` is the site root with no ending: Plone's rule, as the listing reads it.
    return { base: '/', childrenOnly: body === '/*' || depth === 1, depth };
  }
  if (body.endsWith('/')) {
    return { base: body.slice(0, -1), childrenOnly: false, depth };
  }
  if (body.endsWith('/*')) {
    return { base: body.slice(0, -2), childrenOnly: true, depth };
  }
  return { base: body, childrenOnly: depth === 1, depth };
}

export function formatLocation({ base, childrenOnly, depth }) {
  if (!base) return '';
  const value = `${base === '/' ? '' : base}${childrenOnly ? '/*' : '/'}`;
  return depth === null ? value : `${value}::${depth}`;
}
