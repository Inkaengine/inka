/**
 * checkEditorRules(): content is checked against the rules the schemas
 * already declare — the same ones the editor enforces when adding,
 * dragging or converting a block:
 *
 *  - a region's `allowedBlocks`
 *  - an ancestor's `disallowDescendantBlocks` (banned anywhere in its subtree)
 *  - a region's `maxLength`
 *  - every field the save refuses: Volto's own validators (required, lengths,
 *    pattern, url, email, number limits, item counts) run through the save's
 *    own step (@volto-hydra/helpers/blockFieldErrors.js) — validateBlocks.parity.test.js
 *    holds the two together
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

  describe("without Volto's validators", () => {
    it('skips the field values, and says so', async () => {
      const r = await checkEditorRules(page({ c: { '@type': 'card', description: 'D' } }, ['c']), SCHEMAS, {
        volto: null,
      });
      assert.deepEqual(r.errors, []);
      assert.equal(r.warnings.length, 1);
      assert.match(r.warnings[0], /not checked/);
      assert.equal(r.stats.fieldErrors, null);
    });

    it('still applies every other rule', async () => {
      const value = [{ type: 'h3', children: [{ text: 'A heading this region does not allow' }] }];
      const r = await checkEditorRules(page({ t: { '@type': 'text', value } }, ['t']), SCHEMAS, { volto: null });
      assert.equal(r.errors.length, 1);
      assert.match(r.errors[0], /h3/);
    });
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

/**
 * checkChooserGroups(): a block the chooser cannot offer is unreachable, no
 * matter how correct every page is. That makes it a defect in the config, not
 * in the content — which is why it is its own pass and not folded into
 * checkEditorRules, where it would re-report the same config error once per
 * page checked.
 */
describe('checkChooserGroups()', () => {
  const { checkChooserGroups } = require('./plone-content-validator.cjs');

  it('passes a block that names a group the chooser orders', () => {
    const r = checkChooserGroups({ hero: { group: 'common', blockSchema: {} } });
    assert.deepEqual(r.errors, []);
    assert.equal(r.stats.ungrouped, 0);
  });

  it('reports a block with no group', () => {
    const r = checkChooserGroups({ hero: { blockSchema: {} } });
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /hero: no `group`/);
    assert.equal(r.stats.ungrouped, 1);
  });

  it('reports a group the chooser does not order', () => {
    const r = checkChooserGroups({ hero: { group: 'bespoke', blockSchema: {} } });
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /group "bespoke" is not one the chooser orders/);
  });

  // A frontend's own voltoConfig.blocks.groupBlocksOrder REPLACES the admin's
  // (the INIT merge replaces arrays), so the chooser renders exactly the groups
  // it declares. Its --schemas module passes that order as `_groupBlocksOrder`.
  it("accepts a group the frontend's own chooser order declares", () => {
    const r = checkChooserGroups({
      _groupBlocksOrder: [{ id: 'mostUsed' }, { id: 'layout' }],
      hero: { group: 'layout', blockSchema: {} },
    });
    assert.deepEqual(r.errors, []);
  });

  it("reports a group the frontend's own chooser order leaves out", () => {
    const r = checkChooserGroups({
      _groupBlocksOrder: [{ id: 'layout' }],
      hero: { group: 'common', blockSchema: {} },
    });
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /group "common" is not one the chooser orders \(layout\)/);
  });

  it('exempts a restricted block, which the chooser never offers', () => {
    const r = checkChooserGroups({ slide: { restricted: true, blockSchema: {} } });
    assert.deepEqual(r.errors, []);
  });

  it('ignores an entry that is not a block config', () => {
    const r = checkChooserGroups({ _page: { title: 'x' }, notABlock: {} });
    assert.deepEqual(r.errors, []);
  });

  it('reports every ungrouped block, not just the first', () => {
    const r = checkChooserGroups({
      a: { blockSchema: {} },
      b: { group: 'media', blockSchema: {} },
      c: { group: 'nope', blockSchema: {} },
    });
    assert.equal(r.errors.length, 2);
    assert.equal(r.stats.blocks, 3);
  });
});

/**
 * The chooser rule must NOT fire from the per-page pass: these fixture schemas
 * declare no groups, and a content check that reported them would report the
 * same config defect once for every page in the site.
 */
describe('checkEditorRules() does not report config defects', () => {
  it('says nothing about an ungrouped block while checking a clean page', async () => {
    const r = await checkEditorRules(page({ s: { '@type': 'slate', value: [] } }, ['s']), SCHEMAS);
    assert.equal(
      r.errors.filter((e) => /group/.test(e)).length,
      0,
      `the per-page pass reported a chooser defect:\n${r.errors.join('\n')}`,
    );
  });
});

