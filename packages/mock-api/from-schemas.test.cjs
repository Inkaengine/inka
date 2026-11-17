/**
 * The steps a served tree gets from the frontend's block schemas, after blockmd has
 * decoded it from the markdown alone: link summaries (only a schema says which field
 * is a link) and a codeExample that shows a block type's schema.
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let readTree;
let resolveLinkSummaries;
let resolveSchemaExamples;
let schemaRegistryFromBlockDefinitions;
before(async () => {
  ({ readTree } = await import('@inka/blockmd/markdown-mount.mjs'));
  ({ resolveLinkSummaries, resolveSchemaExamples, schemaRegistryFromBlockDefinitions } = await import('./from-schemas.mjs'));
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
      'source.md': source(`<block type="teaser" data-json='{"href":[{"@id":"/target"}],"title":"See"}' />`),
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
      'source.md': source(`<block type="teaser" data-json='{"href":[{"@id":"/page"}]}' />`),
    });
    const [teaser] = Object.values(items.get('/source').blocks);
    assert.deepEqual(teaser.href[0], {
      '@id': '/page', '@type': 'Document', Title: 'Page', Description: 'The Page content type.',
      title: 'Page', head_title: null, getRemoteUrl: null, hasPreviewImage: true, image_field: 'preview_image',
    });
  });

  it('leaves a url-widget field (an external string) untouched', () => {
    const items = tree({ 'source.md': source(`<block type="card" data-json='{"href":"https://example.com"}' />`) });
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
