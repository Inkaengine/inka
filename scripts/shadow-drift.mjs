#!/usr/bin/env node
/**
 * Shadow drift check.
 *
 * A Volto customization ("shadow") is a fork of an upstream file. Forks go
 * stale silently: upstream fixes its copy, ours keeps the old behaviour, and
 * nothing anywhere says so. That is how PRETAGOVSITE-N happened — upstream
 * added `formData?.hasOwnProperty(...)` guards and our Form shadow, forked
 * before that, kept crashing on a null formData for months.
 *
 * What this does NOT do is diff the shadow against upstream. Ours is MEANT to
 * differ; that is the point of a shadow. It records the hash of the upstream
 * file AT THE MOMENT WE FORKED IT, and fails when upstream's file has moved
 * since. The question it answers is "did upstream change under us?", not "are
 * we identical?".
 *
 * Upstream here is `core/`, a mrs-developer checkout pinned by tag in
 * mrs.developer.json, so in practice this fires on a Volto bump — the moment
 * the review is actually worth doing — and is silent the rest of the time.
 *
 *   node scripts/shadow-drift.mjs            # check (CI)
 *   node scripts/shadow-drift.mjs --record   # re-record after reviewing
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHADOW_ROOT = join(ROOT, 'packages/volto-hydra/src/customizations');
const CORE = join(ROOT, 'core/packages');
const BASELINE = join(ROOT, 'shadow-baseline.json');

/**
 * Where a shadow's upstream lives. Three namespaces, because `customizations/`
 * mirrors the module SPECIFIER, not one package's layout:
 *   volto/<p>               -> @plone/volto           -> core/packages/volto/src/<p>
 *   @plone/volto-slate/<p>  -> @plone/volto-slate     -> core/packages/volto-slate/src/<p>
 *   @plone/<pkg>/<p>        -> @plone/<pkg>           -> core/packages/<pkg>/src/<p>
 * Getting this wrong is the whole game: a naive single rule reports 10 of 31
 * shadows as missing and the check gets ignored.
 */
function upstreamBase(relParts) {
  if (relParts[0] === 'volto') return ['volto', relParts.slice(1)];
  if (relParts[0] === '@plone' && relParts.length > 1)
    return [relParts[1], relParts.slice(2)];
  return null;
}

// Upstream may have rewritten the file in another language since we forked
// (SidebarPortal.jsx is SidebarPortal.tsx upstream now). Same module, so the
// shadow still applies and still needs watching.
const SIBLINGS = {
  '.js': ['.js', '.jsx', '.ts', '.tsx'],
  '.jsx': ['.jsx', '.tsx', '.js', '.ts'],
  '.ts': ['.ts', '.tsx', '.js', '.jsx'],
  '.tsx': ['.tsx', '.jsx', '.ts', '.js'],
  '.css': ['.css', '.less', '.scss'],
};