/**
 * checkReservedFields(): a block's template membership — `templateId`,
 * `templateInstanceId`, `slotId`, `fixed`, `readOnly` and the merge's
 * `nextSlotId` / `prevSlotId` — is stored on the block beside its own fields.
 * A schema field of the same name shares that key: a tabs block whose "Fixed"
 * option was `fixed: true` read, on a templated page, as a block the template
 * fixes, and the merge took it off the page and drew its tabs elsewhere as
 * unknown blocks. Like the chooser, a defect in the config, not in any page.
 */
describe('checkReservedFields()', () => {
  const { checkReservedFields } = require('./plone-content-validator.cjs');

  it('passes a schema whose fields are its own', () => {
    const r = checkReservedFields({ tabs: { blockSchema: { properties: { fixedTabs: { type: 'boolean' } } } } });
    assert.deepEqual(r.errors, []);
  });

  it('reports a field named for template membership', () => {
    const r = checkReservedFields({ tabs: { blockSchema: { properties: { fixed: { type: 'boolean' } } } } });
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /tabs: field "fixed" is a template-membership key/);
  });

  it('reports every reserved name, on every block', () => {
    const r = checkReservedFields({
      a: { blockSchema: { properties: { slotId: {}, readOnly: {} } } },
      b: { blockSchema: { properties: { templateId: {}, title: {} } } },
    });
    assert.equal(r.errors.length, 3);
  });

  // Inka's own bookkeeping, also stored on the block: the words it indexes,
  // the text it labels a block by, copy-from-target's record, the bridge's
  // anchors, and the block's identity.
  it("reports a field named for Inka's own bookkeeping", () => {
    const r = checkReservedFields({
      a: { blockSchema: { properties: { searchableText: {}, plaintext: {}, _pullFrom: {} } } },
      b: { blockSchema: { properties: { _customFields: {}, _linkableAnchors: {}, '@uid': {} } } },
    });
    assert.equal(r.errors.length, 6);
    assert.match(r.errors.join('\n'), /a: field "searchableText" is a key Inka keeps on every block/);
    assert.match(r.errors.join('\n'), /b: field "@uid" is a key Inka keeps on every block/);
  });

  it('passes the fields a block may declare though content carries them undeclared', () => {
    const r = checkReservedFields({
      x: { blockSchema: { properties: { variation: {}, styles: {}, value: {}, required: {}, blocks: {} } } },
    });
    assert.deepEqual(r.errors, []);
  });

  it('ignores an entry that is not a block config', () => {
    const r = checkReservedFields({ _page: { fixed: true }, notABlock: {} });
    assert.deepEqual(r.errors, []);
  });
});

/**
 * checkFieldsetCoverage(): a field a schema declares but no fieldset lists is
 * invisible in the editor. Nobody can see it, nobody can fix it, and nothing
 * says whether anything still reads it — which is how a button kept a dead
 * `url` field, and nine published pages rendered `<a href="#">` CTAs, for as
 * long as the field was declared (pretagov-site#106, frontend#27).
 *
 * Keeping a field out of the UI on purpose is declared ON the field, so the
 * reason sits where the field is:
 *   - `mode: 'hidden'`  — Volto's Field returns null, and the field stays in
 *     the schema, so a stored value is still declared. The one for config an
 *     author should not edit.
 *   - a schemaEnhancer's `fieldRules: { f: false }` removes the field from the
 *     resolved schema altogether, so a value stored in it then reads as
 *     undeclared. Only for a field that stores nothing.
 */
