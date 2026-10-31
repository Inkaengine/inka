/**
 * What the site refusing an editor means (adminDriver's EditorRefused). Plone
 * refuses (401) both a token it no longer accepts and a user it does accept
 * who may not edit the page; only the first is a reason to sign in again.
 */
import { describe, it, expect } from 'vitest';
import { refusalOf } from './adminPool.mjs';
import { SignedOut } from './signIn.mjs';

const jane = { id: 'jane', token: 'jane-token' };

describe('refusalOf', () => {
  it('a token the site no longer accepts: sign in again', async () => {
    const renew = async () => { throw new SignedOut('the CMS no longer accepts the token'); };
    const refusal = await refusalOf(renew, jane, '/news');
    expect(refusal).toBeInstanceOf(SignedOut);
    expect(refusal.message).toMatch(/sign in again/);
  });

  it('a user the site accepts: they may not edit the page', async () => {
    const refusal = await refusalOf(async () => 'renewed', jane, '/news');
    expect(refusal).not.toBeInstanceOf(SignedOut);
    expect(refusal.message).toBe('jane may not edit /news');
  });
});
