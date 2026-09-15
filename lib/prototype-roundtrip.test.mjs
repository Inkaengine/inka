/**
 * Export idempotency: emitting a block tree under DIFFERENT prototype sets must
 * always read back to the SAME functional block structure.
 *
 * The prototype set is a READABILITY choice — it decides how much of a block is
 * written as clean markdown vs. carried in a `data-json` tag. It must never
 * change what decode produces. `emitSegments` guarantees this per block
 * (verify-on-emit: a form is only chosen if it round-trips, else it falls back
 * to the always-lossless data-json tag). This test pins that guarantee at the
 * page level so future prototype-rule changes (e.g. making a container emit as
 * readable regions) can't silently alter structure.
 *
 * "Same structure" = the engine's own `semanticEqual` (drops derived/no-op
 * fields: plaintext, empty text leaves, empty objects, key order, the resolved
 * half of a link summary) — the exact notion verify-on-emit uses.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import YAML from 'yaml';
import { parsePrototypes, matchBlocks, emitBlocks, semanticEqual } from './prototype-mapping.mjs';

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');

/** Every .md under docs/ except the generated content/ deploy artifact. */
function docPages(dir = DOCS, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'content') continue; // generated deploy tree, not source
      docPages(p, out);
    } else if (e.name.endsWith('.md')) {
      out.push(p);
    }
  }
  return out;
}

/** Parse a page's frontmatter into { protos, body } the way decodePage does. */
function readPage(file) {
  const md = readFileSync(file, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!m) return null;
  let fm;
  try { fm = YAML.parse(m[1]) ?? {}; } catch { return null; }
  if (fm['@type'] !== 'Document') return null;
  const protos = [
    ...parsePrototypes(fm['blocks-matched'] ?? ''),
    ...parsePrototypes(fm['blocks-tagged'] ?? '', { explicit: true }),
  ];
  return { protos, body: md.slice(m[0].length) };
}

/** Emit B under prototype set S, decode back, and compare to B. */
const idempotentUnder = (S, B) => semanticEqual(matchBlocks(S, emitBlocks(S, B)), B);

describe('export idempotency — prototype set is readability only, never structure', () => {
  it('the same tree emitted under a rich vs an empty prototype set decodes identically', () => {
    // A callout-ish container with a slate body — the readable prototype emits it
    // as a region of child blocks; the empty set emits a pure data-json tag.
    const B = [{
      '@type': 'accordion',
      panels: [{
        title: 'One',
        blocks: { a: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Body text.' }] }] } },
        blocks_layout: { items: ['a'] },
      }],
    }];
    const rich = parsePrototypes(
      '<block type="accordion">\n  <region name="panels" widget="object_list">\n' +
      '    <block type="slate" value="${p,h*/slate}" />\n  </region>\n</block>',
    );
    // Both prototype sets must read back to the SAME structure as B.
    expect(idempotentUnder(rich, B), 'rich prototypes').toBe(true);
    expect(idempotentUnder([], B), 'empty prototypes (data-json)').toBe(true);
    // …and therefore to each other.
    expect(
      semanticEqual(matchBlocks(rich, emitBlocks(rich, B)), matchBlocks([], emitBlocks([], B))),
      'rich and empty agree',
    ).toBe(true);
  });

  // The whole docs corpus: every page must round-trip losslessly under its OWN
  // authored prototypes AND under pure data-json. A prototype rule that lost
  // structure would fail the first; a decode/encode bug the second.
  const pages = docPages();
  it('found docs pages to check', () => {
    expect(pages.length).toBeGreaterThan(0);
  });
  for (const file of pages) {
    const page = readPage(file);
    if (!page) continue;
    const rel = file.slice(DOCS.length + 1);
    it(`round-trips losslessly under own + empty prototypes: ${rel}`, () => {
      const B = matchBlocks(page.protos, page.body);
      expect(idempotentUnder(page.protos, B), 'own prototypes').toBe(true);
      expect(idempotentUnder([], B), 'empty prototypes (data-json baseline)').toBe(true);
    }, 90_000); // verify-on-emit is O(n²) per page and jsdom is slow; the 194-block
                // narrative pages (custom-blocks.md) need headroom. Most pages are sub-second.
  }
});
