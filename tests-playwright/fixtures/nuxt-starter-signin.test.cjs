/**
 * The Nuxt starter's header link into the editor.
 *
 * A site whose admin has a demo account (Inka's /login?demo) offers "Try
 * editing now", which signs a visitor in as that account and opens the page
 * they are on in the editor. Without one, it offers the plain login. The site
 * says which with NUXT_DEMO_EDITING=true at build time.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const STARTER = path.resolve(__dirname, '../../examples/nuxt-blog-starter');

async function signInLink(...args) {
  const { signInLink } = await import(path.join(STARTER, 'utils/signInLink.mjs'));
  return signInLink(...args);
}

describe('nuxt starter sign-in link', () => {
  it('with a demo account, opens the page you are on in the editor', async () => {
    assert.deepEqual(await signInLink('https://admin.example.org', '/features', true), {
      href: 'https://admin.example.org/login?demo&return_url=%2Ffeatures%2Fedit',
      label: 'Try editing now',
    });
  });

  it('the front page opens as /edit', async () => {
    assert.equal(
      (await signInLink('https://admin.example.org', '/', true)).href,
      'https://admin.example.org/login?demo&return_url=%2Fedit',
    );
  });

  it('a trailing slash is not doubled', async () => {
    assert.equal(
      (await signInLink('https://admin.example.org', '/docs/', true)).href,
      'https://admin.example.org/login?demo&return_url=%2Fdocs%2Fedit',
    );
  });

  it('without a demo account, it is the plain login', async () => {
    assert.deepEqual(await signInLink('https://admin.example.org', '/features', false), {
      href: 'https://admin.example.org/login',
      label: 'Login',
    });
  });

  it('NUXT_DEMO_EDITING=true reaches the public runtime config', () => {
    const script = `
      globalThis.defineNuxtConfig = (c) => c;
      const { default: config } = await import(${JSON.stringify(path.join(STARTER, 'nuxt.config.ts'))});
      console.log(JSON.stringify(config.runtimeConfig.public.demoEditing));`;
    const run = (env) =>
      JSON.parse(
        execFileSync(process.execPath, ['--input-type=module', '-e', script], {
          cwd: STARTER,
          env: { ...process.env, ...env },
          encoding: 'utf-8',
        }).trim().split('\n').pop(),
      );
    assert.equal(run({ NUXT_DEMO_EDITING: 'true' }), true);
    assert.equal(run({ NUXT_DEMO_EDITING: '' }), false);
  });
});
