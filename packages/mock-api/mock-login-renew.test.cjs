// @login-renew as Plone's: a fresh token for the user the old one is for,
// and a refusal without one. The mock renewed every token as `admin`, so an
// admin that renews its token on load (as Volto does) quietly became admin,
// whoever had signed in.
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

const tokenFor = mintToken;
const subjectOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;

const renew = (headers) => fetch(`${baseUrl}/@login-renew`, { method: 'POST', headers: { Accept: 'application/json', ...headers } });

describe('@login-renew', () => {
  it('renews a token for the user it is for', async () => {
    const res = await renew({ Authorization: `Bearer ${tokenFor('jane')}` });
    assert.equal(res.status, 200);
    const { token, user } = await res.json();
    assert.equal(subjectOf(token), 'jane');
    assert.equal(user.id, 'jane');
  });

  it('refuses without a token', async () => {
    assert.equal((await renew({})).status, 401);
  });
});
