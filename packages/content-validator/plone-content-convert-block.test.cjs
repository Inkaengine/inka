// `plone-content convert-block`: one block converted to another type as the
// editor converts it (convertBlockType, through the site's field mappings), for
// a program that makes content outside the editor (a site converter, a
// migration). The block is read from stdin and the converted block written to
// stdout, both JSON.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, 'plone-content.cjs');
const config = {
  card: {
    id: 'card',
    fieldMappings: {
      '@default': { getURL: { field: 'url', type: 'link' }, title: 'title', description: 'description', image: 'image' },
    },
    blockSchema: {
      properties: {
        title: { title: 'Title', type: 'string' },
        description: { title: 'Copy', type: 'string', widget: 'textarea' },
        image: { title: 'Image', widget: 'image' },
        url: { title: 'Link', widget: 'object_browser', mode: 'link' },
      },
    },
  },
  teaser: {
    id: 'teaser',
    fieldMappings: {
      '@default': { getURL: { field: 'href', type: 'link' }, title: 'heading', description: 'summary', image: 'picture' },
    },
    blockSchema: {
      properties: {
        heading: { title: 'Heading', type: 'string' },
        summary: { title: 'Summary', type: 'string', widget: 'textarea' },
        picture: { title: 'Picture', widget: 'image' },
        href: { title: 'Link', widget: 'object_browser', mode: 'link' },
      },
    },
  },
  // No mappings: nothing converts to or from it.
  separator: { id: 'separator', blockSchema: { properties: {} } },
};

function schemasFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-block-'));
  const file = path.join(dir, 'schemas.json');
  fs.writeFileSync(file, JSON.stringify(config));
  return file;
}

const convert = (block, to, schemas = schemasFile()) =>
  spawnSync('node', [CLI, 'convert-block', '--schemas', schemas, '--to', to], {
    input: JSON.stringify(block),
    encoding: 'utf8',
  });

describe('plone-content convert-block', () => {
  // Only the new type's fields: the editor keeps the old type's too, to restore
  // them on converting back, but content made outside it is converted once,
  // and the content check refuses a field its block does not declare.
  it('converts a block as the editor does, through the content-item fields, keeping only the new type\'s fields', () => {
    const card = {
      '@type': 'card',
      title: 'Find a park',
      description: 'Over 900 parks.',
      image: '/images/park.jpg',
      url: [{ '@id': '/parks' }],
    };
    const result = convert(card, 'teaser');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      '@type': 'teaser',
      heading: 'Find a park',
      summary: 'Over 900 parks.',
      picture: '/images/park.jpg',
      href: [{ '@id': '/parks' }],
    });
  });

  it('gives each value the shape its new field holds', () => {
    // A link stored as a plain address arrives as the link the field holds.
    const result = convert({ '@type': 'card', title: 'T', url: '/parks' }, 'teaser');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).href, [{ '@id': '/parks' }]);
  });

  it('refuses a type the block does not convert to', () => {
    const result = convert({ '@type': 'card', title: 'T' }, 'separator');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /card does not convert to separator/);
  });

  it('refuses a type the site does not have', () => {
    const result = convert({ '@type': 'card', title: 'T' }, 'gallery');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /gallery/);
  });

  it('needs the schemas and a type to convert to', () => {
    const noSchemas = spawnSync('node', [CLI, 'convert-block', '--to', 'teaser'], { input: '{}', encoding: 'utf8' });
    assert.equal(noSchemas.status, 2);
    assert.match(noSchemas.stderr, /--schemas/);
    const noType = spawnSync('node', [CLI, 'convert-block', '--schemas', schemasFile()], { input: '{}', encoding: 'utf8' });
    assert.equal(noType.status, 2);
    assert.match(noType.stderr, /--to/);
  });
});
