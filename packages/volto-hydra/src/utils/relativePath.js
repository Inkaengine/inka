/**
 * A relative-path Location criterion's value: a path from the listing's page,
 * and optionally `::depth` — how many levels below it to list
 * (plone.app.querystring `_relativePath`). `.::1` is the page's own children,
 * `./` everything under it, `..` the parent's tree.
 *
 * `.` and `./` are the same path to Plone, as are `..` and `../`; both read as
 * the slash form the menu offers. Anything else — a deeper path, or a depth
 * that is not a number — is kept as it is, so it is shown rather than lost.
 */
const SAME_AS = { '.': './', '..': '../' };

export function parseRelativePath(value) {
  if (!value) return { path: '', depth: null };
  const sep = value.lastIndexOf('::');
  let path = value;
  let depth = null;
  if (sep !== -1) {
    const depthText = value.substring(sep + 2);
    if (!/^\d+$/.test(depthText)) return { path: value, depth: null };
    path = value.substring(0, sep);
    depth = Number(depthText);
  }
  return { path: SAME_AS[path] ?? path, depth };
}

export function formatRelativePath({ path, depth }) {
  return depth === null ? path : `${path}::${depth}`;
}
