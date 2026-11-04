/**
 * The pieces of a Playwright global setup a harness suite runs before its
 * tests: block discovery for the sanity suites, warming a cold frontend, and
 * waiting for the admin to finish compiling.
 *
 * A suite's own globalSetup calls the ones it needs, in its own order:
 *
 *   export default async function globalSetup() {
 *     await discoverForFrontends({ discoveryDir, frontends: { nuxt: URLS.nuxt } });
 *     await waitForAdmin();
 *   }
 *
 * The environment variables a launcher sets (DISCOVER_BLOCKS_API,
 * MOCK_PARENT_URL, FRONTEND_URL, …) are read here, so every suite answers to
 * the same ones; an option given in code wins.
 */
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import { harnessUrls } from '../ports';
import { discoveryPath } from '../discovery';

const require = createRequire(import.meta.url);
const { discoverBlocks, buildEmptyRegionCases, collectListingContainerIssues } =
  require('../discover-blocks.cjs');

export interface FrontendRegistry {
  blocksConfig: Record<string, any>;
  frontendKeys: string[];
  styleMenuClasses: string[];
}

/**
 * Fetch the frontend's registered blocksConfig by loading mock-parent in a
 * headless browser and asking its bridge helper. Empty when the frontend never
 * sends its INIT.
 */
export async function fetchBlocksConfig(
  mockParentUrl: string,
  frontendUrl: string,
  apiUrl: string,
): Promise<FrontendRegistry> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const url = `${mockParentUrl}?api_path=${encodeURIComponent(`${apiUrl}/`)}&frontend=${encodeURIComponent(frontendUrl)}`;
    await page.goto(url, { timeout: 60000, waitUntil: 'load' });
    for (let i = 0; i < 75; i++) {
      const result = await page.evaluate(() => {
        const mp = (window as any).mockParent;
        const c = mp?.getBlocksConfig?.();
        const fk = mp?.getFrontendBlockKeys?.() || [];
        // The styles the frontend says it offers — what makes stored `styleName`
        // content authorable or not. Only the frontend knows.
        const sm = mp?.getStyleMenuClasses?.() || [];
        // Wait past mock-parent's own baseline (~10 types) for the frontend's INIT to land
        return c && Object.keys(c).length > 10
          ? { blocksConfig: c, frontendKeys: fk, styleMenuClasses: sm }
          : null;
      });
      if (result) return result;
      await new Promise((r) => setTimeout(r, 200));
    }
  } catch (err) {
    console.warn(`[SETUP] Failed to fetch blocksConfig: ${err}`);
  } finally {
    await browser.close();
  }
  return { blocksConfig: {}, frontendKeys: [], styleMenuClasses: [] };
}

/** Is a frontend actually serving in this job? */
export async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok || res.status === 404; // serving, even if / has no route
  } catch {
    return false;
  }
}

/**
 * Load a frontend once, in a browser, and wait until it has rendered an
 * annotated block.
 *
 * A dev-server frontend is slow on its FIRST real page load (Vite optimises
 * dependencies then), and whichever spec happens to run first pays for it:
 * `waitForIframeReady` gives up at 30s and its retries fire while the same
 * first compile is still running. On CI that made allowed-layouts fail three
 * times in a row as tests #1-#6 while all 851 later tests passed — a boot
 * race wearing the costume of a broken feature.
 *
 * This is not a wait-and-hope: it waits for the app's OWN signal (a block
 * carrying data-block-uid) and throws with the URL if that never arrives,
 * which is a genuinely broken environment worth failing on.
 */
export async function warmFrontend(url: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page
      .locator('[data-block-uid]')
      .first()
      .waitFor({ state: 'attached', timeout: 120000 });
    console.log(`[SETUP] ✓ ${url} rendered blocks`);
  } catch (error) {
    // BEST EFFORT, and deliberately so. This is a warm-up, not an assertion:
    // the tests remain the judge of whether the app works. A CI job whose
    // frontend does not serve this particular path (the bridge jobs mount
    // different content) must not be failed by the warm-up — that turned one
    // boot race into two red jobs.
    console.log(
      `[SETUP] ⚠ could not warm ${url} (${(error as Error).message.split('\n')[0]}) — ` +
        `the first spec will pay for the first render instead`,
    );
  } finally {
    await browser.close();
  }
}

