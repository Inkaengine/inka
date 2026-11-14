/**
 * Content created in a session is found under a prefix mount too.
 *
 * A frontend's test fixtures are often mounted under a prefix beside the site
 * content (`/:site,/fixtures:fixtures`). The admin creates content at a bare
 * path (its templates at "/templates/x"), while the frontend asks for it under
 * the prefix ("/fixtures/templates/x"). The mock un-prefixes a missed path by
 * the mount it falls under, whatever that mount is called. `/_test_data` is the
 * prefix it used to be hard-coded to, and Inka's own fixtures still use it, so
 * it's checked alongside a prefix of another name.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const site = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-prefix-site-'));
const testData = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-prefix-test-data-'));
const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-prefix-fixtures-'));
process.env.CONTENT_MOUNTS = `/_test_data:${testData},/fixtures:${fixtures},/:${site}`;
const { app } = require('./mock-api-server.cjs');
const { mintToken } = require('./mock-tokens.cjs');

let server;
let baseUrl;
before(
  () =>
    new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    }),
);
after(() => server.close());

const request = (method, urlPath, token, body) =>
  fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
  });

describe('session content under a prefix mount', () => {
  const token = mintToken('admin');

  before(async () => {
    const res = await request('POST', '/', token, { '@type': 'Document', id: 'made-here', title: 'Made at the root' });
    assert.ok(res.ok, `creating the page failed: ${res.status}`);
  });

  it('is served at the bare path it was created at', async () => {
    const res = await request('GET', '/made-here', token);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).title, 'Made at the root');
  });

  for (const prefix of ['/_test_data', '/fixtures']) {
    it(`is served under the ${prefix} mount`, async () => {
      const res = await request('GET', `${prefix}/made-here`, token);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).title, 'Made at the root');
    });
  }

  it('is not found under a path that only starts with the prefix', async () => {
    const res = await request('GET', '/fixtures-other/made-here', token);
    assert.equal(res.status, 404);
  });

  it("is not found in another session", async () => {
    const res = await request('GET', '/fixtures/made-here', mintToken('admin'));
    assert.equal(res.status, 404);
  });
});
