/**
 * A page's preview image is a relation, served from relations.json.
 *
 * plone.volto gives Document `preview_image_link`: a relation to an Image item,
 * the picture listings and teasers show for the page. plone.exportimport keeps
 * a relation out of the page's data.json, in relations.json beside the content
 * dir, and restores it after the content is in. The mock read only data.json,
 * so a linked preview image was never there: the page had no preview image, and
 * a listing or search result for it had no picture, where Plone shows one.
 *
 * Plone's catalog then describes the result's image by the relation:
 * plone.volto's image_field indexer prefers `preview_image_link`, and its scales
 * are the linked image's own, each stamped with `base_path` (the linked image's
 * path) because their downloads are relative to it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const PAGE_UID = 'a1000000000000000000000000000001';
const BARE_UID = 'a1000000000000000000000000000002';
const IMAGE_UID = 'a1000000000000000000000000000003';

function item(content, dir, data) {
  fs.mkdirSync(path.join(content, dir), { recursive: true });
  fs.writeFileSync(path.join(content, dir, 'data.json'), JSON.stringify(data));
}

function layout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-preview-link-'));
  const content = path.join(root, 'content');
  item(content, PAGE_UID, {
    '@id': '/page', '@type': 'Document', UID: PAGE_UID, id: 'page', title: 'A page',
  });
  item(content, BARE_UID, {
    '@id': '/bare', '@type': 'Document', UID: BARE_UID, id: 'bare', title: 'A page with no picture',
  });
  item(content, IMAGE_UID, {
    '@id': '/pic.jpg', '@type': 'Image', UID: IMAGE_UID, id: 'pic.jpg', title: 'Picture',
    image: {
      blob_path: `${IMAGE_UID}/image/pic.jpg`, 'content-type': 'image/jpeg',
      filename: 'pic.jpg', width: 400, height: 200, size: 3,
    },
  });
  fs.mkdirSync(path.join(content, IMAGE_UID, 'image'));
  fs.writeFileSync(path.join(content, IMAGE_UID, 'image', 'pic.jpg'), 'jpg');
  fs.writeFileSync(path.join(content, '__metadata__.json'), JSON.stringify({
    _data_files_: [`${PAGE_UID}/data.json`, `${BARE_UID}/data.json`, `${IMAGE_UID}/data.json`],
    _blob_files_: [`${IMAGE_UID}/image/pic.jpg`],
  }));
  // plone.exportimport's other siblings, empty: the mock checks they are there.
  for (const [name, empty] of [
    ['discussions.json', {}], ['portlets.json', []], ['principals.json', { groups: [], users: [] }],
    ['redirects.json', {}], ['translations.json', []],
  ]) {
    fs.writeFileSync(path.join(root, name), JSON.stringify(empty));
  }
  fs.writeFileSync(path.join(root, 'relations.json'), JSON.stringify([
    { from_attribute: 'preview_image_link', from_uuid: PAGE_UID, to_uuid: IMAGE_UID },
  ]));
  return content;
}

process.env.CONTENT_MOUNTS = `/:${layout()}`;
const { app } = await import('./mock-api-server.js');

let server;
let baseUrl;
const get = async (p) => {
  const res = await fetch(`${baseUrl}${p}`, { headers: { Accept: 'application/json' } });
  assert.equal(res.status, 200, p);
  return res.json();
};
const result = async (id) => {
  const body = await get('/@search?portal_type=Document&metadata_fields=hasPreviewImage');
  const found = body.items.find((i) => new URL(i['@id']).pathname === `/${id}`);
  assert.ok(found, `${id} in ${JSON.stringify(body.items.map((i) => i['@id']))}`);
  return found;
};

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("a page's preview image from relations.json", () => {
  it('is on the page, as a summary of the linked image', async () => {
    const page = await get('/page');
    assert.equal(new URL(page.preview_image_link['@id']).pathname, '/pic.jpg');
    assert.equal(page.preview_image_link['@type'], 'Image');
    assert.ok(page.preview_image_link.image_scales.image[0].download);
  });

  it("is the result's image, by the relation", async () => {
    const found = await result('page');
    assert.equal(found.image_field, 'preview_image_link');
    const [scale] = found.image_scales.preview_image_link;
    // The linked image's own scales, resolved against the linked image.
    assert.equal(scale.base_path, '/pic.jpg');
    assert.equal(scale.download, '@@images/image');
    assert.equal(scale.width, 400);
    assert.equal(found.hasPreviewImage, true);
  });

  it('leaves a page it does not name without an image', async () => {
    const found = await result('bare');
    assert.equal(found.image_field, '');
    assert.equal(found.image_scales, null);
  });
});
