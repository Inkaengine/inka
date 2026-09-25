#!/usr/bin/env node
/**
 * Which generated doc assets (editor screenshots, demo video) need (re)generating
 * — and the command that produces each. Generated assets are git-ignored (see
 * docs/.gitignore) and persisted across CI runs; the docs markdown is the
 * requirement (a page embedding `/docs/images/x.png` must have that file).
 *
 * An asset needs regenerating when it is:
 *   - ABSENT  — referenced but not on disk (or empty), OR
 *   - STALE   — present, but the thing that PRODUCES it changed since it was
 *               made: the git committer-time of its spec (or a declared
 *               appearance dep — the admin chrome, the bridge, the iframe
 *               renderer, the Volto pin) is newer than the asset's file mtime.
 *
 * git committer-time (`git log -1 --format=%cI`) is used for the SOURCES, not
 * their filesystem mtime: a checkout stamps every file with the checkout time,
 * so fs mtime is meaningless for sources; git time is stable. The asset's OWN
 * fs mtime is the record of when it was made (preserved through the CI cache's
 * tar round-trip). This is the NSW-docs `missing-doc-clips` pattern.
 *
 *   node scripts/missing-doc-assets.mjs           # human-readable report
 *   node scripts/missing-doc-assets.mjs --check    # exit 1 if any referenced asset is absent (the media gate)
 *   node scripts/missing-doc-assets.mjs --specs    # commands to (re)generate the absent/stale ones (or NONE)
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');

// Dirs under docs/ with no doc PAGES — nothing there references a doc asset.
const SKIP_DIR = new Set(['content', 'content-md', 'node_modules']);
const isSkipped = (name) => name.startsWith('_') || name.startsWith('.') || SKIP_DIR.has(name);

function docMarkdownFiles(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!isSkipped(e.name)) docMarkdownFiles(join(dir, e.name), acc);
    } else if (e.name.endsWith('.md')) acc.push(join(dir, e.name));
  }
  return acc;
}

/** Asset paths (relative to docs/) the markdown references. */
function required() {
  const wanted = new Set();
  // Pages write assets RELATIVE to themselves since blockmd (#372) —
  // `../images/x.png`, `./static/hydra-demo.mp4` — as well as the old absolute
  // `/docs/images/x.png`. Matching only the absolute form found none at all:
  // the gate passed checking nothing, and a new screenshot was never made.
  const re = /(?:\/docs\/|(?:\.\.?\/)+)(images\/[a-z0-9-]+\.(?:png|jpg|jpeg|svg)|static\/[a-z0-9-]+\.(?:mp4|webm))/g;
  for (const file of docMarkdownFiles(DOCS)) {
    for (const m of readFileSync(file, 'utf8').matchAll(re)) wanted.add(m[1]);
  }
  return [...wanted].sort();
}

// Files/dirs whose change alters how the editor (and the iframe it screenshots)
// LOOKS: the admin chrome, the bridge, the Nuxt example renderer, the Volto pin.
// A screenshot is stale if any of these changed after it was recorded, even if
// its own spec did not.
const APPEARANCE_DEPS = [
  'packages/volto-hydra',
  'packages/hydra-js',
  'examples/nuxt-blog-starter',
  'mrs.developer.json',
];