function resolveUpstream(relPath) {
  const parts = relPath.split(sep);
  const base = upstreamBase(parts);
  if (!base) return null;
  const [pkg, rest] = base;
  if (!rest.length) return null;
  const tail = rest.join(sep);
  const ext = extname(tail);
  const stem = ext ? tail.slice(0, -ext.length) : tail;
  for (const candidate of SIBLINGS[ext] ?? [ext]) {
    const p = join(CORE, pkg, 'src', stem + candidate);
    if (existsSync(p)) return p;
  }
  return null;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function voltoTag() {
  const dev = JSON.parse(readFileSync(join(ROOT, 'mrs.developer.json'), 'utf8'));
  return dev.core?.tag ?? dev.core?.branch ?? '(unpinned)';
}

function die(lines) {
  console.error(lines.join('\n'));
  process.exit(1);
}

// A check that cannot see upstream must fail, never pass quietly. Skipping is
// exactly the silent-staleness failure this exists to prevent.
if (!existsSync(CORE)) {
  die([
    'shadow-drift: core/ is not present, so upstream cannot be read.',
    '  core/ is gitignored and cloned by mrs-developer. Run:',
    '    pnpm dlx mrs-developer missdev --no-config --fetch-https',
  ]);
}

const record = process.argv.includes('--record');
const shadows = walk(SHADOW_ROOT).map((p) => relative(SHADOW_ROOT, p)).sort();

const resolved = new Map(); // shadow -> {upstream (repo-relative), hash}
const additive = []; // no upstream counterpart: our own file sitting beside a shadow
for (const s of shadows) {
  const up = resolveUpstream(s);
  if (up) resolved.set(s, { upstream: relative(ROOT, up), hash: sha(up) });
  else additive.push(s);
}

if (record) {
  // Carry `why` and `declined` forward. They are the expensive part of this
  // file — the reasoning someone did once about whether a fork is still
  // needed and which upstream changes were consciously refused. Re-recording
  // must never silently discard them, or the audit gets re-derived every time.
  const prior = existsSync(BASELINE)
    ? JSON.parse(readFileSync(BASELINE, 'utf8')).shadows ?? {}
    : {};
  const shadowsOut = {};
  for (const [k, v] of resolved) {
    const { why, declined } = prior[k] ?? {};
    shadowsOut[k] = { ...v, ...(why ? { why } : {}), ...(declined ? { declined } : {}) };
  }
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        _comment:
          'Upstream hashes at the moment each shadow was last reviewed. Regenerate with `pnpm shadows:record` ONLY after reading the upstream diff. `why` says what the fork is for; `declined` lists upstream commits deliberately not ported, so the next reviewer does not re-derive it. See scripts/shadow-drift.mjs.',
        voltoTag: voltoTag(),
        shadows: shadowsOut,
        additive,
      },
      null,
      2,
    ) + '\n',
  );
  const undocumented = Object.entries(shadowsOut).filter(([, v]) => !v.why).length;
  console.log(
    `shadow-drift: recorded ${resolved.size} shadows + ${additive.length} additive files at Volto ${voltoTag()}`,
  );
  if (undocumented)
    console.log(
      `  ${undocumented} shadow(s) still have no \`why\`. A fork nobody can justify is a fork nobody can retire.`,
    );
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  die(['shadow-drift: no shadow-baseline.json. Create it with `pnpm shadows:record`.']);
}
const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
const problems = [];

for (const [s, { upstream, hash }] of resolved) {
  const prev = base.shadows?.[s];
  if (!prev) {
    problems.push(
      `  NEW SHADOW, never recorded: ${s}\n      forks ${upstream}\n` +
        `      Record it, and give it a \`why\`: what does this fork do that upstream cannot?`,
    );
  } else if (prev.hash !== hash) {
    problems.push(
      `  UPSTREAM CHANGED: ${s}\n      ${upstream}\n      recorded ${prev.hash.slice(0, 12)} -> now ${hash.slice(0, 12)}`,
    );
  }
}
// An additive file that NOW resolves means upstream added a file with that
// name: our file silently became an override of it.
for (const s of additive) {
  if (base.shadows?.[s])
    problems.push(`  NO LONGER RESOLVES: ${s}\n      recorded as a shadow, now has no upstream counterpart`);
}
for (const s of base.additive ?? []) {
  if (resolved.has(s))
    problems.push(
      `  BECAME A SHADOW: ${s}\n      recorded as additive, but upstream now ships ${resolved.get(s).upstream}`,
    );
}
for (const s of Object.keys(base.shadows ?? {}))
  if (!resolved.has(s) && !additive.includes(s))
    problems.push(`  GONE: ${s}\n      recorded, but no such customization any more`);

if (problems.length) {
  die([
    `shadow-drift: ${problems.length} shadow(s) need review.`,
    `  baseline recorded at Volto ${base.voltoTag}; mrs.developer.json now pins ${voltoTag()}.`,
    '',
    ...problems,
    '',
    '  These are FORKS of upstream files. Upstream moved; read its diff and decide',
    '  whether the change belongs in our copy (PRETAGOVSITE-N was a missed null guard).',
    '  Then re-record:  pnpm shadows:record',
  ]);
}

const undocumented = [...resolved.keys()].filter((s) => !base.shadows?.[s]?.why);
console.log(
  `shadow-drift: ${resolved.size} shadows unchanged upstream, ${additive.length} additive (Volto ${voltoTag()})`,
);
if (undocumented.length) {
  // Not a failure: the backlog predates this check, and failing CI over it
  // would only get the check disabled. New shadows DO have to justify
  // themselves (above), so the debt can only shrink.
  console.log(`  ${undocumented.length} of them have no \`why\` recorded yet:`);
  for (const s of undocumented.slice(0, 5)) console.log(`      ${s}`);
  if (undocumented.length > 5) console.log(`      ... and ${undocumented.length - 5} more`);
}
