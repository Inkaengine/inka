/**
 * A Markdown export of an exportimport (JSON) tree carries its images and
 * files. The Markdown keeps an Image or File item in its folder's `blobs:`, so
 * the bytes have to be beside that folder's index.md, or the exported tree
 * names a file it doesn't have.
 *
 * A Markdown mount registers where each blob's bytes are as it loads; a JSON
 * mount's are at the item's `blob_path`, under the mount's directory. The
 * export only looked at the first, so converting a site's JSON content to
 * Markdown silently left every image behind.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-md-json-blobs-'));
const content = path.join(dist, 'content');
const item = (rel, data) => {
  fs.mkdirSync(path.join(content, rel), { recursive: true });
  fs.writeFileSync(path.join(content, rel, 'data.json'), JSON.stringify(data));
};
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5d8bd7f0000000049454e44ae426082', 'hex');

item('folder', { '@id': '/folder', '@type': 'Document', UID: 'folder-0001', id: 'folder', title: 'Folder', review_state: 'published' });
item('folder/logo.png', {
  '@id': '/folder/logo.png', '@type': 'Image', UID: 'logo-0001', id: 'logo.png', title: 'Logo', review_state: 'published',
  image: { filename: 'logo.png', 'content-type': 'image/png', blob_path: 'folder/logo.png/image/logo.png' },
});
fs.mkdirSync(path.join(content, 'folder/logo.png/image'), { recursive: true });
fs.writeFileSync(path.join(content, 'folder/logo.png/image/logo.png'), PNG);
fs.writeFileSync(path.join(content, '__metadata__.json'), JSON.stringify({
  _data_files_: ['folder/data.json', 'folder/logo.png/data.json'],
  _blob_files_: ['folder/logo.png/image/logo.png'],
  ordering: {},
}));
for (const sibling of ['discussions', 'portlets', 'principals', 'redirects']) {
  fs.writeFileSync(path.join(dist, `${sibling}.json`), sibling === 'principals' ? '{"members":[],"groups":[]}' : '{}');
}

process.env.CONTENT_MOUNTS = `/:${content}`;
const { app, ready } = await import('./mock-plone-api.js');

let server;
let baseUrl;
before(async () => {
  await ready;
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  fs.rmSync(dist, { recursive: true, force: true });
});

const exportMarkdown = async () => {
  const res = await fetch(`${baseUrl}/@export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'markdown' }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-md-json-blobs-out-'));
  fs.writeFileSync(path.join(dir, 'e.zip'), Buffer.from(await res.arrayBuffer()));
  execFileSync('unzip', ['-q', '-o', 'e.zip'], { cwd: dir });
  return dir;
};

describe('a Markdown export of a JSON tree', () => {
  it("puts an image's bytes beside the folder that lists it", async () => {
    const out = await exportMarkdown();
    try {
      const folder = fs.readFileSync(path.join(out, 'folder/index.md'), 'utf8');
      assert.match(folder, /\nblobs:\n {2}- file: logo\.png\n/);
      assert.deepEqual(fs.readFileSync(path.join(out, 'folder/logo.png')), PNG);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});
