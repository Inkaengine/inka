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

if (existsSync(join(APP, 'package.json'))) {
  // Still re-copy the model: it is the committed part, and a stale copy in a
  // cached app would mean testing yesterday's schema.
  cpSync(SOURCE, join(APP, 'src'), { recursive: true });
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
    '--install',
  ],
  { stdio: 'inherit' },
);

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
