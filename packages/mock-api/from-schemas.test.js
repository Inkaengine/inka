/**
 * The steps a served tree gets from the frontend's block schemas, after blockmd has
 * decoded it from the markdown alone: link summaries (only a schema says which field
 * is a link) and a codeExample that shows a block type's schema.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, describe, it } from 'node:test';

let readTree;
let resolveLinkSummaries;
let resolveSchemaExamples;
let schemaRegistryFromBlockDefinitions;
before(async () => {
  ({ readTree } = await import('@inka/blockmd/markdown-mount.mjs'));
  ({ resolveLinkSummaries, resolveSchemaExamples, schemaRegistryFromBlockDefinitions } = await import('./from-schemas.js'));
});

const isFolderish = (type) => !['Image', 'File', 'Link', 'Collection'].includes(type);

describe('link summaries: a bare link to a local page gets its summary', () => {
  // The markdown stores a link to a local object as `[{'@id'}]`. Volto snapshots a
  // link's summary when it is edited and never re-resolves it, so the distribution
  // must already carry it, or a deployed teaser has no title or description. Which
  // field is a link is the WIDGET's (object_browser), not the field name's: `href`
  // is a link on a teaser but a url string on a card.
  const schemaFor = (t) => (t === 'teaser'
    ? { properties: { href: { widget: 'object_browser', mode: 'link' }, title: { type: 'string' } } }
    : t === 'card' ? { properties: { href: { widget: 'url' } } }
      : null);

  const tree = (files) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'from-schemas-'));
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name), text);
    const { items } = readTree(root, { isFolderish });
    fs.rmSync(root, { recursive: true, force: true });
    return resolveLinkSummaries(items, { schemaFor });
  };
  const source = (tag) => ['---', '"@type": Document', 'UID: srcuid1234567', 'id: source', '---', '', tag, ''].join('\n');

  it('fills @type, Title and Description onto a bare object_browser link', () => {
    const items = tree({
      'target.md': '---\n"@type": Document\nUID: tgtuid1234567\nid: target\ntitle: Target Page\ndescription: A described target\n---\n',
      'source.md': source(`<block is="teaser" data-json='{"href":[{"@id":"/target"}],"title":"See"}' />`),
    });
    const [teaser] = Object.values(items.get('/source').blocks);
    assert.equal(teaser.href[0]['@id'], '/target');
    assert.equal(teaser.href[0].Title, 'Target Page');
    assert.equal(teaser.href[0].Description, 'A described target');
    assert.equal(teaser.href[0]['@type'], 'Document');
  });

  it('reproduces the exact Volto snapshot shape for a target with a preview', () => {
    // The same object Volto snapshots when it is edited, so a source stripped to
    // the bare `@id` deploys byte-identical to the form it replaces.
    const items = tree({
      'page.md': '---\n"@type": Document\nUID: pageuid12345678\nid: page\ntitle: Page\ndescription: The Page content type.\npreview_image:\n  blob_path: page/preview.png\n---\n',
      'source.md': source(`<block is="teaser" data-json='{"href":[{"@id":"/page"}]}' />`),
    });
    const [teaser] = Object.values(items.get('/source').blocks);
    assert.deepEqual(teaser.href[0], {
      '@id': '/page', '@type': 'Document', Title: 'Page', Description: 'The Page content type.',
      title: 'Page', head_title: null, getRemoteUrl: null, hasPreviewImage: true, image_field: 'preview_image',
    });
  });

  it('leaves a url-widget field (an external string) untouched', () => {
    const items = tree({ 'source.md': source(`<block is="card" data-json='{"href":"https://example.com"}' />`) });
    const [card] = Object.values(items.get('/source').blocks);
    assert.equal(card.href, 'https://example.com');
  });
});

describe('a codeExample that shows a block type\'s schema', () => {
  const schemaFor = () => schemaRegistryFromBlockDefinitions({
    accordion: { blocks: { accordion: { blockSchema: { properties: { panels: { widget: 'object_list' } } } } } },
  });
  const page = () => ({
    blocks: { 'ce-schema': { '@type': 'codeExample', slotId: 'schema', source: 'accordion', format: 'schema' } },
    blocks_layout: { items: ['ce-schema'] },
  });

  it('shows the registry schema, and consumes the directive', () => {
    const p = resolveSchemaExamples(page(), { schemaFor: schemaFor() });
    const block = p.blocks['ce-schema'];
    assert.deepEqual(JSON.parse(block.tabs[0].code), { properties: { panels: { widget: 'object_list' } } });
    assert.equal('source' in block || 'format' in block, false);
  });

  it('fails loud on a type with no schema', () => {
    const p = page();
    p.blocks['ce-schema'].source = 'video';
    assert.throws(() => resolveSchemaExamples(p, { schemaFor: schemaFor() }), /video/);
  });

  it('builds the registry from the flat sharedBlocksConfig shape too', () => {
    const flat = schemaRegistryFromBlockDefinitions({
      listing: { id: 'listing', blockSchema: { fieldsets: [{ id: 'default' }] } },
      accordion: { blockSchema: { properties: { panels: {} } } },
    });
    assert.deepEqual(flat('listing'), { fieldsets: [{ id: 'default' }] });
    assert.deepEqual(flat('accordion'), { properties: { panels: {} } });
    assert.equal(flat('nope'), undefined);
  });
});

describe('search text where the content stores none', () => {
  // The editor's save writes each block's search text; content read from disk was
  // never saved. With the frontend's config, the mock fills what is missing, by the
  // same rule as save, and keeps what the content stores.
  let withMissingSearchText;
  before(async () => { ({ withMissingSearchText } = await import('./from-schemas.js')); });
  const blocksConfig = { card: { blockSchema: { properties: { title: { type: 'string' } } } } };
  const slate = (text) => [{ type: 'p', children: [{ text }] }];
  const page = (blocks) => ({ blocks, blocks_layout: { items: Object.keys(blocks) } });

  it('fills a block that has none', () => {
    const out = withMissingSearchText(page({ a: { '@type': 'card', title: 'A card' }, b: { '@type': 'slate', value: slate('Words') } }), blocksConfig);
    assert.equal(out.blocks.a.searchableText, 'A card');
    assert.equal(out.blocks.b.searchableText, 'Words');
  });

  it('keeps one the content stores', () => {
    const out = withMissingSearchText(page({ a: { '@type': 'card', title: 'A card', searchableText: 'Chosen words' } }), blocksConfig);
    assert.equal(out.blocks.a.searchableText, 'Chosen words');
  });
});

describe('a markdown export leaves out the search text the frontend would give anyway', () => {
  let withoutDefaultSearchText;
  before(async () => { ({ withoutDefaultSearchText } = await import('./from-schemas.js')); });
  const blocksConfig = { card: { blockSchema: { properties: { title: { type: 'string' } } } } };
  const page = (blocks) => ({ blocks, blocks_layout: { items: Object.keys(blocks) } });

  it('drops a default one, and keeps one set to something else', () => {
    const out = withoutDefaultSearchText(page({
      a: { '@type': 'card', title: 'A card', searchableText: 'A card' },
      b: { '@type': 'card', title: 'B card', searchableText: 'Chosen words' },
    }), blocksConfig);
    assert.equal('searchableText' in out.blocks.a, false);
    assert.equal(out.blocks.b.searchableText, 'Chosen words');
  });
});

describe('a text link gets back the item it was picked from', () => {
  // The link editor keeps the picked item's catalog metadata beside a text
  // link's address (`data.item`: a file's type and size, which a frontend draws
  // after the link). Markdown writes the link alone, so loading it puts the
  // metadata back from the item the link points at, as the editor would have.
  const schemaFor = () => null;
  const catalogEntry = (target) => ({
    '@id': `http://site${target['@id'] ?? ''}`, portal_type: target['@type'], title: target.title,
    mime_type: 'application/pdf', getObjSize: '1.2 MB', Creator: 'someone',
  });
  const load = (files) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'link-items-'));
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name), text);
    const { items } = readTree(root, { isFolderish });
    fs.rmSync(root, { recursive: true, force: true });
    return resolveLinkSummaries(items, { schemaFor, catalogEntry });
  };
  const page = (body) => ['---', '"@type": Document', 'UID: srcuid1234567', 'id: source',
    'blocks-matched: |', '  <block is="slate" value="${p,a/slate}" />', '---', '', body, ''].join('\n');
  const report = '---\n"@type": File\nUID: reportuid123456\nid: report.pdf\ntitle: Annual report\n---\n';
  const linkIn = (items) => Object.values(items.get('/source').blocks)[0].value[0].children
    .find((n) => n.type === 'link');

  it("fills the item's metadata, as the link editor keeps it", () => {
    const link = linkIn(load({ 'report.pdf.md': report, 'source.md': page('Read the [annual report](/report.pdf).') }));
    assert.deepEqual(link.data.item, {
      portal_type: 'File', title: 'Annual report', mime_type: 'application/pdf', getObjSize: '1.2 MB',
    });
  });

  it('leaves a link to somewhere outside the site as it is', () => {
    const link = linkIn(load({ 'source.md': page('See [elsewhere](https://example.org/x).') }));
    assert.equal(link.data.item, undefined);
  });
});

describe('a markdown export leaves out a value its schema declares as the default', () => {
  // The editor applies a field's declared default and saves it, and a frontend
  // renders the stored value. So the Markdown leaves a default value out, and
  // loading puts it back: what is deployed is what was stored.
  let withoutSchemaDefaults, withSchemaDefaults;
  before(async () => { ({ withoutSchemaDefaults, withSchemaDefaults } = await import('./from-schemas.js')); });
  const blocksConfig = {
    question: { blockSchema: { properties: {
      label: { type: 'string' },
      required: { type: 'boolean', default: false },
      size: { type: 'string', default: 'l' },
    } } },
  };
  const page = (blocks) => ({ blocks, blocks_layout: { items: Object.keys(blocks) } });

  it('drops a value equal to its default, and keeps any other', () => {
    const out = withoutSchemaDefaults(page({
      a: { '@type': 'question', label: 'Name', required: false, size: 'l' },
      b: { '@type': 'question', label: 'Email', required: true, size: 'm' },
    }), blocksConfig);
    assert.deepEqual(out.blocks.a, { '@type': 'question', label: 'Name' });
    assert.deepEqual(out.blocks.b, { '@type': 'question', label: 'Email', required: true, size: 'm' });
  });

  it('loading puts the default back, so the round trip is exact', () => {
    const stored = page({ a: { '@type': 'question', label: 'Name', required: false, size: 'l' } });
    assert.deepEqual(withSchemaDefaults(withoutSchemaDefaults(stored, blocksConfig), blocksConfig), stored);
  });

  it("keeps a default the block's prototype states, which its bare Markdown implies", () => {
    const out = withoutSchemaDefaults(page({ a: { '@type': 'question', label: 'Name', required: false, size: 'l' } }), blocksConfig,
      { keep: (type, field) => type === 'question' && field === 'size' });
    assert.deepEqual(out.blocks.a, { '@type': 'question', label: 'Name', size: 'l' });
  });

  it("drops a list item's default without giving the item anything else", () => {
    // A form's fields are typed by `field_type`, not `@type`; reading one as a
    // block shows it a type, which must not be written back into the content.
    const config = {
      form: { blockSchema: { properties: { subblocks: {
        widget: 'object_list', idField: 'field_id', typeField: 'field_type',
        schema: { properties: { label: { type: 'string' }, required: { type: 'boolean', default: false } } },
      } } } },
    };
    const out = withoutSchemaDefaults(page({ f: { '@type': 'form', subblocks: [
      { field_id: 'n', field_type: 'text', label: 'Name', required: false },
      { field_id: 'e', field_type: 'from', label: 'Email', required: true },
    ] } }), config);
    assert.deepEqual(out.blocks.f.subblocks, [
      { field_id: 'n', field_type: 'text', label: 'Name' },
      { field_id: 'e', field_type: 'from', label: 'Email', required: true },
    ]);
  });

  it('keeps a value whose default comes from the value itself, which loading could not put back', () => {
    // A listing in a container takes its item type's default from what it holds:
    // with `card` stored the schema says `card`, without it there is no default.
    const config = {
      teaser: { blockSchema: ({ formData }) => ({ properties: {
        variation: formData?.variation ? { type: 'string', default: formData.variation } : { type: 'string' },
        size: { type: 'string', default: 'l' },
      } }) },
    };
    const stored = page({ t: { '@type': 'teaser', variation: 'card', size: 'l' } });
    const out = withoutSchemaDefaults(stored, config);
    assert.deepEqual(out.blocks.t, { '@type': 'teaser', variation: 'card' });
    assert.deepEqual(withSchemaDefaults(out, config), stored);
  });

  it('leaves a stored null alone, rather than turning it into the default', () => {
    const out = withSchemaDefaults(page({ a: { '@type': 'question', label: 'Name', size: null } }), blocksConfig);
    assert.equal(out.blocks.a.size, null);
    assert.equal(out.blocks.a.required, false);
  });

  it("gives a region no value: its default is the children it starts with, kept in the block's blocks", () => {
    // A blocks_layout region holds its children in the block's `blocks` and
    // `blocks_layout`, never under its own name. Its default lists the blocks a
    // new one starts with, which is no value for a field called `listing`.
    const config = {
      search: { blockSchema: { properties: {
        listing: { widget: 'blocks_layout', allowedBlocks: ['listing'], default: [{ '@type': 'listing' }] },
      } } },
      listing: { blockSchema: { properties: {} } },
    };
    const stored = page({ s: {
      '@type': 'search',
      blocks: { l: { '@type': 'listing' } },
      blocks_layout: { listing: ['l'] },
    } });
    const out = withSchemaDefaults(stored, config);
    assert.equal('listing' in out.blocks.s, false, JSON.stringify(out.blocks.s));
    assert.deepEqual(out, stored);
  });
});

describe("a markdown export leaves out a template child's slot named from its region", () => {
  // The editor names the slot of a block inside a template's block from that
  // block's slot and the region it sits in (regionSlotId: `example-items`), so
  // the Markdown leaves that name out and loading names it again. A slot named
  // otherwise (a fixed child's own) is kept, as is any outside an instance.
  let withoutRegionSlots, withRegionSlots;
  before(async () => { ({ withoutRegionSlots, withRegionSlots } = await import('./from-schemas.js')); });
  const blocksConfig = {
    group: { blockSchema: { properties: { items: { widget: 'blocks_layout' } } } },
    slate: { blockSchema: { properties: {} } },
  };
  const I = { templateId: '/t', templateInstanceId: 'i1' };
  const stored = () => ({
    blocks: {
      g: {
        '@type': 'group', ...I, slotId: 'example',
        blocks: {
          a: { '@type': 'group', ...I, slotId: 'example-items',
            blocks: { x: { '@type': 'slate', ...I, slotId: 'example-items-items' } }, blocks_layout: { items: ['x'] } },
          b: { '@type': 'slate', ...I, slotId: 'example-items-2', fixed: true },
          c: { '@type': 'slate', templateId: '/s', templateInstanceId: 's1', slotId: 'snip-body' },
        },
        blocks_layout: { items: ['a', 'b', 'c'] },
      },
    },
    blocks_layout: { items: ['g'] },
  });

  it('drops a slot named from its region, at every depth, and keeps any other', () => {
    const out = withoutRegionSlots(stored(), blocksConfig);
    const g = out.blocks.g;
    assert.equal(g.slotId, 'example');
    assert.equal('slotId' in g.blocks.a, false);
    assert.equal('slotId' in g.blocks.a.blocks.x, false);
    assert.equal(g.blocks.b.slotId, 'example-items-2');
    assert.equal(g.blocks.c.slotId, 'snip-body');
  });

  it('loading names it again, so the round trip is exact', () => {
    assert.deepEqual(withRegionSlots(withoutRegionSlots(stored(), blocksConfig), blocksConfig), stored());
  });
});
