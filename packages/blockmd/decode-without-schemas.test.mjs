/**
 * Markdown is self-describing: a page decodes from its own frontmatter and body,
 * with no frontend. So blockmd, and every test of it, has no access to a block
 * schema or a frontend's block config. What does need them (link summaries, a
 * schema shown on an example page, search text) runs after decode, where the
 * schemas are (the mock API's from-schemas.js).
 *
 * This scans every file in the package. A hit means decode, or a test of it, was
 * given a schema: move that step out of blockmd instead.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_WORDS = /schemaFor|blockSchema|blocksConfig|schemaRegistry|block-schemas|searchableText\.js|schemaValidation|CONTENT_SCHEMAS/;

describe('blockmd decodes markdown without schemas', () => {
  const files = readdirSync(HERE).filter((f) => f.endsWith('.mjs') && f !== 'decode-without-schemas.test.mjs');

  it.each(files)('%s names no schema', (file) => {
    const hits = readFileSync(join(HERE, file), 'utf8').split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => SCHEMA_WORDS.test(line))
      .map(([n, line]) => `${file}:${n}: ${line.trim()}`);
    expect(hits).toEqual([]);
  });
});