export interface DiscoveryOptions {
  /** Where to write the discovery files (see `@inka/testing/discovery`). */
  discoveryDir: string;
  /**
   * The frontends to discover against, by the Playwright project that drives
   * each. Frontends that aren't up in this job are skipped quietly — a job runs
   * a subset by design.
   */
  frontends: Record<string, string>;
  /** The API to discover content from. Default: DISCOVER_BLOCKS_API; without either, nothing runs. */
  apiUrl?: string;
  /**
   * The API the schema fetch hands the frontend. Default: SCHEMA_FETCH_API,
   * then `apiUrl`. When discovery reads a REMOTE api (a live converted site),
   * the browser often can't complete that load (CORS, latency), so the schema
   * fetch can stay on a local one.
   */
  schemaApiUrl?: string;
  /** mock-parent.html. Default: MOCK_PARENT_URL, then the harness test frontend's. */
  mockParentUrl?: string;
  /** Stop after this many pages. Default: DISCOVER_MAX_PAGES, else every page. */
  maxPages?: number;
}

/**
 * Discover every block case the sanity suites run, from each frontend's own
 * registry, and write the discovery files. Does nothing when no API is named.
 *
 * Discovery runs PER FRONTEND, not once per job. A job can run several
 * frontends and they do not register the same blocks. Reading one registry and
 * applying it to all of them either misses a container region a frontend
 * declares (so its nested blocks are never discovered) or attributes a block to
 * a frontend that never claimed it. Each frontend gets its own pass, and every
 * discovered block carries the frontend it came from so the spec can run it
 * only there.
 *
 * FRONTEND_URL, when set, is one more frontend, named '(env)'.
 */
