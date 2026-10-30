/**
 * The admin's API proxy (Volto's devproxy, /++api++) asks the API only for
 * encodings it can decode.
 *
 * The proxy passes each API response through http-proxy-middleware's
 * responseInterceptor, which decodes gzip, deflate and brotli, and drops
 * content-encoding from every response it passes on, decoded or not. A
 * browser asking for zstd had its Accept-Encoding forwarded, the API (or the
 * CDN or edge in front of it) answered in zstd, and the body went out
 * labelled as plain JSON; the edge in front of the admin then compressed it
 * again. A browser undid one layer and got zstd where it expected JSON.
 *
 * Runs before the proxy (first in expressMiddleware). The edge in front of
 * the admin still compresses the answer to the browser, once.
 */
export const API_ACCEPT_ENCODING = 'gzip, deflate, br';

export function apiAcceptEncoding(req, res, next) {
  if (req.path.startsWith('/++api++')) {
    req.headers['accept-encoding'] = API_ACCEPT_ENCODING;
  }
  next();
}
