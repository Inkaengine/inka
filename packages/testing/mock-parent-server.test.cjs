/**
 * `inka-mock-parent` serves mock-parent.html and the admin code it runs, on the
 * port it's told — and refuses to guess one.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createServer } = require('node:net');
const path = require('node:path');

const SERVER = path.join(__dirname, 'mock-parent', 'server.js');

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

describe('inka-mock-parent', () => {
  let child;
  let base;
  let stderr = '';

  before(async () => {
    const port = await freePort();
    base = `http://localhost:${port}`;
    child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, PORT: String(port), API_URL: 'http://localhost:9', FRONTEND_URL: 'http://localhost:10' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/mock-parent.html`)).ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`inka-mock-parent never served the page. stderr:\n${stderr}`);
  });
  after(() => child?.kill());

  it('serves the page, told which API and frontend it works with', async () => {
    const html = await (await fetch(`${base}/mock-parent.html`)).text();
    assert.match(html, /window\._apiOrigin = "http:\/\/localhost:9"/);
    assert.match(html, /window\._frontendOrigin = "http:\/\/localhost:10"/);
  });

  it('serves the admin code the page imports', async () => {
    for (const mod of ['helpers', 'build-block-path-map', 'merge-templates', 'merge-frontend-block', 'block-path', 'block-sync']) {
      const res = await fetch(`${base}/inka-mock-parent/${mod}.js`);
      assert.equal(res.status, 200, `${mod}.js`);
    }
  });
});

describe('inka-mock-parent without a PORT', () => {
  it('refuses to start', () => {
    const env = { ...process.env };
    delete env.PORT;
    const run = spawnSync(process.execPath, [SERVER], { env, encoding: 'utf8', timeout: 20000 });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /PORT is required/);
  });
});
