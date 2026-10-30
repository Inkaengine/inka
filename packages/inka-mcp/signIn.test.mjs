import { describe, it, expect } from 'vitest';
import { renewDelay } from './signIn.mjs';

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
