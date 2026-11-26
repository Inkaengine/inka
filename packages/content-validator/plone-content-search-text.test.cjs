// `plone-content search-text`: what the editor writes on save, for content that doesn't
// pass through the editor.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, 'plone-content.cjs');

function site(page, config = { card: { id: 'card', blockSchema: { properties: { title: { type: 'string' } } } } }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-text-'));
  fs.mkdirSync(path.join(dir, 'content', 'page'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'content', 'page', 'data.json'), JSON.stringify(page));
  fs.writeFileSync(path.join(dir, 'schemas.json'), JSON.stringify(config));
  return dir;
}
const run = (dir) => [path.join(dir, 'content'), '--schemas', path.join(dir, 'schemas.json')];

describe('plone-content search-text', () => {
  it('writes each block its text, and the core text block needs no schema', () => {
    const dir = site({
      blocks: {
        a: { '@type': 'card', title: 'Card text' },
        b: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Typed' }] }], plaintext: 'Old' },
      },
      blocks_layout: { items: ['a', 'b'] },
    });
    execFileSync('node', [CLI, 'search-text', ...run(dir)]);
    const { blocks } = JSON.parse(fs.readFileSync(path.join(dir, 'content', 'page', 'data.json'), 'utf8'));
    assert.equal(blocks.a.searchableText, 'Card text');
    // A Text block's words are its searchableText, and the old copy restapi would read goes.
    assert.equal(blocks.b.searchableText, 'Typed');
    assert.equal('plaintext' in blocks.b, false);
  });

  it('fails on a block type the schemas do not hold', () => {
    const dir = site({ blocks: { a: { '@type': 'unknown' } }, blocks_layout: { items: ['a'] } });
    const { status, stderr } = spawnSync('node', [CLI, 'search-text', ...run(dir)], { encoding: 'utf8' });
    assert.notEqual(status, 0);
    assert.match(stderr, /no schema for block type "unknown"/);
  });

  // The CLI's one dependency, @volto-hydra/helpers, has none of its own: a site can copy
  // the package onto a server with only Node, the helpers where an install would put them.
  it('runs with no packages installed', () => {
    const packages = path.join(__dirname, '..');
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'search-text-copy-'));
    const noModules = { recursive: true, filter: (source) => path.basename(source) !== 'node_modules' };
    fs.cpSync(path.join(packages, 'content-validator'), copy, noModules);
    fs.cpSync(path.join(packages, 'helpers'), path.join(copy, 'node_modules/@volto-hydra/helpers'), noModules);
    const dir = site({ blocks: { a: { '@type': 'card', title: 'Card text' } }, blocks_layout: { items: ['a'] } });
    execFileSync('node', [path.join(copy, 'plone-content.cjs'), 'search-text', ...run(dir)]);
    const { blocks } = JSON.parse(fs.readFileSync(path.join(dir, 'content', 'page', 'data.json'), 'utf8'));
    assert.equal(blocks.a.searchableText, 'Card text');
  });

  // A layout names its folders by path, so a page can sit at any depth; an export names
  // them by UID, all at the top. Both are content trees.
  it('writes a page at any depth', () => {
    const dir = site({ blocks: {}, blocks_layout: { items: [] } });
    const nested = path.join(dir, 'content', 'page', 'child', 'grandchild');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, 'data.json'),
      JSON.stringify({ blocks: { a: { '@type': 'card', title: 'Deep' } }, blocks_layout: { items: ['a'] } }),
    );
    execFileSync('node', [CLI, 'search-text', ...run(dir)]);
    const { blocks } = JSON.parse(fs.readFileSync(path.join(nested, 'data.json'), 'utf8'));
    assert.equal(blocks.a.searchableText, 'Deep');
  });

  // A site keeps its content in git: a rewrite in another indentation would change
  // every line of every page, and hide the change the command made.
  it("keeps each file's own indentation, and leaves a page it doesn't change alone", () => {
    const dir = site({ blocks: { a: { '@type': 'card', title: 'Card text' } }, blocks_layout: { items: ['a'] } });
    const file = path.join(dir, 'content', 'page', 'data.json');
    fs.writeFileSync(file, `${JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')), null, 4)}\n`);
    const out = execFileSync('node', [CLI, 'search-text', ...run(dir)], { encoding: 'utf8' });
    assert.match(out, /1 page\(s\) written/);
    const written = fs.readFileSync(file, 'utf8');
    assert.equal(written, `${JSON.stringify(JSON.parse(written), null, 4)}\n`);
    const again = execFileSync('node', [CLI, 'search-text', ...run(dir)], { encoding: 'utf8' });
    assert.match(again, /0 page\(s\) written/);
    assert.equal(fs.readFileSync(file, 'utf8'), written);
  });

  it('needs the schemas', () => {
    const { status } = spawnSync('node', [CLI, 'search-text', os.tmpdir()], { encoding: 'utf8' });
    assert.equal(status, 2);
  });
});
