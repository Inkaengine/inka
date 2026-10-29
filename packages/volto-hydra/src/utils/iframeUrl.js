/**
 * Compose a frontend iframe URL: query params (access token, edit flag) plus
 * the content path — appended to the HASH for hash-routed frontends (the
 * reference test-frontend) and to the pathname for path-routed ones (Next.js
 * etc.). Extracted from Iframe/View.jsx so the compare view builds pane URLs
 * the same way the editor builds its canvas URL.
 */
export const addUrlParams = (url, qParams, pathname) => {
  const urlObj = new URL(url);
  for (const [key, value] of Object.entries(qParams)) {
    urlObj.searchParams.set(key, value);
  }
  const path = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  if (urlObj.hash) {
    // Support both /#/ and /# - normalize by removing trailing slash before appending
    const hashBase = urlObj.hash.replace(/\/$/, '');
    urlObj.hash = `${hashBase}/${path}`;
  } else {
    urlObj.pathname += `${path}`;
  }
  return urlObj.toString();
};

/**
 * The URL of the adapter's page on a frontend: `hydra-proxy.html`, addressed
 * the same way that frontend addresses any other page.
 *
 * It composes rather than overwrites, because both parts of the address matter.
 * Assigning an absolute `/hydra-proxy.html` got the canvas as it is actually
 * deployed (`pnpm run canvas`: hash-routed, under `/canvas/`) wrong twice over —
 * it dropped the base path, and asked for a path no hash-routed static build
 * serves, since `ssr: false` prerenders no per-route files. The proxy 404'd, so
 * no adapter announced, so every request sat behind a gate that never opened
 * and the editor never loaded.
 *
 * `_edit` is dropped: this frame hosts an adapter and renders nothing, so it is
 * neither the edit nor the view canvas.
 */
export const proxyFrameUrl = (frontendUrl, token) => {
  const params = token ? { access_token: token } : {};
  const url = new URL(addUrlParams(frontendUrl, params, 'hydra-proxy.html'));
  url.searchParams.delete('_edit');
  return url.toString();
};
