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
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const APP = 'tests-adapters/fixtures/strapi-app/app';
const SOURCE = 'tests-adapters/fixtures/strapi-app/src';

/**
 * The installed Strapi CLI. Its ABSENCE is the failure this script exists to
 * prevent, so it is checked rather than assumed — see installDependencies.
 */
const CLI = join(APP, 'node_modules/@strapi/strapi/bin/strapi.js');

/**
 * Packages whose install script must actually RUN.
 *
 * pnpm 10 refuses lifecycle scripts unless a project names the dependency, and
 * says so as a WARNING — the install still exits 0. better-sqlite3's script is
 * what fetches or compiles its native binding, so without this the app
 * installs cleanly and then dies at boot with "Could not locate the bindings
 * file", naming eleven paths and no cause.
 *
 * It bit CI and not this machine because the two run different pnpm versions
 * (10.34 vs 10.18) and the approval is per project, not per package — which is
 * exactly why it belongs in the app's own package.json rather than in whatever
 * state a developer's pnpm happens to hold.
 */
const NEEDS_BUILD = ['better-sqlite3', '@swc/core', 'esbuild'];

/** Let those packages run their install scripts. */
function allowNativeBuilds() {
  const manifestPath = join(APP, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.pnpm = {
    ...manifest.pnpm,
    onlyBuiltDependencies: [
      ...new Set([...(manifest.pnpm?.onlyBuiltDependencies ?? []), ...NEEDS_BUILD]),
    ],
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** The native binding better-sqlite3's install script produces. */
function sqliteBindingExists() {
  const store = join(APP, 'node_modules/.pnpm');
  if (!existsSync(store)) return false;
  // Globbed rather than pinned: the version comes from Strapi's own tree, and
  // a pinned path would quietly stop checking anything when it bumped.
  return readdirSync(store)
    .filter((dir) => dir.startsWith('better-sqlite3@'))
    .some((dir) =>
      existsSync(
        join(store, dir, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
      ),
    );
}

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
  allowNativeBuilds();
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
  // Both checks are here for the same reason: an install that exits 0 having
  // skipped the work is worse than one that fails, because the failure then
  // happens somewhere that cannot explain it.
  if (!sqliteBindingExists()) {
    // An explicit rebuild is not subject to the approval gate, so this covers
    // a pnpm that read the allowlist differently. Announced rather than
    // silent: if this line ever prints, the manifest field stopped working and
    // that is worth knowing before the next version changes something else.
    console.warn(
      'strapi app: pnpm skipped better-sqlite3 despite the allowlist; ' +
        'rebuilding it explicitly',
    );
    execFileSync('pnpm', ['rebuild', '--ignore-workspace', 'better-sqlite3'], {
      cwd: APP,
      stdio: 'inherit',
    });
  }
  if (!sqliteBindingExists()) {
    throw new Error(
      `better-sqlite3 has no compiled binding after install. Its build script ` +
        `was skipped — check that package.json's pnpm.onlyBuiltDependencies ` +
        `still names it.`,
    );
  }
}

if (existsSync(join(APP, 'package.json'))) {
  // Still re-copy the model: it is the committed part, and a stale copy in a
  // cached app would mean testing yesterday's schema.
  cpSync(SOURCE, join(APP, 'src'), { recursive: true });
  // A restored cache can carry the app without its node_modules — the cache
  // key covers this script, not what was in the directory when it was saved.
  if (!existsSync(CLI) || !sqliteBindingExists()) installDependencies();
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
