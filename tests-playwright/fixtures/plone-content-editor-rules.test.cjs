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
 *  - a block's `fieldRules`: an `error` is an error, a `warning` a warning
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
          allowedBlocks: ['slate', 'banner', 'section', 'columns', 'card', 'text', 'teaser'],
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
  // A schemaEnhancer RECIPE, as a frontend's config declares it (plain data —
  // what a schemas file can carry): the validator builds the enhancer from it
  // with the same fieldRules module the admin uses.
  teaser: {
    blockSchema: {
      properties: { title: { title: 'Title' }, image: { title: 'Image' }, count: { title: 'Count', type: 'integer' } },
    },
    schemaEnhancer: {
      fieldRules: {
        title: { when: { title: { regex: 'TODO' } }, error: 'A teaser title must not say TODO.' },
        image: { when: { image: { isSet: false } }, warning: 'A teaser reads better with an image.' },
      },
    },
  },
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

  it("reports a fieldRules error as an error — the editor will not save it", async () => {
    const r = await checkEditorRules(
      page({ t: { '@type': 'teaser', title: 'TODO write this', image: 'x.png' } }, ['t']),
      SCHEMAS,
    );
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /teaser/);
    assert.match(r.errors[0], /title/);
    assert.match(r.errors[0], /must not say TODO/);
    assert.deepEqual(r.warnings, []);
  });

  it('reports a fieldRules warning as a warning, not an error', async () => {
    const r = await checkEditorRules(page({ t: { '@type': 'teaser', title: 'Ready' } }, ['t']), SCHEMAS);
    assert.deepEqual(r.errors, []);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /image/);
    assert.match(r.warnings[0], /reads better with an image/);
  });

  it('says nothing when no rule fires', async () => {
    const r = await checkEditorRules(
      page({ t: { '@type': 'teaser', title: 'Ready', image: 'x.png' } }, ['t']),
      SCHEMAS,
    );
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
  });
});
