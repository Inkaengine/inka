import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readTree, schemaRegistryFromBlockDefinitions } from '../../lib/markdown-mount.mjs';
import { sharedBlocksConfig } from '../../tests-playwright/fixtures/shared-block-schemas.js';

// Every block example page carries the block-reference-layout template. Find
// them BY that template — never a hardcoded list, so a new example page is
// covered automatically and a dropped one can't hide. For each, prove the trio
// is single-source: the "Schema" and "JSON" the reader sees are DERIVED by
// `source=` selectors from the page's own live instance + the schema registry
// (the same sharedBlocksConfig the frontends register from), not hand-copied —
// so what's documented is what renders. Rendering itself is covered by
// block-sanity; this locks in the single-source property, fast and browser-free.
const TEMPLATE = '/templates/block-reference-layout';
const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs');
const schemaFor = schemaRegistryFromBlockDefinitions(sharedBlocksConfig);

const usesTemplate = (page) =>
  Object.values(page.blocks || {}).some((b) => b.templateId === TEMPLATE);
const codeExamples = (page, slotId) =>
  Object.values(page.blocks || {}).filter((b) => b['@type'] === 'codeExample' && b.slotId === slotId);

let examplePages;
beforeAll(() => {
  const { items } = readTree(DOCS, { schemaFor });
  examplePages = [...items].filter(([id, p]) => id.startsWith('/examples/') && usesTemplate(p));
});

describe('example pages are single-source (discovered by their template)', () => {
  it('finds the example pages by template, not a hardcoded list', () => {
    const ids = examplePages.map(([id]) => id);
    expect(ids.length).toBeGreaterThan(20); // ~27; a silently-empty discovery is a failure
    expect(ids).toContain('/examples/accordion');
  });

  it('has, for each page, exactly one schema and one json-data slot', () => {
    for (const [id, page] of examplePages) {
      expect(codeExamples(page, 'schema'), `${id} schema slot`).toHaveLength(1);
      expect(codeExamples(page, 'json-data'), `${id} json slot`).toHaveLength(1);
    }
  });

  it('derives Schema from the registry via a `source`/`format=schema` selector (not hand-written)', () => {
    for (const [id, page] of examplePages) {
      const s = codeExamples(page, 'schema')[0];
      expect(s.source, `${id}: schema slot must be a selector`).toBeTruthy();
      expect(s.format).toBe('schema');
      const schema = JSON.parse(s.tabs[0].code); // resolved by readTree; parses
      expect(Object.keys(schema).length, `${id}: schema not empty`).toBeGreaterThan(0);
      expect(schemaFor(s.source), `${id}: registry has a schema for ${s.source}`).toBeTruthy();
    }
  });

  it('derives JSON from the page\'s own live instance via `source`/`format=json` (the thing that renders)', () => {
    for (const [id, page] of examplePages) {
      const j = codeExamples(page, 'json-data')[0];
      expect(j.source, `${id}: json slot must be a selector`).toBeTruthy();
      expect(j.format).toBe('json');
      const data = JSON.parse(j.tabs[0].code); // resolved from the live instance
      // The selector points at a block on THIS page (uid or @type) — that block
      // exists (readTree would have thrown otherwise) and its data has a @type.
      expect(data['@type'], `${id}: documented instance has a @type`).toBeTruthy();
      const byType = Object.values(page.blocks).some((b) => b['@type'] === j.source);
      const byUid = !!page.blocks[j.source];
      expect(byType || byUid, `${id}: source "${j.source}" resolves to a live block`).toBe(true);
    }
  });
});
