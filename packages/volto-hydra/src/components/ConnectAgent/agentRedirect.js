const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Where a person's token may be sent from the connect page, or null:
 * - 'local': an address on this computer's loopback (plain http, as a local
 *   MCP server's one-off listener is);
 * - 'hosted': exactly this site's MCP server's sign-in callback
 *   (`<mcpUrl>/oauth/callback`, from RAZZLE_INKA_MCP_URL), when it has one.
 * Anything else — another site, a name that only starts like a local one, a
 * look-alike of the MCP server's address — is not.
 */
export function agentRedirect(uri, mcpUrl) {
  let url;
  try {
    url = new URL(uri);
  } catch (error) {
    if (error instanceof TypeError) return null; // not a URL at all
    throw error;
  }
  if (url.protocol === 'http:' && LOOPBACK.has(url.hostname)) return 'local';
  if (mcpUrl && url.href === new URL('/oauth/callback', mcpUrl).href) return 'hosted';
  return null;
}
