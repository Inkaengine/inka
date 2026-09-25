import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readTree, schemaRegistryFromBlockDefinitions } from '../../lib/markdown-mount.mjs';
import { sharedBlocksConfig } from '../../tests-playwright/fixtures/shared-block-schemas.js';

// Every block example page carries the block-reference-layout template. Find
// them BY that template — never a hardcoded list, so a new example page is
// covered automatically and a dropped one can't hide. For each, prove the trio
// is single-source: the "Schema" and "JSON" the reader sees are DERIVED by
// `{literalinclude}` — JSON is a `:as: json` self-slice of the page's own block
// instance; Schema is a `:jsobject:` slice of the block's definition in the one
// shared registry (the same sharedBlocksConfig the frontends register from) —
// not hand-copied, so what's documented is what renders. Rendering itself is
// covered by block-sanity; this locks in the single-source property, fast and
// browser-free.
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

  it('derives JSON from the page\'s own live block instance (the thing that renders)', () => {
    for (const [id, page] of examplePages) {
      const j = codeExamples(page, 'json-data')[0];
      const data = JSON.parse(j.tabs[0].code); // `:as: json` self-slice, resolved by readTree
      // The self-slice decoded a block that lives on THIS page — its @type is a
      // real block on the page, so the documented JSON is what renders.
      expect(data['@type'], `${id}: documented instance has a @type`).toBeTruthy();
      expect(Object.values(page.blocks).some((b) => b['@type'] === data['@type']),
        `${id}: json is a live block on the page`).toBe(true);
    }
  });

  it('derives Schema from the block\'s definition in the shared registry (not hand-written)', () => {
    for (const [id, page] of examplePages) {
      const type = JSON.parse(codeExamples(page, 'json-data')[0].tabs[0].code)['@type'];
      const code = codeExamples(page, 'schema')[0].tabs[0].code; // `:jsobject:` slice, resolved
      // It is THIS block's definition, sliced from the one registry: the slice
      // opens with the block key and carries its blockSchema, and the registry
      // has a schema for the same type.
      expect(code, `${id}: schema slot resolved`).toBeTruthy();
      expect(code).toContain(`${type}: {`);
      expect(code).toContain('blockSchema');
      expect(schemaFor(type), `${id}: registry has a schema for ${type}`).toBeTruthy();
    }
  });
});
