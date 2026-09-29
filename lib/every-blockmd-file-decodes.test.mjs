/**
 * Every blockmd file in the repo decodes — docs, and also the test fixtures and
 * examples that carry their own `blocks-matched` / `blocks-tagged` prototypes.
 *
 * A change to what a node kind means (a lone-link paragraph becoming an `a`
 * node) leaves any file still declaring the old reading undecodable. The docs
 * round-trip test only covers docs/, so a fixture's stale declaration surfaced
 * only when the mock API served it. This finds them all, by scanning, rather
 * than a list of files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, relative } from 'node:path';
import { decodePage } from './prototype-mapping.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Dependencies and build output; `content` is docs' generated deploy artifact.
const SKIP = new Set(['node_modules', 'core', '.git', 'content', '.nuxt', '.output', '.next', 'dist', '.netlify']);

function blockmdFiles(dir = ROOT, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) blockmdFiles(p, out); } else if (e.name.endsWith('.md')) {
      if (/^---\n[\s\S]*?\n(blocks-matched|blocks-tagged):/.test(readFileSync(p, 'utf8'))) out.push(p);
    }
  }
  return out;
}

describe('every blockmd file in the repo decodes', () => {
  const files = blockmdFiles();
  it('finds blockmd files outside docs/ too', () => {
    expect(files.some((f) => !relative(ROOT, f).startsWith('docs/'))).toBe(true);
  });
  for (const file of files) {
    it(relative(ROOT, file), () => { decodePage(readFileSync(file, 'utf8')); });
  }
});
