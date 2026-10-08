import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Boot the backing CMS ONCE per run, not once per spec file.
 *
 * WordPress Playground takes ~40s to come up. Booting it in each file's
 * beforeAll would both multiply that by the number of files and collide on the
 * port, because the previous file's server is still shutting down. Plone's mock
 * is cheap enough that it stays per-file.
 */

const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;

let wp: ChildProcess | null = null;
let pgCookie = '';

async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/`, { redirect: 'manual' });
    return res.status < 500;
  } catch (err) {
    if (err instanceof TypeError) return false;
    throw err;
  }
}

/**
 * Has the BLUEPRINT finished, not just the server?
 *
 * Playground starts answering requests while its blueprint steps are still
 * running, so waiting on the socket returns control mid-setup. Every step after
 * the slow one (10k terms) was therefore still pending when the first test ran:
 * a plugin looked uninstalled, a menu looked absent, and the vocabulary count
 * was whatever had been inserted so far — all of which read as facts about
 * WordPress rather than as a race in the harness.
 *
 * The blueprint's last step writes this file, so its presence means every step
 * before it has run.
 */
async function blueprintDone(): Promise<boolean> {
  try {
    // Playground sets its own cookie on the first request and 302s to the SAME
    // url to pick it up, so a client with no cookie jar — node's fetch — follows
    // that redirect to itself forever and never sees the file. Collect the
    // cookie first and send it.
    if (!pgCookie) {
      const first = await fetch(`${BASE}/`, { redirect: 'manual' });
      pgCookie = (first.headers.getSetCookie?.() ?? [])
        .map((c) => c.split(';')[0])
        .join('; ');
      if (!pgCookie) return false;
    }
    const res = await fetch(`${BASE}/wp-content/hydra-ready.txt`, {
      redirect: 'manual',
      headers: { Cookie: pgCookie },
    });
    return res.status === 200;
  } catch (err) {
    if (err instanceof TypeError) return false;
    throw err;
  }
}

const pluginDir =
  process.env.WP_PLUGINS ?? 'tests-adapters/fixtures/wp-plugins';

const STRAPI_PORT = 1337;
const STRAPI_BASE = `http://127.0.0.1:${STRAPI_PORT}`;
/**
 * The scaffolded app. Overridable like WP_PLUGINS, so an install that already
 * exists outside the checkout can be used rather than copied — a Strapi app is
 * ~700MB of node_modules.
 */
const STRAPI_APP =
  process.env.STRAPI_APP ?? 'tests-adapters/fixtures/strapi-app/app';

let strapi: ChildProcess | null = null;

/**
 * Is Strapi serving AND has its bootstrap run?
 *
 * Two questions, because they are answered at different moments: src/index.js
 * provisions the API token and seeds the vocabulary in bootstrap, and the
 * harness cannot authenticate until the token file exists. Waiting on the port
 * alone would start the suite with no credential — the WordPress blueprint race
 * in a different costume.
 */
async function strapiReady(): Promise<boolean> {
  if (!existsSync(join(STRAPI_APP, '.hydra-api-token'))) return false;
  try {
    const res = await fetch(`${STRAPI_BASE}/api/pages`);
    return res.status === 200;
  } catch (err) {
    if (err instanceof TypeError) return false;
    throw err;
  }
}

