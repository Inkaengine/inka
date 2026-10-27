/**
 * The Nuxt starter's EDIT build (`--envName edit`, the SPA the admin frames)
 * as a deploy configures it. inka.sh is this example: its builder sets
 * NUXT_TEST_BACKEND (the API) and NUXT_ADMIN_URL (the admin), and the edit
 * build must use both — the API in its CSP, or every content fetch is blocked
 * and the page renders a 500 ("Template … not found in pre-loaded templates"),
 * and the admin as the origin its bridge talks to, or it waits for a
 * localhost admin that is not there.
 *
 * The config is loaded as Node loads it (type-stripped), with Nuxt's
 * defineNuxtConfig stubbed to the identity.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const CONFIG = path.resolve(__dirname, '../../examples/nuxt-blog-starter/nuxt.config.ts');

function editBuild(env) {
  const script = `
    globalThis.defineNuxtConfig = (c) => c;
    const { default: config } = await import(${JSON.stringify(CONFIG)});
    const edit = config.$env.edit;
    console.log(JSON.stringify({
      csp: edit.routeRules['/**'].security.headers.contentSecurityPolicy,
      runtime: edit.runtimeConfig.public,
    }));`;
  const clean = { ...process.env };
  delete clean.NUXT_TEST_BACKEND;
  delete clean.NUXT_ADMIN_URL;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: path.dirname(CONFIG),
    env: { ...clean, ...env },
    encoding: 'utf-8',
  });
  return JSON.parse(out.trim().split('\n').pop());
}

describe('nuxt starter edit build', () => {
  const deployed = editBuild({
    NUXT_TEST_BACKEND: 'https://inkasite-api.fly.dev',
    NUXT_ADMIN_URL: 'https://admin.inka.sh',
  });

  it('talks to the admin the deploy names', () => {
    assert.equal(deployed.runtime.adminUrl, 'https://admin.inka.sh');
    assert.equal(deployed.runtime.backendBaseUrl, 'https://inkasite-api.fly.dev');
  });

  it("lets the page fetch from the deploy's API and admin", () => {
    for (const directive of ['connect-src', 'img-src']) {
      assert.ok(
        deployed.csp[directive].includes('https://inkasite-api.fly.dev'),
        `${directive} allows the API the build fetches from: ${deployed.csp[directive]}`,
      );
      assert.ok(deployed.csp[directive].includes('https://admin.inka.sh'), directive);
    }
  });

  it('a test build with no admin named still talks to the local admin', () => {
    const test = editBuild({ NUXT_TEST_BACKEND: 'http://localhost:8888', HYDRA_VOLTO_SSR_PORT: '3001' });
    assert.equal(test.runtime.adminUrl, 'http://localhost:3001');
    assert.ok(test.csp['connect-src'].includes('http://localhost:8888'));
  });
});
