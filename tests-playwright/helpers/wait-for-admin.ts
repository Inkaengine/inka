/**
 * Wait for the admin (Volto) to be ready, used by global-setup.
 *
 * A refused connection means "not listening yet, keep waiting". That happens
 * when the servers are started outside Playwright's `webServer` (NO_WEBSERVER,
 * or a CI step that backgrounds them) and global setup gets here first.
 */

/**
 * Is this the error of a refused connection?
 *
 * Node's global `fetch` (undici) throws `TypeError: fetch failed` with no
 * `code` of its own: the reason is on `error.cause`. When `localhost` resolves
 * to both IPv4 and IPv6, `cause` is an AggregateError that carries the code
 * itself. Bun puts the code on the error, so both places are read.
 */
export function isConnectionRefused(error: any): boolean {
  return (error?.code ?? error?.cause?.code) === 'ECONNREFUSED';
}

export interface WaitForAdminOptions {
  /** Where the admin answers: its `/health`, or the SSR server in production mode. */
  healthUrl: string;
  /** Production server (any 200 is ready) rather than the webpack dev server's `/health`. */
  usePrebuilt?: boolean;
  /** How many times to ask before giving up. Default 60 (5 minutes at 5s). */
  maxRetries?: number;
  /** Milliseconds between asks. Default 5000. */
  retryDelay?: number;
}

export async function waitForAdmin({
  healthUrl,
  usePrebuilt = false,
  maxRetries = 60, // 60 retries * 5 seconds = 5 minutes max wait
  retryDelay = 5000, // 5 seconds between retries
}: WaitForAdminOptions): Promise<void> {
  const serverType = usePrebuilt ? 'production server' : 'webpack compilation';

  console.log(`[SETUP] Checking Volto ${serverType} status...`);

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(healthUrl);
      const text = await response.text();

      if (usePrebuilt) {
        // For production server, any 200 response means ready
        if (response.status === 200) {
          console.log('[SETUP] ✓ Volto production server ready');
          return;
        }
      } else {
        // For dev server, check health endpoint status
        if (response.status === 200 && text === 'OK') {
          console.log('[SETUP] ✓ Volto webpack compilation successful');
          return;
        } else if (response.status === 503) {
          console.log(`[SETUP] Waiting for compilation... (${text.trim()})`);
        } else if (response.status === 500) {
          console.error(`[SETUP] ✗ Compilation failed: ${text}`);
          throw new Error(`Webpack compilation failed: ${text}`);
        }
      }
    } catch (error: any) {
      if (isConnectionRefused(error)) {
        console.log(`[SETUP] Waiting for Volto ${serverType} to start...`);
      } else {
        throw error;
      }
    }

    // Wait before next retry
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }

  throw new Error(
    `Timeout waiting for Volto ${serverType} to complete. Check ${healthUrl}`,
  );
}
