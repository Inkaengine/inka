/**
 * The demo account a "try editing" link signs in with.
 *
 * A public demo site can link straight into editing: /login?demo&return_url=…
 * signs in with an account the site configures, so a visitor never sees the
 * login form. It is set with RAZZLE_DEMO_LOGIN and RAZZLE_DEMO_PASSWORD, read
 * at runtime (Volto's runtimeConfig), so the deployed editor needs no rebuild.
 * Both are visible to the browser: the account must be one whose saves are
 * thrown away by the CMS.
 */
import { describe, test, expect } from 'vitest';
import { demoAccount } from './demoAccount';

describe('demoAccount', () => {
  test('is the configured login and password', () => {
    expect(demoAccount({ RAZZLE_DEMO_LOGIN: 'demo', RAZZLE_DEMO_PASSWORD: 'secret' })).toEqual({
      login: 'demo',
      password: 'secret',
    });
  });

  test('is null when the site configures none', () => {
    expect(demoAccount({})).toBeNull();
  });

  test('a login without a password is a configuration error, said so', () => {
    expect(() => demoAccount({ RAZZLE_DEMO_LOGIN: 'demo' })).toThrow(/RAZZLE_DEMO_PASSWORD/);
    expect(() => demoAccount({ RAZZLE_DEMO_PASSWORD: 'secret' })).toThrow(/RAZZLE_DEMO_LOGIN/);
  });
});
