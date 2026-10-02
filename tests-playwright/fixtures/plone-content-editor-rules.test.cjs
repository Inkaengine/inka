/**
 * checkEditorRules(): content is checked against the rules the schemas
 * already declare — the same ones the editor enforces when adding,
 * dragging or converting a block:
 *
 *  - a region's `allowedBlocks`
 *  - an ancestor's `disallowDescendantBlocks` (banned anywhere in its subtree)
 *  - a region's `maxLength`
 *  - a block schema's `required` fields
 *  - a region's text styles (`allowedStyles` / `disallowedStyles`)
 *
 * The validator used to check only that a block's FIELDS were declared, so a
 * block the editor would never let you put somewhere — inside a container
 * that does not allow it — passed validation when an import or a conversion wrote it there.
 *
 * It reuses what the editor itself reads — buildBlockPathMap's
 * `allowedSiblingTypes` / `maxSiblings` / `emptyRequiredFields` and the
 * region's slate rules through normalizeSlateFields — rather than deriving
 * its own. Anything the editor would refuse or rewrite is an error.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { checkEditorRules } = require('./plone-content-validator.cjs');

const SCHEMAS = {
  _page: {
    blockSchema: {
      properties: {
        items: {
          widget: 'blocks_layout',
          allowedBlocks: ['slate', 'banner', 'section', 'columns', 'card', 'text'],
          allowedStyles: ['p', 'h2', 'strong'],
        },
      },
    },
  },
  card: {
    blockSchema: {
      required: ['title'],
      properties: { title: { title: 'Title' }, description: { title: 'Description' } },
    },
  },
  text: { blockSchema: { properties: { value: { title: 'Text', widget: 'slate' } } } },
  slate: { blockSchema: { properties: { value: { title: 'Text' } } } },
  banner: { blockSchema: { properties: {} } },
  section: {
    blockSchema: {
      properties: { items: { widget: 'blocks_layout', allowedBlocks: ['slate', 'columns'], maxLength: 2 } },
    },
  },
  columns: {
    disallowDescendantBlocks: ['columns'],
    blockSchema: {
      properties: { columns: { widget: 'blocks_layout', allowedBlocks: ['column'] } },
    },
  },
  column: {
    blockSchema: {
      properties: { items: { widget: 'blocks_layout', allowedBlocks: ['slate', 'section', 'columns'] } },
    },
  },
};

const page = (blocks, items) => [
  { rel: 'content/x', data: { '@id': '/x', blocks, blocks_layout: { items } } },
];
const section = (children) => ({
  '@type': 'section',
  blocks: Object.fromEntries(children),
  blocks_layout: { items: children.map(([id]) => id) },
});

describe('checkEditorRules()', () => {
  it('passes blocks every region allows', async () => {
    const r = await checkEditorRules(
      page({ t: { '@type': 'banner' }, s: section([['p', { '@type': 'slate' }]]) }, ['t', 's']),
      SCHEMAS,
    );
    assert.deepEqual(r.errors, []);
  });

  it("reports a block its region's allowedBlocks does not allow", async () => {
    const r = await checkEditorRules(
      page({ s: section([['t', { '@type': 'banner' }]]) }, ['s']),
      SCHEMAS,
    );
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /banner/);
    assert.match(r.errors[0], /section/);
    assert.match(r.errors[0], /content\/x/);
  });

  it("reports a type an ancestor's disallowDescendantBlocks bans, however deep", async () => {
    // columns → column → section → columns: the section allows columns, but the
    // outer columns block bans columns anywhere beneath it.
    const inner = { '@type': 'columns', blocks: {}, blocks_layout: { columns: [] } };
    const col = {
      '@type': 'column',
      blocks: { s: section([['c2', inner]]) },
      blocks_layout: { items: ['s'] },
    };
    const outer = { '@type': 'columns', blocks: { col }, blocks_layout: { columns: ['col'] } };
    const r = await checkEditorRules(page({ outer }, ['outer']), SCHEMAS);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /columns/);
  });

  it('reports a region holding more blocks than its maxLength', async () => {
    const r = await checkEditorRules(
      page(
        { s: section([['a', { '@type': 'slate' }], ['b', { '@type': 'slate' }], ['c', { '@type': 'slate' }]]) },
        ['s'],
      ),
      SCHEMAS,
    );
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /3 blocks/);
    assert.match(r.errors[0], /at most 2/);
  });

  it("reports a block at the page's top level its regions do not allow", async () => {
    const r = await checkEditorRules(page({ c: { '@type': 'column', blocks: {}, blocks_layout: { items: [] } } }, ['c']), SCHEMAS);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /column/);
  });

  it('reports a required field left empty', async () => {
    const r = await checkEditorRules(page({ c: { '@type': 'card', description: 'D' } }, ['c']), SCHEMAS);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /card/);
    assert.match(r.errors[0], /title/);
  });

  it('reports a text style its region does not allow — the editor rewrites it on load', async () => {
    const value = [{ type: 'h3', children: [{ text: 'A heading this region does not allow' }] }];
    const r = await checkEditorRules(page({ t: { '@type': 'text', value } }, ['t']), SCHEMAS);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /text/);
    assert.match(r.errors[0], /h3/);
  });

  it('says nothing about text that keeps to its region styles', async () => {
    const value = [{ type: 'h2', children: [{ text: 'Allowed' }] }];
    const r = await checkEditorRules(page({ t: { '@type': 'text', value } }, ['t']), SCHEMAS);
    assert.deepEqual(r.errors, []);
  });
});