/** Map a required asset → { label, cmd, spec, deps }. */
function producerFor(rel) {
  const name = rel.replace(/^(images|static)\//, '');
  if (rel.endsWith('.mp4') || rel.endsWith('.webm')) {
    // demo:capture records the .webm (editor stack), demo:encode trims/muxes it
    // into docs/static/hydra-demo.mp4.
    return { label: 'demo video', cmd: 'pnpm demo:capture && pnpm demo:encode', spec: 'tests-playwright/demo-video', deps: APPEARANCE_DEPS };
  }
  if (name.startsWith('mobile-')) {
    return {
      label: 'mobile screenshots',
      // Scope to admin-nuxt: the mobile admin-chrome screenshots use the Nuxt
      // frontend (the one record-doc-assets builds), same as every other doc
      // capture. Unscoped, this also runs on admin-f7 / admin-nextjs whose
      // frontends that job doesn't start, so they'd fail on an empty iframe.
      cmd: 'CAPTURE_MOBILE_SCREENSHOTS=1 pnpm exec playwright test --project=admin-nuxt tests-playwright/integration/mobile-tablet-admin-layout.spec.ts -g "screenshot:"',
      spec: 'tests-playwright/integration/mobile-tablet-admin-layout.spec.ts',
      deps: APPEARANCE_DEPS,
    };
  }
  if (name.endsWith('-edit.png')) {
    return {
      label: 'per-block editor screenshots',
      cmd: 'pnpm exec playwright test --project=screenshots-nuxt tests-playwright/screenshots/example-blocks.spec.ts',
      spec: 'tests-playwright/screenshots/example-blocks.spec.ts',
      deps: APPEARANCE_DEPS,
    };
  }
  if (rel.endsWith('.png')) {
    return {
      label: 'editor-guide screenshots',
      cmd: 'pnpm exec playwright test --project=screenshots-nuxt tests-playwright/screenshots/capture.spec.ts',
      spec: 'tests-playwright/screenshots/capture.spec.ts',
      deps: APPEARANCE_DEPS,
    };
  }
  return null;
}

const lastChangedCache = new Map();
/** Git committer-time (ms) of the last commit touching `repoPath`, or 0 if git
 *  has no history for it. Stable across checkouts (unlike fs mtime). */
function lastChanged(repoPath) {
  if (lastChangedCache.has(repoPath)) return lastChangedCache.get(repoPath);
  let ms = 0;
  try {
    const out = execFileSync('git', ['-C', ROOT, 'log', '-1', '--format=%cI', '--', repoPath], { encoding: 'utf8' }).trim();
    ms = out ? new Date(out).getTime() : 0;
  } catch { ms = 0; }
  lastChangedCache.set(repoPath, ms);
  return ms;
}

const req = required();
const absent = req.filter((rel) => {
  try { return statSync(join(DOCS, rel)).size === 0; } catch { return true; }
});

// A dep path git has never heard of would silently never mark anything stale —
// a guard that looks like protection but is off. Fail loud, like NSW.
const unresolvable = [...new Set(req.flatMap((rel) => {
  const p = producerFor(rel);
  return p ? [p.spec, ...p.deps] : [];
}))].filter((p) => !lastChanged(p));
if (unresolvable.length) {
  console.error(`[media] ${unresolvable.length} spec/dep path(s) have no git history — they can never mark an asset stale:\n  ${unresolvable.join('\n  ')}\n\nFix the path (it is wrong) or commit the file.`);
  process.exit(1);
}

const recordedAt = (rel) => { try { return statSync(join(DOCS, rel)).mtimeMs; } catch { return 0; } };
const stale = req.filter((rel) => {
  if (absent.includes(rel)) return false;
  const p = producerFor(rel);
  if (!p) return false;
  const made = recordedAt(rel);
  return [p.spec, ...p.deps].some((path_) => lastChanged(path_) > made);
});

const missing = [...new Set([...absent, ...stale])].sort();
const unmapped = missing.filter((rel) => !producerFor(rel));
const mode = process.argv[2];

if (mode === '--specs') {
  if (unmapped.length) { console.error(`# ERROR: no producer for: ${unmapped.join(', ')}`); process.exit(1); }
  if (!missing.length) { console.log('NONE'); process.exit(0); }
  for (const c of [...new Set(missing.map((rel) => producerFor(rel).cmd))]) console.log(c);
  process.exit(0);
}

if (mode === '--check') {
  // The media gate — run AFTER generate/restore. Fatal if a referenced asset is
  // ABSENT (a 404 in the built docs). Staleness is a regeneration hint, not a
  // gate: a present-but-stale image still renders.
  if (!absent.length) { console.log(`[media] all ${req.length} referenced doc assets present.`); process.exit(0); }
  console.error(`[media] ${absent.length} referenced doc asset(s) MISSING:`);
  for (const rel of absent) { const p = producerFor(rel); console.error(`  docs/${rel}  <- ${p ? p.label : 'NO KNOWN PRODUCER'}`); }
  process.exit(1);
}

// default: human-readable report
console.log(`Referenced doc assets: ${req.length}; absent: ${absent.length}; stale (producer changed since): ${stale.length}`);
if (missing.length) {
  const byCmd = new Map();
  for (const rel of missing) {
    const p = producerFor(rel);
    const key = p ? p.cmd : 'NO KNOWN PRODUCER';
    if (!byCmd.has(key)) byCmd.set(key, []);
    byCmd.get(key).push(`${rel}${absent.includes(rel) ? ' (absent)' : ' (stale)'}`);
  }
  for (const [cmd, rels] of byCmd) { console.log(`\n  ${cmd}`); for (const r of rels) console.log(`    docs/${r}`); }
}
