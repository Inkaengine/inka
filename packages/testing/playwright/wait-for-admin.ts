/**
 * Wait for the admin to be ready, used by global setup.
 *
 * A refused connection means "not listening yet, keep waiting".
 */
import { harnessUrls } from '../ports';

export interface AdminOptions {
  /**
   * The URL to poll. Default: VOLTO_HEALTH_URL, else the admin itself when
   * prebuilt (USE_PREBUILT=true) or its webpack dev server's /health.
   */
  healthUrl?: string;
  /** A production build: any 200 means ready. Default: USE_PREBUILT=true. */
  prebuilt?: boolean;
  /** Give up after this long. Default: 5 minutes. */
  timeoutMs?: number;
  /** Milliseconds between asks. Default: 5000. */
  retryDelayMs?: number;
}

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

/**
 * Wait for the admin to be ready: a production server answering, or the dev
 * server's webpack compilation finishing. Throws on a failed compilation.
 */
export async function waitForAdmin(options: AdminOptions = {}): Promise<void> {
  const retryDelay = options.retryDelayMs ?? 5000;
  const maxRetries = Math.ceil((options.timeoutMs ?? 5 * 60_000) / retryDelay);

  const usePrebuilt = options.prebuilt ?? process.env.USE_PREBUILT === 'true';
  const healthUrl =
    options.healthUrl ??
    process.env.VOLTO_HEALTH_URL ??
    (usePrebuilt ? harnessUrls().voltoSsr : `${harnessUrls().voltoWebpack}/health`);
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
