/**
 * A mount's root answers, whether or not its directory has a data.json.
 *
 * A frontend's test fixtures are mounted under a prefix (/_test_data) from a
 * directory of pages with no data.json of its own. Breadcrumbs name every
 * ancestor, the mount root included, and @search already lists that root as a
 * folder; but GET at it was a 404, so every fixture page carried a dead link to
 * it — which page integrity checks report. Real Plone never names an ancestor
 * that isn't there.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function tree(withPage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-mount-root-'));
  if (withPage) {
    fs.mkdirSync(path.join(dir, 'page'));
    fs.writeFileSync(
      path.join(dir, 'page', 'data.json'),
      JSON.stringify({ '@type': 'Document', UID: 'mountroot-page-0001', id: 'page', title: 'A page' }),
    );
  }
  return dir;
}

process.env.CONTENT_MOUNTS = `/:${tree(false)},/_test_data:${tree(true)}`;
const { app } = require('./mock-api-server.cjs');

let server;
let baseUrl;
const get = (p) => fetch(`${baseUrl}${p}`, { headers: { Accept: 'application/json' } });

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

describe('a mount root with no data.json of its own', () => {
  it('answers as a folder', async () => {
    const res = await get('/_test_data');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body['@type'], 'Folder');
    assert.equal(body.id, '_test_data');
  });

  it('is an ancestor in the breadcrumbs that answers', async () => {
    const res = await get('/_test_data/page/@breadcrumbs');
    assert.equal(res.status, 200);
    const { items } = await res.json();
    const ancestors = items.map((item) => new URL(item['@id']).pathname);
    assert.ok(ancestors.includes('/_test_data'), `breadcrumbs: ${ancestors.join(', ')}`);
    for (const ancestor of ancestors) {
      assert.equal((await get(ancestor)).status, 200, `${ancestor} is named in the breadcrumbs`);
    }
  });
});
