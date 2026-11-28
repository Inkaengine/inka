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

const link = (uid, url) => ({
  [uid]: { '@type': 'slate', value: [{ type: 'p', children: [{ type: 'link', data: { url }, children: [{ text: 'a link' }] }] }] },
});
const withBlocks = (blocks) => ({ blocks, blocks_layout: { items: Object.keys(blocks) } });

// Not folderish, but it holds an image, so it is written as a folder.
item('folder', {
  '@id': '/folder', '@type': 'Document', UID: 'folder-0001', id: 'folder', title: 'Folder', review_state: 'published',
  ...withBlocks(link('to-other', '/other')),
});
item('other', {
  '@id': '/other', '@type': 'Document', UID: 'other-0001', id: 'other', title: 'Other', review_state: 'published',
  ...withBlocks(link('to-folder', '/folder')),
});
item('folder/logo.png', {
  '@id': '/folder/logo.png', '@type': 'Image', UID: 'logo-0001', id: 'logo.png', title: 'Logo', review_state: 'published',
  image: { filename: 'logo.png', 'content-type': 'image/png', blob_path: 'folder/logo.png/image/logo.png' },
});
// Two videos in one folder, each uploaded as `adding.mp4`: Plone names the
// items apart (their ids), but not their files.
const MP4 = { a: Buffer.from('first video'), b: Buffer.from('second video') };
for (const [key, name] of [['a', 'accordion-adding.mp4'], ['b', 'tabs-adding.mp4']]) {
  item(`folder/${name}`, {
    '@id': `/folder/${name}`, '@type': 'File', UID: `video-${key}-0001`, id: name, title: name, review_state: 'published',
    file: { filename: 'adding.mp4', 'content-type': 'video/mp4', blob_path: `folder/${name}/file/adding.mp4` },
  });
  fs.mkdirSync(path.join(content, `folder/${name}/file`), { recursive: true });
  fs.writeFileSync(path.join(content, `folder/${name}/file/adding.mp4`), MP4[key]);
}
fs.mkdirSync(path.join(content, 'folder/logo.png/image'), { recursive: true });
fs.writeFileSync(path.join(content, 'folder/logo.png/image/logo.png'), PNG);
fs.writeFileSync(path.join(content, '__metadata__.json'), JSON.stringify({
  _data_files_: ['folder/data.json', 'folder/logo.png/data.json', 'other/data.json',
    'folder/accordion-adding.mp4/data.json', 'folder/tabs-adding.mp4/data.json'],
  _blob_files_: ['folder/logo.png/image/logo.png',
    'folder/accordion-adding.mp4/file/adding.mp4', 'folder/tabs-adding.mp4/file/adding.mp4'],
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
      assert.match(folder, /\n {2}- file: logo\.png\n/);
      assert.deepEqual(fs.readFileSync(path.join(out, 'folder/logo.png')), PNG);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  // A page written as a folder is one for its links too: its own links are
  // relative to its folder, and links to it point at its index.md. A page not
  // folderish but holding an image was written as a folder and linked to as a
  // file, so the docs' Section page linked to ./card/index.md under itself.
  it('links from and to a page written as a folder because it holds an image', async () => {
    const out = await exportMarkdown();
    try {
      assert.match(fs.readFileSync(path.join(out, 'folder/index.md'), 'utf8'), /"url":"\.\.\/other\.md"/);
      assert.match(fs.readFileSync(path.join(out, 'other.md'), 'utf8'), /"url":"\.\/folder\/index\.md"/);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  // A folder's files sit beside its index.md under their own names, unless two
  // share one: then each goes in a folder of its item's id, so neither
  // overwrites the other, and each keeps its name.
  it('keeps two files of the same name in one folder apart', async () => {
    const out = await exportMarkdown();
    try {
      const folder = fs.readFileSync(path.join(out, 'folder/index.md'), 'utf8');
      assert.match(folder, /\n {2}- file: accordion-adding\/adding\.mp4\n {4}uid: video-a-0001\n/);
      assert.match(folder, /\n {2}- file: tabs-adding\/adding\.mp4\n {4}uid: video-b-0001\n/);
      assert.deepEqual(fs.readFileSync(path.join(out, 'folder/accordion-adding/adding.mp4')), MP4.a);
      assert.deepEqual(fs.readFileSync(path.join(out, 'folder/tabs-adding/adding.mp4')), MP4.b);
      assert.ok(!fs.existsSync(path.join(out, 'folder/adding.mp4')), 'neither lands on the shared name');
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});
