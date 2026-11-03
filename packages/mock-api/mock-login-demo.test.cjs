// The demo editor's sign-in, as plone.demoeditor offers it: GET @login lists
// it among the site's login options, and POST @login-demo signs in as `demo`
// with no password.
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

const subjectOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;

describe('the demo sign-in', () => {
  it('is one of the login options', async () => {
    const res = await fetch(`${baseUrl}/@login`, { headers: { Accept: 'application/json' } });
    assert.equal(res.status, 200);
    const { options } = await res.json();
    const demo = options.find((o) => o.id === 'demo');
    assert.deepEqual(demo, { id: 'demo', plugin: 'demo', title: 'Try it as a demo editor', url: `${baseUrl}/@login-demo` });
  });

  it('signs in as demo with no password', async () => {
    const res = await fetch(`${baseUrl}/@login-demo`, { method: 'POST', headers: { Accept: 'application/json' } });
    assert.equal(res.status, 200);
    assert.equal(subjectOf((await res.json()).token), 'demo');
  });
});
