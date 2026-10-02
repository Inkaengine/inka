/**
 * The mock's formsupport captcha, as collective.volto.formsupport has it.
 *
 * - `@vocabularies/collective.volto.formsupport.captcha.providers` lists the
 *   providers a site has CONFIGURED (captcha/vocabularies.py keeps only those
 *   whose `isEnabled()` is true). Honeypot needs no keys; reCAPTCHA and
 *   hCaptcha need theirs and NoRobots its questions, which a default site
 *   does not have — so a default site offers honeypot alone.
 * - `@submit-form` checks a token-based provider the way its `verify()` does
 *   before calling out: no `captcha.token` is "No captcha token provided."
 *   (400), and NoRobots' token must be the JSON `{id, id_check, value}` its
 *   widget builds. The third-party check itself (Google, hCaptcha) is not
 *   reproduced: a token is accepted once it is there.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROVIDERS = ['recaptcha', 'hcaptcha', 'hcaptcha_invisible', 'norobots-captcha'];
// A site that has configured the token providers too (keys, questions); the
// mock reads which from MOCK_CAPTCHA_PROVIDERS, honeypot being always on.
process.env.MOCK_CAPTCHA_PROVIDERS = PROVIDERS.join(',');

// One page per provider, mounted before the mock loads (it reads
// CONTENT_MOUNTS at require time).
const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-captcha-'));
// `none` was a VALUE once: it names no adapter, and formsupport fails every
// submission of a form set to it. `turnstile` is a provider no extra installs.
for (const provider of [...PROVIDERS, 'honeypot', 'none', 'turnstile']) {
  fs.mkdirSync(path.join(mount, provider));
  fs.writeFileSync(
    path.join(mount, provider, 'data.json'),
    JSON.stringify({
      '@id': `/${provider}`,
      '@type': 'Document',
      UID: `captcha-${provider}`,
      id: provider,
      title: provider,
      blocks: {
        f: {
          '@type': 'form',
          store: true,
          captcha: provider,
          subblocks: [{ field_id: 'q', field_type: 'text', label: 'Q' }],
        },
      },
      blocks_layout: { items: ['f'] },
    }),
  );
}
process.env.CONTENT_MOUNTS = `/:${mount}`;
process.env.SKIP_CONTENT_VALIDATION = 'true';
const { app } = require('./mock-api-server.cjs');

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

const submit = (provider, captcha) =>
  fetch(`${baseUrl}/${provider}/@submit-form`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      block_id: 'f',
      data: [{ field_id: 'q', label: 'Q', value: 'an answer' }],
      ...(captcha ? { captcha } : {}),
    }),
  });

describe('formsupport captcha', () => {
  it('offers the providers this site has configured, honeypot always', async () => {
    const res = await fetch(`${baseUrl}/@vocabularies/collective.volto.formsupport.captcha.providers`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.items.map((i) => i.token), ['honeypot', ...PROVIDERS]);
  });

  for (const provider of ['none', 'turnstile']) {
    it(`a form set to "${provider}" cannot be submitted: no such provider here`, async () => {
      // formsupport's getMultiAdapter(name=block.captcha) raises — a 500.
      const res = await submit(provider, { provider, token: 'x', value: '' });
      assert.equal(res.status, 500);
      assert.match((await res.json()).message, new RegExp(provider));
    });
  }

  it('honeypot: the empty trap passes, as volto-form-block sends it', async () => {
    const res = await submit('honeypot', { provider: 'honeypot', token: '', value: '' });
    assert.ok(res.ok, `${res.status} ${await res.text()}`);
  });

  it('honeypot: a filled trap is refused', async () => {
    const res = await submit('honeypot', { provider: 'honeypot', token: '', value: 'spam' });
    assert.equal(res.status, 400);
  });

  it('honeypot: a captcha with no value is refused', async () => {
    // HoneypotSupport.verify: `"value" not in data` is a BadRequest.
    const res = await submit('honeypot', { provider: 'honeypot', token: '' });
    assert.equal(res.status, 400);
  });

  it('honeypot: with no captcha, the trap must be among the answers, empty', async () => {
    // found_honeypot(form, required=True) over the answers by label: the
    // field missing is "misses required field" (HONEYPOT_FIELD defaults to
    // protected_1), filled is "has forbidden field".
    assert.equal((await submit('honeypot')).status, 400);
    const withTrap = (value) =>
      fetch(`${baseUrl}/honeypot/@submit-form`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          block_id: 'f',
          data: [
            { field_id: 'q', label: 'Q', value: 'an answer' },
            { field_id: 'protected_1', label: 'protected_1', value },
          ],
        }),
      });
    assert.ok((await withTrap('')).ok);
    assert.equal((await withTrap('spam')).status, 400);
  });

  for (const provider of PROVIDERS) {
    it(`${provider}: a submission with an empty token is refused`, async () => {
      const res = await submit(provider, { provider, token: '' });
      assert.equal(res.status, 400);
      assert.match((await res.json()).message, /No captcha token provided/);
    });
    it(`${provider}: and with no captcha at all`, async () => {
      assert.equal((await submit(provider)).status, 400);
    });
  }

  for (const provider of ['recaptcha', 'hcaptcha', 'hcaptcha_invisible']) {
    it(`${provider}: a token is accepted`, async () => {
      const res = await submit(provider, { provider, token: 'a-token' });
      assert.ok(res.ok, `${res.status} ${await res.text()}`);
    });
  }

  it('norobots: the token is the JSON its widget builds', async () => {
    const bad = await submit('norobots-captcha', { provider: 'norobots-captcha', token: 'not json' });
    assert.equal(bad.status, 400);
    const good = await submit('norobots-captcha', {
      provider: 'norobots-captcha',
      token: JSON.stringify({ id: 'question0', id_check: 'abc', value: 'ten' }),
    });
    assert.ok(good.ok, `${good.status} ${await good.text()}`);
  });
});
