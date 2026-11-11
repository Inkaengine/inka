// @history as plone.restapi keeps it for a page that has been saved: every
// saved state is a version, the newest being what the page holds now, and
// PATCH @history {version} puts the page back to one of them (the History
// view's "Revert to this revision"). Nothing is lost by reverting: the state
// reverted from stays in the history.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./mock-api-server.cjs');
const { mintToken } = require('./mock-tokens.cjs');

let server;
let baseUrl;

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

async function call(method, path, token, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

const versionsOf = async (path, token) => (await call('GET', `${path}/@history`, token)).body
  .filter((entry) => entry.type === 'versioning')
  .map((entry) => entry.version)
  .sort((a, b) => a - b);

describe('@history revert', () => {
  it('lists what the page holds now as its newest version', async () => {
    const token = mintToken('admin');
    await call('POST', '/_test_data', token, { '@type': 'Document', id: 'hr-listed', title: 'One' });
    await call('PATCH', '/_test_data/hr-listed', token, { title: 'Two' });
    assert.deepEqual(await versionsOf('/_test_data/hr-listed', token), [0, 1]);
    assert.equal((await call('GET', '/_test_data/hr-listed/@history/1', token)).body.title, 'Two');
    assert.equal((await call('GET', '/_test_data/hr-listed/@history/0', token)).body.title, 'One');
  });

  it('puts the page back to a version, keeping the one it left in the history', async () => {
    const token = mintToken('admin');
    await call('POST', '/_test_data', token, { '@type': 'Document', id: 'hr-revert', title: 'One' });
    await call('PATCH', '/_test_data/hr-revert', token, { title: 'Two' });
    await call('PATCH', '/_test_data/hr-revert', token, { title: 'Three' });
    const before = (await call('GET', '/_test_data/hr-revert', token)).body.modified;

    const reverted = await call('PATCH', '/_test_data/hr-revert/@history', token, { version: 0 });
    assert.equal(reverted.status, 200);
    assert.match(reverted.body.message, /reverted to revision 0/);

    const now = (await call('GET', '/_test_data/hr-revert', token)).body;
    assert.equal(now.title, 'One');
    assert.notEqual(now.modified, before, 'a revert is a change: the page has a new modification date');
    const versions = await versionsOf('/_test_data/hr-revert', token);
    assert.equal(versions.length, 4);
    assert.equal((await call('GET', `/_test_data/hr-revert/@history/${versions[2]}`, token)).body.title, 'Three');
  });

  it('refuses a version the page does not have', async () => {
    const token = mintToken('admin');
    await call('POST', '/_test_data', token, { '@type': 'Document', id: 'hr-missing', title: 'One' });
    await call('PATCH', '/_test_data/hr-missing', token, { title: 'Two' });
    assert.equal((await call('PATCH', '/_test_data/hr-missing/@history', token, { version: 7 })).status, 404);
    assert.equal((await call('GET', '/_test_data/hr-missing', token)).body.title, 'Two');
  });
});
