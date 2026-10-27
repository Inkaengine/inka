// @lock keeps state, as Plone's does: an editor that opens a page locks it,
// the page's `lock` says so until the editor leaves, and a lock left behind
// stays visible. Without it every page always read as unlocked, so nothing
// could tell whether an editor ever let go.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./mock-api-server.cjs');

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

const PAGE = '/_test_data/test-page';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsImV4cCI6NDEwMjQ0NDgwMH0.fake-signature';

async function call(method, path, token) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200, `${method} ${path}`);
  return res.json();
}

describe('@lock', () => {
  it('locks a page until it is unlocked', async () => {
    const token = `${TOKEN}-lock-${Date.now()}`;
    assert.equal((await call('GET', PAGE, token)).lock.locked, false);

    const locked = await call('POST', `${PAGE}/@lock`, token);
    assert.equal(locked.locked, true);
    assert.equal((await call('GET', PAGE, token)).lock.locked, true);

    assert.equal((await call('DELETE', `${PAGE}/@lock`, token)).locked, false);
    assert.equal((await call('GET', PAGE, token)).lock.locked, false);
  });

  it('keeps one session’s lock to that session', async () => {
    const mine = `${TOKEN}-lock-mine-${Date.now()}`;
    const theirs = `${TOKEN}-lock-theirs-${Date.now()}`;
    await call('POST', `${PAGE}/@lock`, mine);
    assert.equal((await call('GET', PAGE, theirs)).lock.locked, false);
    await call('DELETE', `${PAGE}/@lock`, mine);
  });

  it('works on the ++api++ path the admin uses', async () => {
    const token = `${TOKEN}-lock-api-${Date.now()}`;
    await call('POST', `/++api++${PAGE}/@lock`, token);
    assert.equal((await call('GET', `/++api++${PAGE}`, token)).lock.locked, true);
    await call('DELETE', `/++api++${PAGE}/@lock`, token);
    assert.equal((await call('GET', `/++api++${PAGE}`, token)).lock.locked, false);
  });
});
