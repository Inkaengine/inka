// @lock as Plone keeps it: one lock per page, seen by every user, naming
// who holds it. An editor that opens a page locks it, and until it lets go
// another user's save is refused ("Resource is locked."), and their lock or
// unlock leaves the holder's lock as it is (unless they force the unlock).
// The user is the token's `sub`.
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

/** A token for `user`, shaped as the mock's tests make them (a unique tail keeps sessions apart). */
function tokenFor(user) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: user, exp: 4102444800 })}.fake-signature-${user}-${Math.random()}`;
}

async function call(method, path, token, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

const lockOf = async (token) => (await call('GET', PAGE, token)).body.lock;

describe('@lock', () => {
  it('locks a page, for its holder, until it is unlocked', async () => {
    const admin = tokenFor('admin');
    assert.equal((await lockOf(admin)).locked, false);

    const locked = await call('POST', `${PAGE}/@lock`, admin);
    assert.equal(locked.body.locked, true);
    // plone.restapi's lock_info: `time` in epoch seconds, `created` the same as ISO.
    assert.equal(locked.body.creator, 'admin');
    assert.equal(locked.body.creator_name, 'admin');
    assert.equal(typeof locked.body.time, 'number');
    assert.equal(Date.parse(locked.body.created), Math.floor(locked.body.time) * 1000);
    assert.equal(typeof locked.body.token, 'string');
    assert.equal((await lockOf(admin)).locked, true);

    assert.equal((await call('DELETE', `${PAGE}/@lock`, admin)).body.locked, false);
    assert.equal((await lockOf(admin)).locked, false);
  });

  it('shows another user the lock, and who holds it', async () => {
    const holder = tokenFor('holder');
    const other = tokenFor('other');
    await call('POST', `${PAGE}/@lock`, holder);
    try {
      const seen = await lockOf(other);
      assert.equal(seen.locked, true);
      assert.equal(seen.creator, 'holder');
    } finally {
      await call('DELETE', `${PAGE}/@lock`, holder);
    }
  });

  it("refuses another user's save while the page is locked; the holder's goes through", async () => {
    const holder = tokenFor('holder');
    const other = tokenFor('other');
    await call('POST', `${PAGE}/@lock`, holder);
    try {
      const refused = await call('PATCH', PAGE, other, { title: 'Not while locked' });
      assert.equal(refused.status, 403);
      assert.deepEqual(refused.body.error, { type: 'Forbidden', message: 'Resource is locked.' });
      assert.equal((await call('PATCH', PAGE, holder, { title: 'By the holder' })).status < 300, true);
    } finally {
      await call('DELETE', `${PAGE}/@lock`, holder);
    }
  });

  it("leaves the holder's lock when another user locks or unlocks, unless they force it", async () => {
    const holder = tokenFor('holder');
    const other = tokenFor('other');
    await call('POST', `${PAGE}/@lock`, holder);
    try {
      assert.equal((await call('POST', `${PAGE}/@lock`, other)).body.creator, 'holder');
      await call('DELETE', `${PAGE}/@lock`, other);
      assert.equal((await lockOf(other)).creator, 'holder');
      await call('DELETE', `${PAGE}/@lock`, other, { force: true });
      assert.equal((await lockOf(other)).locked, false);
    } finally {
      await call('DELETE', `${PAGE}/@lock`, holder);
    }
  });

  it('lets a lock lapse after its timeout, as Plone does', async () => {
    const holder = tokenFor('holder');
    const other = tokenFor('other');
    await call('POST', `${PAGE}/@lock`, holder, { timeout: 1 });
    assert.equal((await lockOf(other)).locked, true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal((await lockOf(other)).locked, false);
    assert.equal((await call('PATCH', PAGE, other, { title: 'After it lapsed' })).status < 300, true);
  });

  it('works on the ++api++ path the admin uses', async () => {
    const admin = tokenFor('admin');
    await call('POST', `/++api++${PAGE}/@lock`, admin);
    assert.equal((await call('GET', `/++api++${PAGE}`, admin)).body.lock.locked, true);
    await call('DELETE', `/++api++${PAGE}/@lock`, admin);
    assert.equal((await call('GET', `/++api++${PAGE}`, admin)).body.lock.locked, false);
  });
});
