// Unit tests for writeDistribution — the in-memory → exportimport emitter behind
// POST /@export?format=json. The point of exporting from memory (not cpSync of a
// mount's folder) is that the two mount kinds carry blobs differently: a JSON
// mount's blob_path is UID-keyed, a markdown mount's is tree-relative. Both must
// land in one tar with bytes present and blob_path listed. These tests feed a
// mix of both and assert the emitted layout directly.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { writeDistribution } = require('./mock-plone-api.cjs');

const mkStage = () => fs.mkdtempSync(path.join(os.tmpdir(), 'emit-dist-'));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

describe('writeDistribution (in-memory -> exportimport)', () => {
  it('emits a mixed JSON+markdown blob tree with bytes present and metadata correct', () => {
    const stage = mkStage();
    // Two blob sources, standing in for what each mount kind holds.
    const jsonJpg = path.join(stage, 'src-json.jpg');
    const mdPng = path.join(stage, 'src-md.png');
    fs.writeFileSync(jsonJpg, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));   // jpeg-ish
    fs.writeFileSync(mdPng, Buffer.from([0x89, 0x50, 0x4e, 0x47]));     // png-ish

    const items = [
      { urlPath: '/', data: { '@id': '/', '@type': 'Plone Site', UID: 'plone_site_root', id: 'Plone' } },
      { urlPath: '/docs', data: { '@id': '/docs', '@type': 'Document', UID: 'uid-docs', id: 'docs' } },
      // JSON-mount style: blob_path is UID-keyed, independent of the dir key.
      { urlPath: '/05ab', data: { '@id': '/05ab', '@type': 'Image', UID: 'uid-img-json', id: 'a.jpg',
          image: { blob_path: '05ab/image/a.jpg', 'content-type': 'image/jpeg', filename: 'a.jpg' } } },
      // markdown-mount style: blob_path is tree-relative (no field segment).
      { urlPath: '/pics/b', data: { '@id': '/pics/b', '@type': 'Image', UID: 'uid-img-md', id: 'b.png',
          image: { blob_path: 'pics/b.png', 'content-type': 'image/png', filename: 'b.png' } } },
    ];
    const blobSourceOf = (urlPath) => (urlPath === '/pics/b' ? mdPng : jsonJpg);
    const positions = { 'plone_site_root': 0, 'uid-docs': 1, 'uid-img-json': 2, 'uid-img-md': 3 };

    const meta = writeDistribution(stage, items, { positionOf: (u) => positions[u], blobSourceOf });
    const c = path.join(stage, 'content');

    // Root keyed as plone_site_root; content keyed by path.
    assert.ok(fs.existsSync(path.join(c, 'plone_site_root/data.json')), 'root -> plone_site_root');
    assert.ok(fs.existsSync(path.join(c, 'docs/data.json')), 'document by path');
    assert.ok(fs.existsSync(path.join(c, '05ab/data.json')), 'image item by path');
    assert.ok(fs.existsSync(path.join(c, 'pics/b/data.json')), 'markdown image item by path');

    // Blobs are normalised to <item dir>/<field>/<filename>. The JSON-style one
    // already followed that shape; the markdown-style tree-relative blob_path
    // (pics/b.png) is rewritten to pics/b/image/b.png so it can't collide with
    // the item's own data.json dir.
    assert.deepEqual([...fs.readFileSync(path.join(c, '05ab/image/a.jpg'))], [0xff, 0xd8, 0xff, 0xd9]);
    assert.deepEqual([...fs.readFileSync(path.join(c, 'pics/b/image/b.png'))], [0x89, 0x50, 0x4e, 0x47]);
    // The emitted data.json carries the normalised blob_path, not the original.
    assert.equal(readJson(path.join(c, 'pics/b/data.json')).image.blob_path, 'pics/b/image/b.png');

    // __metadata__ contract.
    assert.equal(meta.__version__, '1.0.0');
    assert.equal(meta._data_files_[0], 'plone_site_root/data.json', 'root ordered first');
    assert.deepEqual([...meta._blob_files_].sort(), ['05ab/image/a.jpg', 'pics/b/image/b.png']);
    for (const uid of Object.keys(positions)) {
      assert.deepEqual(meta.local_roles[uid], { local_roles: { admin: ['Owner'] } }, `local_roles ${uid}`);
      assert.equal(meta.ordering[uid], positions[uid], `ordering ${uid}`);
    }
    // The on-disk __metadata__ matches what was returned.
    assert.deepEqual(readJson(path.join(c, '__metadata__.json')), meta);

    // All six siblings materialise even with no source (defaults).
    for (const sib of ['discussions.json', 'portlets.json', 'principals.json',
                       'redirects.json', 'relations.json', 'translations.json']) {
      assert.ok(fs.existsSync(path.join(stage, sib)), `sibling ${sib}`);
    }
    fs.rmSync(stage, { recursive: true, force: true });
  });

  it('fails loudly when a referenced blob has no bytes', () => {
    const stage = mkStage();
    const items = [{ urlPath: '/x', data: { '@type': 'Image', UID: 'u',
      image: { blob_path: 'x/image/missing.jpg' } } }];
    assert.throws(
      () => writeDistribution(stage, items, { blobSourceOf: () => '/no/such/file.jpg' }),
      /no bytes for image\.blob_path/,
    );
    fs.rmSync(stage, { recursive: true, force: true });
  });

  it('prefers a real sibling file over the default when given a source dir', () => {
    const stage = mkStage();
    const src = path.join(stage, 'src'); fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'redirects.json'), JSON.stringify({ '/old': '/new' }));
    const items = [{ urlPath: '/', data: { '@type': 'Plone Site', UID: 'plone_site_root' } }];
    writeDistribution(stage, items, { blobSourceOf: () => null, siblingsFrom: [src] });
    assert.deepEqual(readJson(path.join(stage, 'redirects.json')), { '/old': '/new' });
    fs.rmSync(stage, { recursive: true, force: true });
  });
});
