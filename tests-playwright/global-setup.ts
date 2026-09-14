/**
 * Global setup for Playwright tests
 * Verifies servers are healthy before running tests
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { chromium } from '@playwright/test';
import { PORTS, URLS } from './ports';
import { FRONTEND_URLS, SANITY_PROJECTS } from './bridge/fixtures';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { discoverBlocks, buildEmptyRegionCases } = require('./helpers/discover-blocks.cjs');

/**
 * Fetch the frontend's registered blocksConfig by loading mock-parent in a
 * headless browser and asking its bridge helper. Optional — if MOCK_PARENT_URL
 * and FRONTEND_URL aren't set, discovery runs without schemas (type-only
 * discovery, skipping the schema-mismatch validation).
 */
async function fetchBlocksConfig(
  mockParentUrl: string,
  frontendUrl: string,
  apiUrl: string,
): Promise<{
  blocksConfig: Record<string, any>;
  frontendKeys: string[];
  styleMenuClasses: string[];
}> {
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
async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok || res.status === 404; // serving, even if / has no route
  } catch {
    return false;
  }
}

/**
 * Which frontend each storageState points the editor at.
 *
 * The editor reads the iframe URL from a cookie NAMED for the Volto SSR port
 * (`iframe_url_<port>`), so a storageState pins two ports at once: the admin's
 * in the name and the frontend's in the value. These used to be checked in with
 * 3001/3003/... baked into the JSON, which quietly cancelled the env overrides
 * ports.ts documents — set HYDRA_VOLTO_SSR_PORT and the cookie kept the old
 * name, so the editor never learned which frontend to load and the bridge sat
 * at "Not Connected", initBridge never called. Running on the default ports was
 * the only thing that worked, which means sharing them with whatever else is
 * already on 3001/8888 and, with reuseExistingServer, silently adopting a
 * stale Volto from another session.
 *
 * Generating them from PORTS restores the override, so a run can take a private
 * set of ports and leave anyone else's hydra alone.
 */
const STORAGE_FRONTENDS: Record<string, string> = {
  nuxt: URLS.nuxt,
  react: URLS.reactDoc,
  svelte: URLS.svelteDoc,
  vue: URLS.vueDoc,
  nextjs: URLS.nextjs,
  // F7 is hash-routed: the editor needs the `#!` or it loads the app shell
  // without a route.
  f7: `${URLS.f7}/#!`,
};

export const GENERATED_DIR = path.resolve(__dirname, '.generated');

