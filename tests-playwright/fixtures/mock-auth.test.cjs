// Signing in, as Plone's: a token the site did not issue, or no longer
// accepts, makes the request anonymous — it is not refused — so what the public
// may read still answers and only what needs a user says 401. The mock took
// any "Bearer …" as signed in, and so hid two bugs that a deploy found: the
// admin's agent sign-in handed on a token the site had stopped accepting, and
// the MCP's editor then waited a minute on a 401 it never reported.
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

const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** A token shaped like the site's, that the site never signed. */
const forged = (user) => `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: user, exp: 4102444800 })}.not-the-site-signature`;

const get = (path, token) => fetch(`${baseUrl}${path}`, {
  headers: { Accept: 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
});
const post = (path, token, body) => fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
  body: body && JSON.stringify(body),
});

async function signIn() {
  const res = await post('/@login', null, { login: 'admin', password: 'admin' });
  assert.equal(res.status, 200);
  return (await res.json()).token;
}

const EDITOR_ROOT = '/?expand=breadcrumbs,actions,types,navroot,navigation&expand.navigation.depth=1';

describe('signing in, as Plone', () => {
  it('lists the addable types only to a signed-in user', async () => {
    assert.equal((await get('/@types')).status, 401);
    assert.equal((await get('/@types', await signIn())).status, 200);
  });

  it("refuses the editor's first read (it expands types) to anyone not signed in", async () => {
    assert.equal((await get(EDITOR_ROOT)).status, 401);
    assert.equal((await get(EDITOR_ROOT, await signIn())).status, 200);
  });

  it('looks a page up before the expansion: no page is 404, signed in or not', async () => {
    // As Plone answered the admin's read of /connect-agent (a route, not a
    // page) with a token it no longer accepted.
    assert.equal((await get('/no-such-page?expand=breadcrumbs,types')).status, 404);
  });

  it('reads a token it did not sign as anonymous: public reads answer, the rest is 401', async () => {
    const token = forged('admin');
    assert.equal((await get('/', token)).status, 200);
    assert.equal((await get('/@types', token)).status, 401);
    assert.equal((await get(EDITOR_ROOT, token)).status, 401);
  });

  it('does not renew a token it did not sign', async () => {
    assert.equal((await post('/@login-renew', forged('admin'))).status, 401);
  });

  it('accepts a token a test mints, as one it issued', async () => {
    assert.equal((await get('/@types', mintToken('admin'))).status, 200);
  });

  it('stops accepting a revoked token, as a reset site stops accepting the ones it issued', async () => {
    const token = await signIn();
    assert.equal((await post('/@mock-revoke-token', token)).status, 204);
    assert.equal((await get('/', token)).status, 200);
    assert.equal((await get('/@types', token)).status, 401);
    assert.equal((await post('/@login-renew', token)).status, 401);
    // Signing in again is accepted.
    assert.equal((await get('/@types', await signIn())).status, 200);
  });
});
