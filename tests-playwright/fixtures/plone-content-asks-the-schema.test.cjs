/**
 * The validator has the schemas. Every question about structure is answered by
 * asking them — never by a hardcoded list of field names, and never by
 * descending into whatever happens to have an `@type`.
 *
 * Each case here is a hole found by auditing for the opposite: a pass that
 * walked `container.blocks` directly, or scanned a fixed list of field names,
 * and so saw one storage and not the other.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  checkIntegrity,
  checkBlockSchemas,
  fieldMapFromSchemas,
} = require('./plone-content-validator.cjs');

// A slider keeps its children in an object_list; a section keeps them in a
// blocks_layout. The rules that follow must not be able to tell the difference.
const SCHEMAS = {
  slider: {
    group: 'common',
    blockSchema: {
      // Items vary in kind, so the field declares which kinds and where each
      // item says which it is — the arm of the rule that makes `card`'s own
      // schema (and so its reference widget) the one its items are read with.
      properties: {
        slides: { widget: 'object_list', idField: '@id', allowedBlocks: ['slide', 'card'], typeField: '@type' },
      },
    },
  },
  slide: { group: 'common', blockSchema: { properties: { title: {} } } },
  card: {
    group: 'common',
    blockSchema: { properties: { link: { widget: 'object_browser' }, title: {} } },
  },
  section: {
    group: 'common',
    blockSchema: { properties: { blocks: { widget: 'blocks_layout' } } },
  },
};
const idFieldMap = { slider: { slides: '@id' } };

const doc = (rel, uid, blocks) => ({
  rel,
  data: { '@id': `/${rel}`, UID: uid, blocks, blocks_layout: { items: Object.keys(blocks) } },
});

describe('the template slot rule reads both storages', () => {
  const template = doc('templates/t', 'TUID', {
    s: {
      '@type': 'slider',
      slotId: 'slider',
      fixed: true,
      slides: [{ '@id': 'tpl-1', '@type': 'slide', slotId: 'slide', fixed: true }],
    },
  });

  it('reports a blocks_layout child of a template slot with no slotId', () => {
    const inst = doc('page', 'PUID', {
      s: {
        '@type': 'section',
        templateId: 'resolveuid/TUID',
        slotId: 'slider',
        blocks: { k: { '@type': 'slide', templateId: 'resolveuid/TUID' } },
        blocks_layout: { items: ['k'] },
      },
    });
    const r = checkIntegrity([template, inst], { idFieldMap, schemasFor: () => SCHEMAS });
    assert.equal(r.errors.filter((e) => /missing slotId/.test(e)).length, 1, r.errors.join('\n'));
  });

  it('reports an object_list child of a template slot with no slotId', () => {
    const inst = doc('page', 'PUID', {
      s: {
        '@type': 'slider',
        templateId: 'resolveuid/TUID',
        slotId: 'slider',
        slides: [{ '@id': 'i-1', '@type': 'slide', templateId: 'resolveuid/TUID' }],
      },
    });
    const r = checkIntegrity([template, inst], { idFieldMap, schemasFor: () => SCHEMAS });
    assert.equal(r.errors.filter((e) => /missing slotId/.test(e)).length, 1, r.errors.join('\n'));
  });
});

describe('a reference field is one the schema gives a reference widget', () => {
  it('checks a broken reference in a field no name list contains', () => {
    // `link` is in no LINK_FIELDS list, but its schema says object_browser.
    const page = doc('page', 'PUID', {
      c: { '@type': 'card', link: [{ '@id': 'resolveuid/deadbeefdeadbeefdeadbeefdeadbeef' }] },
    });
    const r = checkIntegrity([page], { idFieldMap, schemasFor: () => SCHEMAS });
    assert.equal(r.stats.linksBroken, 1, `errors:\n${r.errors.join('\n')}`);
  });

  it('checks references inside an object_list child under its own field name', () => {
    // Not `items`/`columns`/`column_items` — a slider's field is `slides`.
    const page = doc('page', 'PUID', {
      s: {
        '@type': 'slider',
        slides: [
          { '@id': 'i-1', '@type': 'card', link: [{ '@id': 'resolveuid/deadbeefdeadbeefdeadbeefdeadbeef' }] },
        ],
      },
    });
    const r = checkIntegrity([page], { idFieldMap, schemasFor: () => SCHEMAS });
    assert.equal(r.stats.linksBroken, 1, `errors:\n${r.errors.join('\n')}`);
  });
});

describe('a link target is not a block', () => {
  it('does not read the @type of a reference value as a block type', () => {
    // What the restapi serializes into a link field: the TARGET's summary,
    // carrying its content @type. It is not a child block.
    const page = doc('page', 'PUID', {
      c: {
        '@type': 'card',
        title: 'x',
        link: [{ '@id': 'resolveuid/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '@type': 'Document', Creator: 'admin' }],
      },
    });
    const r = checkBlockSchemas([page], fieldMapFromSchemas(SCHEMAS), { idFieldMap });
    assert.deepEqual(
      r.warnings.filter((w) => /not in the field map/.test(w)),
      [],
      'a link target was counted as a block type',
    );
    assert.deepEqual(r.errors, [], r.errors.join('\n'));
  });

  it('still checks the fields of a real object_list child', () => {
    const page = doc('page', 'PUID', {
      s: { '@type': 'slider', slides: [{ '@id': 'i-1', '@type': 'slide', bogus: 1 }] },
    });
    const r = checkBlockSchemas([page], fieldMapFromSchemas(SCHEMAS), { idFieldMap });
    assert.equal(r.errors.length, 1, r.errors.join('\n'));
    assert.match(r.errors[0], /slide\.bogus/);
  });
});

/**
 * The shape fallback runs only where no schema exists, and it has to tell a
 * reference from ordinary prose. `headline: "Listing: Default"` is a title,
 * not a `mailto:` — a bare `scheme:` test reads it as one, and did: it failed
 * every docs page in block-sanity.
 */
describe('the shape fallback does not read prose as a reference', () => {
  const page = (blocks) => [{
    rel: 'content/x',
    data: { '@id': '/x', UID: 'x1', blocks, blocks_layout: { items: Object.keys(blocks) } },
  }];

  it('leaves a headline that merely contains a colon alone', () => {
    const r = checkIntegrity(page({
      l: { '@type': 'listing', headline: 'Listing: Default' },
      g: { '@type': 'gridBlock', headline: 'Listing: Grid (Teaser)' },
    }));
    assert.deepEqual(r.errors, [], r.errors.join('\n'));
    assert.equal(r.stats.linksBroken, 0);
  });

  it('still catches a broken reference with no schema to go on', () => {
    const r = checkIntegrity(page({
      t: { '@type': 'teaser', href: [{ '@id': 'resolveuid/deadbeefdeadbeefdeadbeefdeadbeef' }] },
    }));
    assert.equal(r.stats.linksBroken, 1, r.errors.join('\n'));
  });

  it('does not mistake an object_list item id for a reference', () => {
    const r = checkIntegrity(page({
      s: { '@type': 'slider', slides: [{ '@id': 'slide-1', title: 'x' }] },
    }));
    assert.deepEqual(r.errors, [], r.errors.join('\n'));
  });
});
