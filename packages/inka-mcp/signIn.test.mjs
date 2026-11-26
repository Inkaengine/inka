import { describe, it, expect } from 'vitest';
import { renewDelay, watchSignOut, SignedOut } from './signIn.mjs';

const jwt = (exp) => `h.${Buffer.from(JSON.stringify({ sub: 'jane', exp })).toString('base64url')}.s`;

describe('renewDelay', () => {
  it('renews a token halfway through the time it has left', () => {
    const now = 1_000_000_000_000;
    expect(renewDelay(jwt(now / 1000 + 12 * 3600), now)).toBe(6 * 3600 * 1000);
  });

  it('renews one that has already expired straight away', () => {
    const now = 1_000_000_000_000;
    expect(renewDelay(jwt(now / 1000 - 60), now)).toBe(0);
  });
});

describe('watchSignOut', () => {
  it('tells whoever holds the sign-in when a call finds it refused, and still fails the call', async () => {
    const told = [];
    const view = watchSignOut({
      withEditor: async () => { throw new SignedOut('the site no longer accepts it: sign in again'); },
      withSite: async (work) => work('site'),
    }, () => told.push('signed out'));
    await expect(view.withEditor('/news', () => {})).rejects.toThrow(/sign in again/);
    expect(told).toEqual(['signed out']);
    expect(await view.withSite((site) => `${site} read`)).toBe('site read');
    expect(told).toEqual(['signed out']);
  });

  it('passes any other failure on without telling', async () => {
    const told = [];
    const view = watchSignOut({ withSite: async () => { throw new Error('no page at /x'); } }, () => told.push('signed out'));
    await expect(view.withSite(() => {})).rejects.toThrow('no page at /x');
    expect(told).toEqual([]);
  });
});
