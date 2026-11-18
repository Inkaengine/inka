/**
 * A page deployed from markdown is found by its words. The editor's save is what writes a
 * page's search text (`searchableText` on each block), and markdown never goes through it.
 * Given the frontend's block config (CONTENT_SCHEMAS), the mock fills it after reading the
 * markdown, and the export ships it. Without it the markdown still loads and exports as
 * it is: decoding needs nothing but the page.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MODULE = path.join(__dirname, 'mock-plone-api.cjs');

/** A markdown mount whose site root holds a paragraph and a card. */
function markdownMount() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-md-search-'));
  fs.writeFileSync(path.join(dir, 'index.md'), [
    '---',
    '"@type": Document',
    'id: site',
    'UID: md-search-root-0001',
    'title: Site',
    'blocks-matched: |',
    '  <block type="slate" value="${p,strong/slate}" />',
    'blocks-tagged: |',
    '  <block type="card" title="${h2/text}" />',
    '---',
    '',
    'Found by **these** words.',
    '',
    '<block type="card">',
    '',
    '## A card title',
    '',
    '</block>',
    '',
  ].join('\n'));
  return dir;
}

function schemasFile() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'md-search-schemas-')), 'schemas.json');
  fs.writeFileSync(file, JSON.stringify({
    slate: { blockSchema: { properties: { value: { widget: 'slate' } } } },
    card: { blockSchema: { properties: { title: { type: 'string' } } } },
  }));
  return file;
}

/** POST /@export (json) from the mock started with `env`; the site root's data.json, or the error. */
function exportRoot(env) {
  const zip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'md-search-export-')), 'export.zip');
  const run = spawnSync(
    process.execPath,
    ['-e', `const m = require(${JSON.stringify(MODULE)});
      m.ready.then(async () => {
        const srv = m.app.listen(0);
        await require('events').once(srv, 'listening');
        const res = await fetch('http://localhost:' + srv.address().port + '/@export', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"format":"json"}',
        });
        if (!res.ok) { console.log('RESULT ' + JSON.stringify({ status: res.status, body: await res.text() })); process.exit(0); }
        require('fs').writeFileSync(${JSON.stringify(zip)}, Buffer.from(await res.arrayBuffer()));
        const out = require('child_process').execFileSync('unzip', ['-p', ${JSON.stringify(zip)}, 'content/plone_site_root/data.json']);
        console.log('RESULT ' + JSON.stringify(JSON.parse(out)));
        process.exit(0);
      });`],
    { env: { ...process.env, PORT: '0', ...env }, encoding: 'utf8', timeout: 60_000 },
  );
  assert.equal(run.status, 0, run.stderr.slice(-2000));
  const line = run.stdout.split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, run.stdout.slice(-2000) + run.stderr.slice(-2000));
  return JSON.parse(line.slice(7));
}

describe('@export of markdown writes search text', () => {
  it('each block carries the text it is found by', () => {
    const root = exportRoot({ CONTENT_MOUNTS: `/:${markdownMount()}`, CONTENT_SCHEMAS: schemasFile() });
    const texts = root.blocks_layout.items.map((id) => root.blocks[id].searchableText);
    assert.deepEqual(texts, ['Found by these words.', 'A card title']);
  });

  it('without the block config, exports the markdown as it is', () => {
    const root = exportRoot({ CONTENT_MOUNTS: `/:${markdownMount()}`, CONTENT_SCHEMAS: '' });
    const texts = root.blocks_layout.items.map((id) => root.blocks[id].searchableText);
    assert.deepEqual(texts, [undefined, undefined]);
  });
});
