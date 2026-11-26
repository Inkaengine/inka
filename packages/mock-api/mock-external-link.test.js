/**
 * A block's link to another site is served as stored.
 *
 * The mock resolves a bare object-browser link (`[{ '@id': … }]`) into a
 * summary of the page it names. An absolute URL was cut down to its path
 * whatever its host, so a link to https://example.com became `/`, served as
 * the site root: the editor showed the image linking home, and saving the
 * page would have stored that. Only a URL on this site names one of its pages.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const PAGE_UID = 'b1000000000000000000000000000001';
const TARGET_UID = 'b1000000000000000000000000000002';

function item(content, dir, data) {
  fs.mkdirSync(path.join(content, dir), { recursive: true });
  fs.writeFileSync(path.join(content, dir, 'data.json'), JSON.stringify(data));
}

function layout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-external-link-'));
  const content = path.join(root, 'content');
  item(content, PAGE_UID, {
    '@id': '/page', '@type': 'Document', UID: PAGE_UID, id: 'page', title: 'A page',
    blocks: {
      away: { '@type': 'image', url: 'https://example.com/x.png', href: [{ '@id': 'https://example.com' }] },
      awayDeep: { '@type': 'image', url: 'https://example.com/x.png', href: [{ '@id': 'https://example.com/target' }] },
      here: { '@type': 'image', url: 'https://example.com/x.png', href: [{ '@id': '/target' }] },
    },
    blocks_layout: { items: ['away', 'awayDeep', 'here'] },
  });
  item(content, TARGET_UID, {
    '@id': '/target', '@type': 'Document', UID: TARGET_UID, id: 'target', title: 'The target',
  });
  fs.writeFileSync(path.join(content, '__metadata__.json'), JSON.stringify({
    _data_files_: [`${PAGE_UID}/data.json`, `${TARGET_UID}/data.json`],
    _blob_files_: [],
  }));
  for (const [name, empty] of [
    ['discussions.json', {}], ['portlets.json', []], ['principals.json', { groups: [], users: [] }],
    ['redirects.json', {}], ['translations.json', []], ['relations.json', []],
  ]) {
    fs.writeFileSync(path.join(root, name), JSON.stringify(empty));
  }
  return content;
}

process.env.CONTENT_MOUNTS = `/:${layout()}`;
const { app } = await import('./mock-api-server.js');

let server;
let baseUrl;
const getPage = async () => {
  const res = await fetch(`${baseUrl}/page`, { headers: { Accept: 'application/json' } });
  assert.equal(res.status, 200);
  return res.json();
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

describe("a block's link to another site", () => {
  it('is served as stored, not as this site\'s page at the same path', async () => {
    const { blocks } = await getPage();
    assert.deepEqual(blocks.away.href, [{ '@id': 'https://example.com' }]);
    assert.deepEqual(blocks.awayDeep.href, [{ '@id': 'https://example.com/target' }]);
  });

  it("while a link to this site's page is resolved to it", async () => {
    const { blocks } = await getPage();
    assert.equal(blocks.here.href[0].title, 'The target');
  });
});
