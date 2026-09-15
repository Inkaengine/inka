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