async function startStrapi(): Promise<void> {
  // Fail HERE with the command to run. The app is scaffolded, not committed —
  // it is a whole Strapi install — and without it every test would report
  // Strapi as unreachable, which says nothing about the adapter.
  // package.json, not the directory: a half-made app directory is the state a
  // failed scaffold leaves behind, and spawning node in it fails with
  // something unrecognisable instead of the one instruction that fixes it.
  if (!existsSync(join(STRAPI_APP, 'package.json'))) {
    throw new Error(
      `${STRAPI_APP} is missing. The contract suite runs a real Strapi — ` +
        `run \`pnpm strapi:fixture\` to scaffold it.`,
    );
  }
  if (await strapiReady()) {
    throw new Error(
      `Port ${STRAPI_PORT} is already serving. Stop it before running the ` +
        `contract suite — reusing a Strapi we did not boot would test content ` +
        `and permissions we did not provision.`,
    );
  }

  // `develop`, not `start`: start serves a BUILT admin panel, and building it
  // under pnpm fails on @strapi/admin's own dependency tree (@codemirror).
  // --no-build-admin skips that build; the suite talks to the REST API, which
  // does not need the panel. --no-watch-admin because nothing here edits it.
  strapi = spawn(
    'node',
    [
      'node_modules/@strapi/strapi/bin/strapi.js',
      'develop',
      '--no-watch-admin',
      '--no-build-admin',
    ],
    { cwd: resolve(STRAPI_APP), stdio: 'pipe' },
  );
  strapi.stderr?.on('data', (d) => process.stderr.write(`[strapi] ${d}`));
  strapi.stdout?.on('data', (d) => process.stderr.write(`[strapi] ${d}`));

  // Generous, and for one reason: the bootstrap inserts ten thousand
  // vocabulary terms on a cold database before it answers anything.
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (await strapiReady()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Strapi never came up on ${STRAPI_BASE}`);
}

export async function setup(): Promise<void> {
  if (process.env.TARGET === 'strapi') return startStrapi();
  if (process.env.TARGET !== 'wordpress') return;

  // Fail HERE, with the command to run, rather than letting the suite boot a
  // WordPress without WPGraphQL and report its absence as a CMS limitation.
  if (!existsSync(pluginDir)) {
    throw new Error(
      `${pluginDir} is missing. The contract suite mounts WordPress plugins ` +
        `from it — run \`pnpm wp:plugins\` to fetch them.`,
    );
  }

  if (await isUp()) {
    throw new Error(
      `Port ${PORT} is already serving. Stop it before running the contract ` +
        `suite — reusing a WordPress we did not seed would test unknown content.`,
    );
  }

  // The companion plugin, injected into the blueprint as an mu-plugin.
  //
  // Read from where it SHIPS, beside the adapter, so the PHP has exactly one
  // copy and the blueprint cannot drift from it.
  //
  // An mu-plugin rather than a mounted regular plugin: WordPress loads every
  // file in mu-plugins with no activation step, and activating a plugin dir that
  // appeared via a Playground mount fails with "Plugin file does not exist"
  // even though get_plugins() lists it — the overlay filesystem shows it to a
  // directory scan but not to validate_plugin's file check.
  const companion = readFileSync(
    'packages/hydra-adapters-wordpress/companion-plugin/hydra-companion/hydra-companion.php',
    'utf8',
  );
  const blueprintPath =
    process.env.WP_BLUEPRINT ?? 'tests-adapters/fixtures/wp-blueprint.json';
  const blueprint = JSON.parse(readFileSync(blueprintPath, 'utf8'));
  // Before the LAST step, which is the readiness sentinel.
  blueprint.steps.splice(
    blueprint.steps.length - 1,
    0,
    {
      step: 'writeFile',
      path: '/wordpress/wp-content/mu-plugins/hydra-companion.php',
      data: companion,
    },
    // Activated HERE rather than over REST after boot.
    //
    // The REST plugins endpoint refuses a mounted plugin with "Plugin file does
    // not exist" even though the same request's listing parsed that file's
    // header — the mount is visible to a directory scan but not to
    // validate_plugin's file_exists. A blueprint step runs inside Playground at
    // boot, where the mount is already in place. This only became possible once
    // the harness waited for the blueprint to finish; before that the step ran
    // after the suite had started.
    ...[
      'wp-graphql/wp-graphql.php',
      'polylang/polylang.php',
      // After both, since it extends them. WP_BRIDGE=0 leaves it out, to measure
      // what it costs per request.
      ...(process.env.WP_BRIDGE === '0'
        ? []
        : ['wp-graphql-polylang/wp-graphql-polylang.php']),
    ].map(
      (pluginPath) => ({ step: 'activatePlugin', pluginPath }),
    ),  );
  const runBlueprint = join(
    mkdtempSync(join(tmpdir(), 'hydra-blueprint-')),
    'blueprint.json',
  );
  writeFileSync(runBlueprint, JSON.stringify(blueprint));

  wp = spawn(
    'pnpm',
    [
      'dlx',
      // Pinned; see the note in playwright.config.ts.
      '@wp-playground/cli@3.1.51',
      'server',
      '--port',
      String(PORT),
      '--login',
      // Bulk-seeds the vocabulary in one PHP pass; 10k REST posts would
      // dominate the run time.
      // Plugins are MOUNTED from the repo, never downloaded at boot: Playground's
      // installPlugin step reaches wordpress.org, and when that fetch fails it
      // does so SILENTLY — you get a healthy WordPress with the plugin missing.
      '--mount',
      `${resolve(pluginDir)}:/wordpress/wp-content/plugins`,
      '--blueprint',
      runBlueprint,
    ],
    { stdio: 'pipe' },
  );
  wp.stderr?.on('data', (d) => process.stderr.write(`[wp] ${d}`));
  // Blueprint steps echo to STDOUT, and discarding it meant a step that failed
  // left no trace — the first sign was a later assertion about the CMS.
  wp.stdout?.on('data', (d) => process.stderr.write(`[wp] ${d}`));

  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (await blueprintDone()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `WordPress Playground never finished its blueprint on ${BASE} ` +
      `(server up: ${await isUp()})`,
  );
}

export async function teardown(): Promise<void> {
  wp?.kill('SIGTERM');
  wp = null;
  strapi?.kill('SIGTERM');
  strapi = null;
}