function writeStorageStates(): void {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  for (const [name, frontendUrl] of Object.entries(STORAGE_FRONTENDS)) {
    const state = {
      cookies: [
        {
          name: `iframe_url_${PORTS.voltoSsr}`,
          value: frontendUrl,
          domain: 'localhost',
          path: '/',
        },
      ],
      origins: [],
    };
    fs.writeFileSync(
      path.join(GENERATED_DIR, `storage-${name}.json`),
      JSON.stringify(state, null, 2),
    );
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
async function warmFrontend(url: string): Promise<void> {
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

async function globalSetup() {
  // Before anything else: the storageStates have to name the ports THIS run uses.
  writeStorageStates();

  // Run block discovery if configured (before health checks — SKIP_VOLTO_CHECK
  // causes early return but discovery still needs to run for bridge tests)
  // Fixture mounts are authored for their own root: served under /_test_data
  // (the docs+fixtures job layout) their internal refs legitimately miss the
  // merged view. Default the integrity exemption here so every harness gets
  // it; a consuming repo can still override before setup runs.
  process.env.INTEGRITY_EXEMPT_PREFIXES ??= '/_test_data';
  const discoverApi = process.env.DISCOVER_BLOCKS_API;
  // The schema fetch loads the FRONTEND in a browser with `api_path` so its
  // INIT carries blocksConfig — any page does; schemas don't depend on which
  // content. When discovery reads a REMOTE api (a live converted site), the
  // browser often can't complete that load (CORS, latency), so the schema
  // fetch stays on a local api unless the harness says otherwise.
  const schemaApi = process.env.SCHEMA_FETCH_API || discoverApi;
  if (discoverApi) {
    const maxPages = process.env.DISCOVER_MAX_PAGES
      ? parseInt(process.env.DISCOVER_MAX_PAGES, 10)
      : Infinity;
    const maxLabel = Number.isFinite(maxPages) ? `max ${maxPages} pages` : 'all pages';

    // Fetch blocksConfig from the frontend so discovery can validate field
    // data shapes, and the frontend-only key set so discovery can flag
    // registered-but-unused types without false positives from mock-parent's
    // own test baseline. Optional — skipped when MOCK_PARENT_URL/FRONTEND_URL
    // aren't set.
    let blocksConfig: Record<string, any> = {};
    let frontendKeys: string[] = [];
    let styleMenuClasses: string[] = [];
    if (process.env.MOCK_PARENT_URL && process.env.FRONTEND_URL) {
      console.log(`[SETUP] Fetching blocksConfig via ${process.env.MOCK_PARENT_URL}...`);
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
    // Discovery runs PER FRONTEND, not once per job.
    //
    // A job can run several frontends (mock + react + svelte + vue + astro;
    // nextjs + f7) and they do not register the same blocks. Reading one
    // registry and applying it to all of them was the compromise this replaces:
    // it either misses a container region a frontend declares (so its nested
    // blocks are never discovered) or attributes a block to a frontend that
    // never claimed it. Unioning them has the same second fault. Each frontend
    // gets its own pass, and every discovered block carries the frontend it
    // came from so the spec can run it only there.
    //
    // Frontends that aren't up in this job are skipped quietly — a job runs a
    // subset by design.
    //
    // Two keys can point at the SAME server (a job sets FRONTEND_URL to the very
    // frontend it also names as a project). That is one frontend, not two:
    // scanning it twice doubles the slowest part of setup and emits a second,
    // identical set of cases. Named projects are considered first so a frontend
    // is tagged with its project name rather than the anonymous '(env)'.
    const normUrl = (u: string) => u.replace(/\/+$/, '');
    // Only frontends block-sanity enforces. A frontend it skips yields cases
    // that are generated and then skipped — pure cost, and for the docs
    // frontends (which register a small registry, so most content reads as
    // unregistered) it was ~1736 entries each, timing the job out.
    const candidates: Array<[string, string]> = [
      ...Object.entries(FRONTEND_URLS).filter(([project]) => SANITY_PROJECTS.has(project)),
      ['mock', URLS.testFrontend],
    ];
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

    const mockParent = process.env.MOCK_PARENT_URL || `${URLS.testFrontend}/mock-parent.html`;
    const blocks: any[] = [];
    const perFrontend: Record<string, number> = {};
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
      blocksConfig = cfg;      // last one wins for the legacy single-config uses
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

    const outPath = path.resolve(__dirname, '../.discovered-blocks.json');
    fs.writeFileSync(outPath, JSON.stringify(blocks, null, 2));
    console.log(`[SETUP] Wrote ${blocks.length} discovered blocks to ${outPath}`);

    // Record what coverage found. Whether it RAN is no longer a question —
    // setup fails without schemas — so this is the result, not a caveat.
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
    const covPath = path.resolve(__dirname, '../.discovered-coverage.json');
    fs.writeFileSync(covPath, JSON.stringify(coverage, null, 2));
    for (const [project, c] of Object.entries(byFrontend)) {
      console.log(
        `[SETUP] Example coverage [${project}]: ${c.types} types with examples, ` +
          `${c.noExample.length} without (${c.noExample.join(', ') || 'none'})`,
      );
    }

    // The empty-region sweep needs block schemas (allowedBlocks/defaultBlockType)
    // to know which regions seed an `empty`. block-sanity deliberately runs
    // schema-less in CI (MOCK_PARENT_URL unset) to skip its strict schema checks,
    // so fetch schemas JUST for this sweep — from the always-present mock
    // test-frontend — without turning block-sanity's checks on. Best-effort: on
    // failure the sweep is simply empty (its tests skip) rather than failing setup.
    let ecConfig = blocksConfig;
    if (Object.keys(ecConfig).length === 0) {
      try {
        ({ blocksConfig: ecConfig } = await fetchBlocksConfig(
          `${URLS.testFrontend}/mock-parent.html`,
          URLS.testFrontend,
          discoverApi,
        ));
        console.log(`[SETUP] Fetched ${Object.keys(ecConfig).length} schemas from the mock frontend for empty-region detection`);
      } catch (err) {
        console.warn(`[SETUP] empty-region schema fetch failed (sweep will be empty): ${err}`);
        ecConfig = {};
      }
    }
    const emptyRegions = buildEmptyRegionCases(ecConfig, blocks);
    const emptyOutPath = path.resolve(__dirname, '../.discovered-empty-regions.json');
    fs.writeFileSync(emptyOutPath, JSON.stringify(emptyRegions, null, 2));
    console.log(`[SETUP] Wrote ${emptyRegions.length} empty-seeding container region(s) to ${emptyOutPath}`);
  }

  // Same --project logic playwright.config uses to decide which frontends to
  // start: warm exactly the one the run will drive.
  const projectArgIndex = process.argv.indexOf('--project');
  const projectArg =
    process.argv.find((arg) => arg.startsWith('--project='))?.split('=')[1] ||
    (projectArgIndex !== -1 ? process.argv[projectArgIndex + 1] : undefined);
  // Only the ADMIN-driven projects: they are the ones whose helper waits for
  // the iframe to render a block, so they are the ones that pay for a cold
  // frontend. The bridge projects drive the frontend directly.
  if (!projectArg || /admin-nuxt|nuxt-specific/.test(projectArg)) {
    await warmFrontend(`${URLS.nuxt}/test-page`);
  }

  // Bridge-only CI jobs don't run Volto — skip the health check
  if (process.env.SKIP_VOLTO_CHECK === 'true') {
    console.log('[SETUP] Skipping Volto health check (SKIP_VOLTO_CHECK=true)');
    return;
  }

  const maxRetries = 60; // 60 retries * 5 seconds = 5 minutes max wait
  const retryDelay = 5000; // 5 seconds between retries

  // In production mode (USE_PREBUILT), check SSR server directly
  // In dev mode, check webpack-dev-server health endpoint
  // Consumers running Volto on non-default ports (e.g. parallel test stacks)
  // can override with VOLTO_HEALTH_URL.
  const usePrebuilt = process.env.USE_PREBUILT === 'true';
  const defaultHealthUrl = usePrebuilt
    ? URLS.voltoSsr
    : `${URLS.voltoWebpack}/health`;
  const healthUrl = process.env.VOLTO_HEALTH_URL || defaultHealthUrl;
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

export default globalSetup;
