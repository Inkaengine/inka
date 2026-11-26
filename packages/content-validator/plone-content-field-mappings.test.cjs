// `plone-content field-mappings`: the mappings the editor stores, for content
// that doesn't pass through the editor (a conversion, a fixture, a migration).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, 'plone-content.cjs');
const config = {
  listing: {
    id: 'listing',
    blockSchema: {
      properties: {
        variation: { title: 'Item type', widget: 'blockTypeSelect', filterConvertibleFrom: '@default' },
        fieldMapping: {
          title: 'Field mapping',
          widget: 'field_mapping',
          sourceFields: { getURL: { title: 'URL', type: 'string' }, title: { title: 'Title', type: 'string' } },
        },
      },
    },
  },
  card: {
    id: 'card',
    fieldMappings: { '@default': { getURL: 'url', title: 'title' } },
    blockSchema: {
      properties: {
        title: { title: 'Title', type: 'string' },
        url: { title: 'Link', widget: 'object_browser', mode: 'link' },
      },
    },
  },
};

function site(pages) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'field-mappings-'));
  for (const [name, page] of Object.entries(pages)) {
    fs.mkdirSync(path.join(dir, 'content', name), { recursive: true });
    fs.writeFileSync(path.join(dir, 'content', name, 'data.json'), JSON.stringify(page));
  }
  fs.writeFileSync(path.join(dir, 'schemas.json'), JSON.stringify(config));
  return dir;
}
const run = (dir) => [path.join(dir, 'content'), '--schemas', path.join(dir, 'schemas.json')];
const read = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, 'content', name, 'data.json'), 'utf8'));

describe('plone-content field-mappings', () => {
  it("stores the widget's default, and gives a stored entry its conversion", () => {
    const dir = site({
      a: { blocks: { l: { '@type': 'listing', variation: 'card' } }, blocks_layout: { items: ['l'] } },
      b: { blocks: { l: { '@type': 'listing', variation: 'card', fieldMapping: { '@id': 'url' } } }, blocks_layout: { items: ['l'] } },
    });
    execFileSync('node', [CLI, 'field-mappings', ...run(dir)]);
    assert.deepEqual(read(dir, 'a').blocks.l.fieldMapping, {
      getURL: { field: 'url', type: 'link' },
      title: { field: 'title', type: 'string' },
    });
    assert.deepEqual(read(dir, 'b').blocks.l.fieldMapping, { getURL: { field: 'url', type: 'link' } });
  });

  it('leaves a page with nothing to store as it was, byte for byte', () => {
    const text = '{"blocks": {"x": {"@type": "card", "title": "T"}},\n "blocks_layout": {"items": ["x"]}}';
    const dir = site({});
    fs.mkdirSync(path.join(dir, 'content', 'p'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'content', 'p', 'data.json'), text);
    execFileSync('node', [CLI, 'field-mappings', ...run(dir)]);
    assert.equal(fs.readFileSync(path.join(dir, 'content', 'p', 'data.json'), 'utf8'), text);
  });

  // A layout names its folders by path, so a page can sit at any depth.
  it("writes a page at any depth, in its file's own indentation", () => {
    const dir = site({ 'a/b/c': { blocks: { l: { '@type': 'listing', variation: 'card' } }, blocks_layout: { items: ['l'] } } });
    const file = path.join(dir, 'content', 'a/b/c', 'data.json');
    fs.writeFileSync(file, `${JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')), null, 4)}\n`);
    execFileSync('node', [CLI, 'field-mappings', ...run(dir)]);
    const written = fs.readFileSync(file, 'utf8');
    assert.ok(JSON.parse(written).blocks.l.fieldMapping);
    assert.equal(written, `${JSON.stringify(JSON.parse(written), null, 4)}\n`);
  });

  it('fails on a listing with no item type, naming it', () => {
    const dir = site({ a: { blocks: { l: { '@type': 'listing' } }, blocks_layout: { items: ['l'] } } });
    const { status, stderr } = spawnSync('node', [CLI, 'field-mappings', ...run(dir)], { encoding: 'utf8' });
    assert.notEqual(status, 0);
    assert.match(stderr, /Block l .*item type/);
  });

  // Run where only Node is (the conversion's server): the helpers it needs have
  // no packages of their own.
  it('runs with no packages installed', () => {
    const packages = path.join(__dirname, '..');
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'field-mappings-copy-'));
    const noModules = { recursive: true, filter: (source) => path.basename(source) !== 'node_modules' };
    fs.cpSync(path.join(packages, 'content-validator'), copy, noModules);
    fs.cpSync(path.join(packages, 'helpers'), path.join(copy, 'node_modules/@volto-hydra/helpers'), noModules);
    const dir = site({ a: { blocks: { l: { '@type': 'listing', variation: 'card' } }, blocks_layout: { items: ['l'] } } });
    execFileSync('node', [path.join(copy, 'plone-content.cjs'), 'field-mappings', ...run(dir)]);
    assert.equal(read(dir, 'a').blocks.l.fieldMapping.getURL.type, 'link');
  });

  // A site's own catalog column (offered through a vocabulary) holds what its
  // field on the content types holds: a list stores as one.
  describe("a site's own column", () => {
    const withColumns = (dir) => {
      const schemas = JSON.parse(fs.readFileSync(path.join(dir, 'schemas.json'), 'utf8'));
      schemas.listing.blockSchema.properties.fieldMapping.vocabulary = { '@id': 'plone.app.vocabularies.MetadataFields' };
      schemas.card.blockSchema.properties.tags = { title: 'Tags', type: 'array' };
      fs.writeFileSync(path.join(dir, 'schemas.json'), JSON.stringify(schemas));
      fs.writeFileSync(
        path.join(dir, 'types.json'),
        JSON.stringify({ Document: { properties: { Topic: { type: 'array', items: { type: 'string' } } } } }),
      );
      return dir;
    };
    const listing = { '@type': 'Document', blocks: { l: { '@type': 'listing', variation: 'card', fieldMapping: { Topic: 'tags' } } }, blocks_layout: { items: ['l'] } };

    it('stores the conversion its field on the content types calls for', () => {
      const dir = withColumns(site({ a: listing }));
      execFileSync('node', [CLI, 'field-mappings', ...run(dir), '--content-types', path.join(dir, 'types.json')]);
      assert.deepEqual(read(dir, 'a').blocks.l.fieldMapping, { Topic: { field: 'tags', type: 'array' } });
    });

    it('fails without the content types, saying so', () => {
      const dir = withColumns(site({ a: listing }));
      const { status, stderr } = spawnSync('node', [CLI, 'field-mappings', ...run(dir)], { encoding: 'utf8' });
      assert.notEqual(status, 0);
      assert.match(stderr, /content types/);
    });
  });

  it('needs the schemas', () => {
    const { status } = spawnSync('node', [CLI, 'field-mappings', os.tmpdir()], { encoding: 'utf8' });
    assert.equal(status, 2);
  });
});
