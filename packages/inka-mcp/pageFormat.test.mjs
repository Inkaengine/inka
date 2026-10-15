/**
 * The agent page format must round-trip every real page losslessly — stored →
 * agent → stored gives the same page — so an agent that changes nothing changes
 * nothing. Checked over the whole docs corpus, plus the specific shapes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePage } from '../../lib/prototype-mapping.mjs';
import { sharedBlocksConfig } from '../../tests-playwright/fixtures/shared-block-schemas.js';
import { toAgentBlocks, toStoredBlocks, toStoredBlock } from './pageFormat.mjs';

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs') + '/';
const pages = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'content' && e.name !== 'node_modules' && !e.name.startsWith('test-')) walk(p); }
    else if (e.name.endsWith('.md')) pages.push(p);
  }
})(DOCS);

const config = { blocksConfig: sharedBlocksConfig, mintId: () => { throw new Error('a round trip must not mint ids'); } };

describe('agent page format', () => {
  const documents = pages
    .map((file) => { try { return [file, decodePage(readFileSync(file, 'utf8'))]; } catch { return null; } })
    .filter((x) => x && x[1].blocks_layout?.items);

  it('found docs pages to check', () => expect(documents.length).toBeGreaterThan(20));

  for (const [file, stored] of documents) {
    it(`round-trips ${file.slice(DOCS.length)}`, async () => {
      // Yield before a body that blocks the worker: vitest reports each finished
      // test over RPC with a 1s timeout, and a run of synchronous round trips
      // starves it ("Timeout calling onTaskUpdate") though every test passes.
      // Same as lib/prototype-roundtrip.test.mjs.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const agent = toAgentBlocks(stored);
      const back = toStoredBlocks(agent, config);
      expect(toAgentBlocks(back)).toEqual(agent);
    });
  }

  it('gives each block its uid, and rich text as markdown', () => {
    const stored = {
      blocks: { a: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Hi ' }, { text: 'there', bold: true }] }], plaintext: 'Hi there' } },
      blocks_layout: { items: ['a'] },
    };
    expect(toAgentBlocks(stored)).toEqual([{ '@uid': 'a', '@type': 'slate', value: { md: 'Hi **there**' } }]);
  });

  it('names a child list after its region', () => {
    const stored = {
      blocks: {
        c: { '@type': 'columns', blocks: { k: { '@type': 'column', blocks: {}, blocks_layout: { items: [] } } }, blocks_layout: { columns: ['k'] } },
      },
      blocks_layout: { items: ['c'] },
    };
    const [columns] = toAgentBlocks(stored);
    expect(columns.columns.map((b) => b['@uid'])).toEqual(['k']);
    expect(columns.columns[0].blocks).toEqual([]);
  });

  it('accepts a plain markdown string for a rich-text field, and recomputes plaintext', () => {
    const block = toStoredBlock({ '@type': 'slate', value: 'Hello *world*' }, { blocksConfig: sharedBlocksConfig, mintId: () => 'x' });
    expect(block.value[0].type).toBe('p');
    expect(block.plaintext).toBe('Hello world');
  });

  it('mints ids for new blocks and new list items that hold blocks', () => {
    let n = 0;
    const mintId = () => `new-${++n}`;
    const block = toStoredBlock({
      '@type': 'accordion',
      panels: [{ '@type': 'panel', title: 'Q', blocks: [{ '@type': 'slate', value: { md: 'A' } }] }],
    }, { blocksConfig: sharedBlocksConfig, mintId });
    const [panel] = block.panels;
    expect(panel['@id']).toMatch(/^new-/);
    expect(panel.blocks_layout.items).toHaveLength(1);
    expect(panel.blocks[panel.blocks_layout.items[0]].value[0].children[0].text).toBe('A');
  });

  it('refuses something that is not a block', () => {
    expect(() => toStoredBlocks([{ title: 'no type' }], config)).toThrow(/needs "@type"/);
  });
});
