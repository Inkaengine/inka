const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Is `uri` an address on this computer's loopback (plain http, as a local
 * listener is), and so somewhere a person's token may be sent? Anything else
 * — another site, or a name that only starts like a local one — is not.
 */
export function loopbackRedirect(uri) {
  let url;
  try {
    url = new URL(uri);
  } catch (error) {
    if (error instanceof TypeError) return false; // not a URL at all
    throw error;
  }
  return url.protocol === 'http:' && LOOPBACK.has(url.hostname);
}
