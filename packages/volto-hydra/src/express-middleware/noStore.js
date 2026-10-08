/**
 * Inka's pages are never kept by a shared cache.
 *
 * Each page the editor's server renders is for one signed-in editor, and it
 * carries this deployment's settings (which front ends to frame, where the
 * API is). Volto sends no Cache-Control on a page, and leaves caching to the
 * proxy in front of it; a CDN left at its defaults then keeps the page for
 * weeks, and serves the old settings after a deploy. So every response that
 * reaches this middleware is `no-store`, and stays so: Volto's own error page
 * asks for `public, max-age=60`, and a shared cache would keep that too.
 *
 * Build assets are served before any middleware runs, so their long cache
 * lifetime (their names change with each build) is untouched.
 */
export const NO_STORE = 'no-store';

export function noStore(req, res, next) {
  const setHeader = res.setHeader.bind(res);
  res.setHeader = (name, value) =>
    setHeader(
      name,
      String(name).toLowerCase() === 'cache-control' ? NO_STORE : value,
    );
  res.setHeader('Cache-Control', NO_STORE);
  next();
}
noStore.id = 'inka-no-store';
