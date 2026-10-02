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
          allowedBlocks: ['slate', 'banner', 'section', 'columns', 'card', 'text', 'teaser', 'gallery'],
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
  // A rule that reads a REGION (its child block types) and one that reads the
  // PARENT block — the two `when` surfaces that reach beyond the block's own
  // fields, and the ones that need block lookups outside the admin.
  gallery: {
    blockSchema: {
      properties: {
        caption: { title: 'Caption' },
        items: { widget: 'blocks_layout', allowedBlocks: ['picture'] },
      },
    },
    schemaEnhancer: {
      fieldRules: {
        caption: { when: { items: { gte: 3 } }, warning: 'A gallery this large needs a caption.' },
      },
    },
  },
  picture: {
    blockSchema: { properties: { alt: { title: 'Alt' } } },
    schemaEnhancer: {
      fieldRules: {
        alt: { when: { '../caption': { isSet: false }, alt: { isSet: false } }, error: 'An uncaptioned gallery needs alt text on every picture.' },
      },
    },
  },
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

  it('counts maxLength per container, not per container TYPE', async () => {
    // Two sections, each within its maxLength of 2 — together they hold 4.
    // (Distinct block ids: the path map is keyed by id.)
    const two = (p) => section([[`${p}a`, { '@type': 'slate' }], [`${p}b`, { '@type': 'slate' }]]);
    const r = await checkEditorRules(page({ s1: two('x'), s2: two('y') }, ['s1', 's2']), SCHEMAS);
    assert.deepEqual(r.errors, []);
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

  it("evaluates rules that read a region and the parent block", async () => {
    const pictures = { p1: { '@type': 'picture' }, p2: { '@type': 'picture', alt: 'A' }, p3: { '@type': 'picture', alt: 'B' } };
    const gallery = { '@type': 'gallery', blocks: pictures, blocks_layout: { items: ['p1', 'p2', 'p3'] } };
    const r = await checkEditorRules(page({ g: gallery }, ['g']), SCHEMAS);
    // The region holds 3 pictures and there is no caption → the gallery warns.
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /gallery.*caption/);
    // ../caption is unset and p1 has no alt → p1 (only) errors.
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /picture.*\(p1\).*alt/);
  });

  describe('exempt slots', () => {
    // A template slot can hold blocks deliberately placed where the editor
    // would not put them — a design system's documentation showing a component
    // as an example. `exemptSlots` lets a caller name such slots: their blocks'
    // PLACEMENT is not checked; every other rule still is.
    const inSlot = (block) => ({ ...block, slotId: 'example', templateInstanceId: 'doc' });

    it("does not report the placement of a block in an exempt slot", async () => {
      const r = await checkEditorRules(
        page({ s: section([['b', inSlot({ '@type': 'banner' })]]) }, ['s']),
        SCHEMAS,
        { exemptSlots: ['example'] },
      );
      assert.deepEqual(r.errors, []);
    });

    it('still reports it without the exemption', async () => {
      const r = await checkEditorRules(page({ s: section([['b', inSlot({ '@type': 'banner' })]]) }, ['s']), SCHEMAS);
      assert.equal(r.errors.length, 1);
      assert.match(r.errors[0], /banner/);
    });

    it("still applies every other rule to an exempt slot's blocks", async () => {
      const r = await checkEditorRules(
        page({ c: inSlot({ '@type': 'card', description: 'D' }) }, ['c']),
        SCHEMAS,
        { exemptSlots: ['example'] },
      );
      assert.equal(r.errors.length, 1);
      assert.match(r.errors[0], /title/);
    });
  });

  describe('layout documents', () => {
    // A layout document holds the blocks of the REGION that names it in
    // `allowedLayouts` — a site footer's blocks belong to the footer region,
    // not the page's content region — so it is held to that region's rules.
    const WITH_FOOTER = {
      ...SCHEMAS,
      _page: {
        blockSchema: {
          properties: {
            ...SCHEMAS._page.blockSchema.properties,
            footer: { widget: 'blocks_layout', allowedBlocks: ['footerBar'], allowedLayouts: ['/templates/footer'] },
          },
        },
      },
      footerBar: { blockSchema: { properties: {} } },
    };
    const doc = (id, blocks, items) => [{ rel: `content${id}`, data: { '@id': id, blocks, blocks_layout: { items } } }];

    it("checks a layout document against the region that names it", async () => {
      const r = await checkEditorRules(doc('/templates/footer', { f: { '@type': 'footerBar' } }, ['f']), WITH_FOOTER);
      assert.deepEqual(r.errors, []);
    });

    it("still reports a block that region does not allow", async () => {
      const r = await checkEditorRules(doc('/templates/footer', { b: { '@type': 'banner' } }, ['b']), WITH_FOOTER);
      assert.equal(r.errors.length, 1);
      assert.match(r.errors[0], /banner/);
    });

    it('checks any other page against the content region as before', async () => {
      const r = await checkEditorRules(doc('/about', { f: { '@type': 'footerBar' } }, ['f']), WITH_FOOTER);
      assert.equal(r.errors.length, 1);
      assert.match(r.errors[0], /footerBar/);
    });
  });
});
