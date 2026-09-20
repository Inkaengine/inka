import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveLiteralIncludes } from './markdown-mount.mjs';
import { findCodeExampleBlocks, restoreDirectives } from './restore-directives.mjs';

describe('findCodeExampleBlocks', () => {
  it('marks a self-closing source= block, reads its slotId', () => {
    const md = '# Page\n\n<block type="codeExample" slotId="json-data" source="card" format="json" />\n';
    const [b] = findCodeExampleBlocks(md);
    expect(b.slotId).toBe('json-data');
    expect(b.isSourceDirective).toBe(true);
  });

  it('reads slotId from a baked data-json self-close; not a source directive', () => {
    const md = `<block type="codeExample" data-json='{"slotId":"json-data","tabs":[{"code":"a > b /> c"}]}' />`;
    const [b] = findCodeExampleBlocks(md);
    expect(b.slotId).toBe('json-data');
    expect(b.isSourceDirective).toBe(false);
    expect(md.slice(b.start, b.end)).toBe(md);   // whole tag despite `>` in data-json
  });

  it('ignores a codeExample that appears only in the frontmatter prototypes', () => {
    const md = [
      '---', 'title: X', 'blocks-matched: |', '  <block type="codeExample">', '  </block>',
      '---', '', '# X', '', 'Prose only.',
    ].join('\n');
    expect(findCodeExampleBlocks(md)).toHaveLength(0);
  });
});

describe('restoreDirectives', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'restore-'));
    writeFileSync(join(dir, 'Card.jsx'), 'export function Card() {\n  return null;\n}\n');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('restores a BARE (wrapper-less) literalinclude by matching its value', () => {
    const directive = '```{literalinclude} Card.jsx\n:language: jsx\n```';
    const source = `# Guide\n\n### Card\n\n${directive}\n`;
    const baked = `# Guide\n\n### Card\n\n${resolveLiteralIncludes(directive, dir)}\n`;
    expect(baked).toContain('export function Card');       // sanity: really expanded
    const out = restoreDirectives(source, baked, dir);
    expect(out).toContain(directive);                      // directive back
    expect(out).not.toContain('export function Card');     // expansion gone
  });

  it('maps two identical includes to distinct directives (order-consuming)', () => {
    const d1 = '```{literalinclude} Card.jsx\n:language: jsx\n```';
    const source = `# G\n\n${d1}\n\nand again\n\n${d1}\n`;
    const exp = resolveLiteralIncludes(d1, dir);
    const baked = `# G\n\n${exp}\n\nand again\n\n${exp}\n`;
    const out = restoreDirectives(source, baked, dir);
    expect(out.match(/\{literalinclude\} Card\.jsx/g)).toHaveLength(2);
    expect(out).not.toContain('export function Card');
  });

  it('restores a source= codeExample by its slotId', () => {
    const source = '# P\n\n<block type="codeExample" slotId="json-data" source="card" format="json" />\n';
    const baked = `# P\n\n<block type="codeExample" data-json='{"slotId":"json-data","tabs":[{"@type":"tab","label":"JSON","code":"{}"}]}' />\n`;
    const out = restoreDirectives(source, baked, dir);
    expect(out).toContain('<block type="codeExample" slotId="json-data" source="card" format="json" />');
    expect(out).not.toContain('"label":"JSON"');
  });

  it('restores a literalinclude INSIDE a codeExample by slotId (baked as data-json)', () => {
    // A codeExample with a slotId tier-3s on re-emit (the slotId keeps it off the
    // clean tab form), so its expansion is JSON-escaped inside a data-json blob,
    // not a verbatim fence. It must restore by slotId (whole block), not by
    // matching the raw expansion text — the bug that broke `--markdown`.
    const directive = '```{literalinclude} Card.jsx\n:language: jsx\n```';
    const source = `# P\n\n<block type="codeExample" slotId="rendering">\n\n### Card\n\n${directive}\n\n</block>\n`;
    const baked = `# P\n\n<block type="codeExample" data-json='{"slotId":"rendering","tabs":[{"@type":"tab","label":"Card","language":"jsx","code":"export function Card() {\\n  return null;\\n}"}]}' />\n`;
    const out = restoreDirectives(source, baked, dir);
    expect(out).toContain(directive);              // directive restored
    expect(out).toContain('slotId="rendering"');   // the whole source block is back
    expect(out).not.toContain('data-json');        // baked blob gone
  });

  it('fails loud when a literalinclude value is not present in the export', () => {
    const source = '# G\n\n```{literalinclude} Card.jsx\n:language: jsx\n```\n';
    expect(() => restoreDirectives(source, '# G\n\nunrelated\n', dir)).toThrow(/not found/);
  });

  it('no directives: returns the export unchanged', () => {
    expect(restoreDirectives('# Prose\n', '# Prose (simpler)\n', dir)).toBe('# Prose (simpler)\n');
  });
});