export async function discoverForFrontends(options: DiscoveryOptions): Promise<void> {
  const discoverApi = options.apiUrl ?? process.env.DISCOVER_BLOCKS_API;
  if (!discoverApi) return;
  const schemaApi = options.schemaApiUrl ?? process.env.SCHEMA_FETCH_API ?? discoverApi;
  const maxPages =
    options.maxPages ??
    (process.env.DISCOVER_MAX_PAGES ? parseInt(process.env.DISCOVER_MAX_PAGES, 10) : Infinity);
  const maxLabel = Number.isFinite(maxPages) ? `max ${maxPages} pages` : 'all pages';
  const mockParent =
    options.mockParentUrl ??
    process.env.MOCK_PARENT_URL ??
    `${harnessUrls().testFrontend}/mock-parent.html`;

  // The styles a frontend offers come from the frontend FRONTEND_URL names,
  // when the launcher gives one with MOCK_PARENT_URL.
  let styleMenuClasses: string[] = [];
  if (process.env.MOCK_PARENT_URL && process.env.FRONTEND_URL) {
    console.log(`[SETUP] Fetching blocksConfig via ${process.env.MOCK_PARENT_URL}...`);
    let blocksConfig: Record<string, any>;
    let frontendKeys: string[];
    ({ blocksConfig, frontendKeys, styleMenuClasses } = await fetchBlocksConfig(
      process.env.MOCK_PARENT_URL,
      process.env.FRONTEND_URL,
      schemaApi,
    ));
    console.log(
      `[SETUP] Got ${Object.keys(blocksConfig).length} block schemas from frontend ` +
        `(${frontendKeys.length} registered by frontend, rest baseline)`,
    );
  }

  console.log(`[SETUP] Discovering blocks from ${discoverApi} (${maxLabel})...`);
  // Two keys can point at the SAME server (a job sets FRONTEND_URL to the very
  // frontend it also names as a project). That is one frontend, not two:
  // scanning it twice doubles the slowest part of setup and emits a second,
  // identical set of cases. Named projects are considered first so a frontend
  // is tagged with its project name rather than the anonymous '(env)'.
  const normUrl = (u: string) => u.replace(/\/+$/, '');
  const candidates: Array<[string, string]> = Object.entries(options.frontends);
  // '(env)' is last on purpose: it is the fallback name for a frontend no
  // project claims, so it only gets used when FRONTEND_URL really is a server
  // none of the named entries above already cover.
  if (process.env.FRONTEND_URL) candidates.push(['(env)', process.env.FRONTEND_URL]);

  const seenUrls = new Set<string>();
  const targets: Array<[string, string]> = [];
  for (const [project, url] of candidates) {
    if (seenUrls.has(normUrl(url))) continue;
    seenUrls.add(normUrl(url));
    targets.push([project, url]);
  }

  const blocks: any[] = [];
  const perFrontend: Record<string, number> = {};
  let blocksConfig: Record<string, any> = {};
  let frontendKeys: string[] = [];
  for (const [project, url] of targets) {
    if (!(await reachable(url))) continue;
    const { blocksConfig: cfg, frontendKeys: keys } = await fetchBlocksConfig(
      mockParent, url, schemaApi);
    if (Object.keys(cfg).length === 0) {
      console.warn(`[SETUP] ${project} (${url}) returned no schemas — skipped`);
      continue;
    }
    const found = await discoverBlocks(discoverApi, maxPages, cfg, keys, styleMenuClasses);
    for (const b of found) blocks.push({ ...b, frontend: project });
    perFrontend[project] = found.length;
    blocksConfig = cfg;      // last one wins for the single-config uses below
    frontendKeys = keys;
  }
  if (blocks.length === 0) {
    throw new Error(
      '[SETUP] No frontend yielded schemas. Discovery would be type-only, and ' +
      'every schema-dependent check would pass by measuring nothing.\n' +
      '  Start at least one frontend and set MOCK_PARENT_URL so globalSetup ' +
      'can read its INIT.',
    );
  }
  console.log(
    `[SETUP] Discovered per frontend: ` +
    Object.entries(perFrontend).map(([p, n]) => `${p}=${n}`).join(', '),
  );

  fs.mkdirSync(options.discoveryDir, { recursive: true });
  const outPath = discoveryPath(options.discoveryDir, 'blocks');
  fs.writeFileSync(outPath, JSON.stringify(blocks, null, 2));
  console.log(`[SETUP] Wrote ${blocks.length} discovered blocks to ${outPath}`);

  // Coverage is reported PER FRONTEND, never unioned. A union answers the
  // wrong question: "some frontend has an example for this type" says nothing
  // about the frontend actually under test, and a type missing everywhere
  // would be listed once per frontend that missed it — noise that reads like
  // several distinct gaps.
  const byFrontend: Record<string, { types: number; noExample: string[] }> = {};
  for (const project of Object.keys(perFrontend)) {
    const mine = blocks.filter((b: any) => b.frontend === project);
    byFrontend[project] = {
      types: new Set(
        mine.filter((b: any) => b.blockData !== undefined).map((b: any) => b.blockType),
      ).size,
      noExample: [...new Set(mine.filter((b: any) => b.noExample).map((b: any) => b.blockType))],
    };
  }
  const coverage = { frontendKeys: frontendKeys.length, byFrontend };
  fs.writeFileSync(discoveryPath(options.discoveryDir, 'coverage'), JSON.stringify(coverage, null, 2));
  for (const [project, c] of Object.entries(byFrontend)) {
    console.log(
      `[SETUP] Example coverage [${project}]: ${c.types} types with examples, ` +
        `${c.noExample.length} without (${c.noExample.join(', ') || 'none'})`,
    );
  }

  // The empty-region sweep needs block schemas (allowedBlocks/defaultBlockType)
  // to know which regions seed an `empty`.
  const emptyRegions = buildEmptyRegionCases(blocksConfig, blocks);
  const emptyOutPath = discoveryPath(options.discoveryDir, 'emptyRegions');
  fs.writeFileSync(emptyOutPath, JSON.stringify(emptyRegions, null, 2));
  console.log(`[SETUP] Wrote ${emptyRegions.length} container region(s) to empty to ${emptyOutPath}`);

  // Containers that ALLOW a listing but have no example holding one. The
  // combination is its own rendering — the container decides what the
  // listing's results become — so an example of each alone renders neither.
  const listingIssues = collectListingContainerIssues(blocksConfig, blocks);
  const listingOutPath = discoveryPath(options.discoveryDir, 'listingContainerIssues');
  fs.writeFileSync(listingOutPath, JSON.stringify(listingIssues, null, 2));
  console.log(`[SETUP] Wrote ${listingIssues.length} listing/container issue(s) to ${listingOutPath}`);
}

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
}

/**
 * Wait for the admin to be ready: a production server answering, or the dev
 * server's webpack compilation finishing. Throws on a failed compilation.
 */
export async function waitForAdmin(options: AdminOptions = {}): Promise<void> {
  const retryDelay = 5000;
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
      if (error.code === 'ECONNREFUSED') {
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
