#!/usr/bin/env node
/**
 * The admin build's stamp: a hash of the source it was built from.
 *
 * Tests run the BUILT admin (`pnpm build:test`, then `pnpm start:test`): a webpack
 * dev server holds its whole module graph and grows over the days it runs,
 * 1.5–2 GB each. A built admin does not rebuild itself, though, so one built
 * before a pull or a branch switch would quietly serve old code. The stamp
 * makes that loud instead of something to remember:
 *
 *   node packages/testing/admin-build-stamp.js --write   # after `pnpm build` (build:test)
 *   node packages/testing/admin-build-stamp.js --check   # before starting it
 *
 * and waitForAdmin (playwright/global-setup.ts) compares the stamp a running
 * admin serves (/inka-build.json) with its checkout's.
 *
 * The hash covers every tracked file the admin can import (all but the docs,
 * examples, specs and the like — inAdminBuild), with any uncommitted change
 * to them, and any uncommitted change in Volto's core checkout (its version is
 * mrs.developer.json, which is covered). It errs towards rebuilding: a
 * needless rebuild costs minutes, a stale admin a misleading test run.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Where the build puts it: build/public is served at the admin's root. */
const STAMP_PATH = path.join('build', 'public', 'inka-build.json');
const REBUILD = 'pnpm build:test';

class StaleAdmin extends Error {
  name = 'StaleAdmin';
}

/** Top-level directories the admin never imports from. */
const NOT_BUILT = new Set([
  // The build's own output, the stamp included.
  'build',
  '.github',
  '_internal-docs',
  'backend',
  'cypress',
  'docker',
  'docs',
  'examples',
  'proposals',
  'superpowers',
]);

/** Is this tracked path part of what the admin is built from? */
function inAdminBuild(rel) {
  const [top] = rel.split('/');
  if (NOT_BUILT.has(top)) return false;
  if (rel.endsWith('.md')) return false;
  // The specs are not, but the admin imports fixtures (the shared block schemas).
  if (top === 'tests-playwright') return rel.startsWith('tests-playwright/fixtures/');
  return true;
}

// Read-only, and the checkout is the one being tested: trusted for these calls
// alone. In a CI container the checkout belongs to another user, and git
// otherwise refuses it ("dubious ownership").
const git = (cwd, args) =>
  execFileSync('git', ['-c', `safe.directory=${path.resolve(cwd)}`, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

/** `git status` paths that differ from HEAD, untracked included. */
function changedPaths(cwd) {
  return git(cwd, ['status', '--porcelain', '--untracked-files=all', '-z'])
    .split('\0')
    .filter(Boolean)
    .map((entry) => entry.slice(3));
}

function fileHash(file) {
  return fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : 'deleted';
}

/** The stamp of the admin `root` (an Inka checkout) would be built from now. */
function adminStamp(root) {
  const hash = crypto.createHash('sha256');
  // Tracked files, by their committed content.
  for (const line of git(root, ['ls-files', '-s', '-z']).split('\0')) {
    if (!line) continue;
    const rel = line.slice(line.indexOf('\t') + 1);
    if (inAdminBuild(rel)) hash.update(`${line}\n`);
  }
  // What differs from that, by its content on disk.
  for (const rel of changedPaths(root).filter(inAdminBuild).sort()) {
    hash.update(`changed ${rel} ${fileHash(path.join(root, rel))}\n`);
  }
  // Volto's core: its version is mrs.developer.json (above); a local edit to it is here.
  const core = path.join(root, 'core');
  if (fs.existsSync(path.join(core, '.git'))) {
    for (const rel of changedPaths(core).sort()) {
      hash.update(`core ${rel} ${fileHash(path.join(core, rel))}\n`);
    }
  }
  return hash.digest('hex').slice(0, 16);
}

/** Record the stamp in the build `root` just made. */
function writeBuildStamp(root) {
  const file = path.join(root, STAMP_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const stamp = adminStamp(root);
  fs.writeFileSync(file, JSON.stringify({ stamp, builtAt: new Date().toISOString() }, null, 1));
  return stamp;
}

/** The build's stamp, or null when there is no build (or one from before stamps). */
function buildStamp(root) {
  const file = path.join(root, STAMP_PATH);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).stamp : null;
}

/** Throws StaleAdmin unless `root` has a build of what it holds now. */
function checkBuild(root) {
  const built = buildStamp(root);
  if (!built) {
    throw new StaleAdmin(`There is no admin build in ${root} (or it is from before build stamps). Run \`${REBUILD}\` there first.`);
  }
  const now = adminStamp(root);
  if (built !== now) {
    throw new StaleAdmin(
      `The admin build in ${root} is older than this checkout (built from ${built}, the checkout is ${now}). ` +
        `Run \`${REBUILD}\` there, then restart the admin.`,
    );
  }
}

/**
 * Throws StaleAdmin unless the admin answering at `adminUrl` was built from
 * `root` as it is now. A running server can be one started before the
 * checkout moved, which reuseExistingServer would otherwise just use.
 */
async function checkRunningAdmin(adminUrl, root) {
  const response = await fetch(new URL('/inka-build.json', adminUrl));
  const now = adminStamp(root);
  if (!response.ok) {
    throw new StaleAdmin(
      `The admin at ${adminUrl} has no build stamp (${response.status}): it was built before stamps, or is a dev server. ` +
        `Stop it, run \`${REBUILD}\` in ${root}, and start it again (or set ADMIN_DEV=1 to test against a dev server).`,
    );
  }
  const { stamp } = await response.json();
  if (stamp !== now) {
    throw new StaleAdmin(
      `The admin at ${adminUrl} was built from older code (${stamp}) than ${root} holds now (${now}). ` +
        `Stop it, run \`${REBUILD}\` there, and start it again.`,
    );
  }
}

export { adminStamp,buildStamp,checkBuild,checkRunningAdmin,inAdminBuild,StaleAdmin,STAMP_PATH,writeBuildStamp };

// Run as a program (node admin-build-stamp.js --write | --check), not imported.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === import.meta.filename) {
  const root = process.cwd();
  const [flag] = process.argv.slice(2);
  if (flag === '--write') {
    console.log(`admin build stamp ${writeBuildStamp(root)} → ${STAMP_PATH}`);
  } else if (flag === '--check') {
    try {
      checkBuild(root);
    } catch (e) {
      if (!(e instanceof StaleAdmin)) throw e;
      console.error(e.message);
      process.exit(1);
    }
  } else {
    console.error('usage: admin-build-stamp.js --write | --check  (run in the Inka checkout)');
    process.exit(2);
  }
}
