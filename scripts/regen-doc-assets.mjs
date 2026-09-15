#!/usr/bin/env node
/**
 * Regenerate ONLY the git-ignored doc assets the docs reference and disk lacks,
 * then verify none are missing. Heavy: the screenshot commands bring up the
 * Volto admin + mock API + Nuxt via playwright's webServer. Run on demand, and
 * before a docs/frontend build so the embedded images/videos exist.
 *
 *   pnpm docs:assets            # regenerate the missing ones, then --check
 *
 * missing-doc-assets.mjs decides WHAT is missing and prints the commands; this
 * just runs them. NONE = nothing to do (the common case once cache is restored).
 */
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: '/bin/bash' });

const specs = execSync('node scripts/missing-doc-assets.mjs --specs', {
  cwd: ROOT,
  encoding: 'utf8',
}).trim();

if (specs === 'NONE') {
  console.log('[docs:assets] nothing missing — all referenced assets present.');
  process.exit(0);
}

for (const cmd of specs.split('\n').filter(Boolean)) {
  console.log(`\n[docs:assets] $ ${cmd}`);
  run(cmd);
}

console.log('\n[docs:assets] verifying all referenced assets now exist…');
run('node scripts/missing-doc-assets.mjs --check');