describe('checkFieldsetCoverage()', () => {
  const { checkFieldsetCoverage } = require('./plone-content-validator.cjs');
  const block = (properties, fieldsets) => ({
    hero: { group: 'common', blockSchema: { fieldsets, properties } },
  });

  it('passes when every field a fieldset lists is declared and vice versa', () => {
    const r = checkFieldsetCoverage(block(
      { title: { type: 'string' }, url: { widget: 'url' } },
      [{ id: 'default', title: 'Default', fields: ['title', 'url'] }],
    ));
    assert.deepEqual(r.errors, []);
  });

  it('reports a declared field no fieldset lists', () => {
    const r = checkFieldsetCoverage(block(
      { title: { type: 'string' }, url: { widget: 'url' } },
      [{ id: 'default', title: 'Default', fields: ['title'] }],
    ));
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /hero\.url/);
    assert.match(r.errors[0], /no fieldset lists it/);
    assert.match(r.errors[0], /mode: 'hidden'/);
  });

  it("accepts a field kept out of the UI with mode: 'hidden'", () => {
    const r = checkFieldsetCoverage(block(
      { title: { type: 'string' }, send_email: { type: 'boolean', mode: 'hidden' } },
      [{ id: 'default', title: 'Default', fields: ['title', 'send_email'] }],
    ));
    assert.deepEqual(r.errors, []);
  });

  // A region is where child blocks live, not a sidebar field: the canvas edits
  // it. Exempt by widget, not by a list of field names.
  it('exempts regions', () => {
    const r = checkFieldsetCoverage(block(
      { title: { type: 'string' }, items: { widget: 'blocks_layout' }, slides: { widget: 'object_list', idField: '@id' } },
      [{ id: 'default', title: 'Default', fields: ['title'] }],
    ));
    assert.deepEqual(r.errors, []);
  });

  // Declaring no fieldsets hides nothing — Volto renders what it is given — so
  // the rule has nothing to say. Six of this site's own object_list item
  // schemas are written that way.
  it('says nothing about a schema that declares no fieldsets', () => {
    const r = checkFieldsetCoverage(block({ title: { type: 'string' }, url: { widget: 'url' } }, undefined));
    assert.deepEqual(r.errors, []);
  });

  it('checks a nested item schema that declares its own fieldsets', () => {
    const r = checkFieldsetCoverage({
      slider: { group: 'common', blockSchema: {
        fieldsets: [{ id: 'default', title: 'Default', fields: ['slides'] }],
        properties: { slides: { widget: 'object_list', idField: '@id', schema: {
          fieldsets: [{ id: 'default', title: 'Slide', fields: ['title'] }],
          properties: { title: { type: 'string' }, href: { widget: 'object_browser' } },
        } } },
      } },
    });
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /slider\.slides\.href/);
  });
});

// An `empty` naming a slot is a template's empty slot (inka#708): Inka's own
// block, which no schema declares and no region lists, held only by a template.
describe('a template stores an empty slot', () => {
  const T = '/templates/t';
  const items = [{
    rel: 'content/templates/t',
    data: {
      '@id': T,
      blocks: {
        s: { ...section([['p', { '@type': 'slate', templateId: T, slotId: 'body', fixed: false }]]), templateId: T, slotId: 's', fixed: true, readOnly: true },
        e: { '@type': 'empty', templateId: T, slotId: 'aside', fixed: false },
      },
      blocks_layout: { items: ['s', 'e'] },
    },
  }];

  it('is not a misplaced block', async () => {
    const r = await checkEditorRules(items, SCHEMAS);
    assert.deepEqual(r.errors, []);
  });

  it('is not a block type missing from the schemas', () => {
    const { checkBlockSchemas, fieldMapFromSchemas } = require('./plone-content-validator.cjs');
    const r = checkBlockSchemas(items, fieldMapFromSchemas(SCHEMAS));
    assert.deepEqual(r.warnings.filter((w) => /"empty"/.test(w)), []);
  });
});

/**
 * checkReservedFields() also reports a field named `@id` below a block's own
 * fields (in an object field, in an untyped list's items): Plone reads every
 * `@id` in stored block data as a link, at any depth.
 */
describe('checkReservedFields() — @id at any depth', () => {
  const { checkReservedFields } = require('./plone-content-validator.cjs');

  it("reports a field named '@id' inside an object field, once", () => {
    const r = checkReservedFields({
      hero: { blockSchema: { properties: { cta: { widget: 'object', schema: { properties: { '@id': {} } } } } } },
    });
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /hero\.cta\.@id/);
  });

  it("reports a top-level '@id' once, not twice", () => {
    const r = checkReservedFields({ teaser: { blockSchema: { properties: { '@id': {} } } } });
    assert.equal(r.errors.length, 1);
  });
});

/**
 * checkFieldMappings(): the same mapping check the editor refuses to load on,
 * so CI fails before a frontend ships a mapping that doesn't make sense.
 */
describe('checkFieldMappings()', () => {
  const { checkFieldMappings } = require('./plone-content-validator.cjs');
  const props = (p) => ({ fieldsets: [{ id: 'default', title: 'Default', fields: Object.keys(p) }], properties: p });

  it('passes mappings that make sense', () => {
    const r = checkFieldMappings({
      card: { fieldMappings: { '@default': { getURL: { field: 'url', type: 'link' }, title: 'title' } }, blockSchema: props({ title: { type: 'string' }, url: { widget: 'object_browser', mode: 'link' } }) },
    });
    assert.deepEqual(r.errors, []);
  });

  it("reports a mapping from '@id', naming getURL", () => {
    const r = checkFieldMappings({
      card: { fieldMappings: { '@default': { '@id': 'url' } }, blockSchema: props({ url: { widget: 'object_browser', mode: 'link' } }) },
    });
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /getURL/);
  });
});
