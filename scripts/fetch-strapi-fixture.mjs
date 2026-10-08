/**
 * Build the Strapi instance the contract suite runs against.
 *
 * The GENERATED app is not committed — it is ~670MB of dependencies. What IS
 * committed is the content model under tests-adapters/fixtures/strapi-app/src,
 * which this script copies over a freshly scaffolded project. Same split as the
 * WordPress plugins: source in git, bulk fetched and gitignored.
 *
 * Why the content model has to be committed rather than clicked together in
 * Strapi's admin UI: four of its details are load-bearing and non-obvious, and
 * every one of them was found by a real instance refusing something.
 *
 *   - `hydraBlocks` is a JSON field, NOT a dynamic zone. A dynamic zone's
 *     component list is closed and flat; Hydra's blocks are open and recursive, so
 *     columnsBlock -> column -> slate cannot be expressed as components at all.
 *   - `slug` is a plain string, NOT Strapi's `uid` type. `uid` is GLOBALLY unique,
 *     which would forbid /news/first-post alongside /about/first-post. Path
 *     segments need sibling uniqueness, which Strapi has no field type for.
 *   - `parent`/`children` is a self-relation, because Strapi ships no hierarchy
 *     and the suite's fixture is a tree.
 *   - src/index.js provisions an API token on boot, so nothing here needs the
 *     admin UI — which is just as well, because its build fails under pnpm.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = 'tests-adapters/fixtures/strapi-app/app';
const SOURCE = 'tests-adapters/fixtures/strapi-app/src';

/**
 * The installed Strapi CLI. Its ABSENCE is the failure this script exists to
 * prevent, so it is checked rather than assumed — see installDependencies.
 */
const CLI = join(APP, 'node_modules/@strapi/strapi/bin/strapi.js');

/**
 * Install INSIDE the app, which needs --ignore-workspace.
 *
 * The app sits inside this repo's pnpm workspace, and a plain `pnpm install`
 * there installs the WORKSPACE: "Scope: all 25 workspace projects", the app's
 * own package.json ignored and no node_modules beside it. create-strapi's
 * --install does exactly that, so the scaffold reports success and leaves an
 * app with no Strapi in it — which surfaces much later as the harness failing
 * to spawn a CLI that was never installed. It passed locally only because the
 * app was in a scratchpad outside the workspace.
 */
function installDependencies() {
  execFileSync('pnpm', ['install', '--ignore-workspace'], {
    cwd: APP,
    stdio: 'inherit',
  });
  if (!existsSync(CLI)) {
    throw new Error(
      `${CLI} is missing after install. The contract suite spawns it, so ` +
        `stop here rather than at boot with a module-not-found.`,
    );
  }
}

if (existsSync(join(APP, 'package.json'))) {
  // Still re-copy the model: it is the committed part, and a stale copy in a
  // cached app would mean testing yesterday's schema.
  cpSync(SOURCE, join(APP, 'src'), { recursive: true });
  // A restored cache can carry the app without its node_modules — the cache
  // key covers this script, not what was in the directory when it was saved.
  if (!existsSync(CLI)) installDependencies();
  console.log('strapi app: already present (content model refreshed)');
  process.exit(0);
}

mkdirSync('tests-adapters/fixtures/strapi-app', { recursive: true });

// pnpm dlx, never npx: the global npm here is v6 and its npx mangles flags.
//
// --dbfile is NOT optional. Without it the non-interactive installer writes an
// EMPTY DATABASE_FILENAME, and Strapi's config does
// env('DATABASE_FILENAME', '.tmp/data.db') — which only falls back on undefined,
// so the path collapses to the project root and SQLite dies with
// "unable to open database file", naming nothing.
console.log('strapi app: scaffolding (this takes a few minutes)');
execFileSync(
  'pnpm',
  [
    'dlx', 'create-strapi@latest', APP,
    '--non-interactive',
    '--no-run',
    '--skip-cloud',
    '--js',
    '--use-pnpm',
    '--no-example',
    '--no-git-init',
    '--dbclient', 'sqlite',
    '--dbfile', '.tmp/data.db',
    // Installed separately, with --ignore-workspace. See installDependencies.
    '--no-install',
  ],
  { stdio: 'inherit' },
);

installDependencies();
cpSync(SOURCE, join(APP, 'src'), { recursive: true });
mkdirSync(join(APP, '.tmp'), { recursive: true });

// Belt to that braces: assert the installer really did write a usable path.
const env = readFileSync(join(APP, '.env'), 'utf8');
if (/^DATABASE_FILENAME=\s*$/m.test(env)) {
  writeFileSync(
    join(APP, '.env'),
    env.replace(/^DATABASE_FILENAME=\s*$/m, 'DATABASE_FILENAME=.tmp/data.db'),
  );
  console.log('strapi app: patched an empty DATABASE_FILENAME');
}

console.log('strapi app: ready');
