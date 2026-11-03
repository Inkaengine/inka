import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sealer, Unsealable } from './sealed.mjs';

const key = randomBytes(32).toString('base64');

describe('sealer', () => {
  const box = sealer(key);

  it('opens what it sealed, of the kind it was sealed as', () => {
    const token = box.seal('access', { plone: 'jwt', client: 'c1' }, 60000);
    expect(box.open('access', token)).toMatchObject({ plone: 'jwt', client: 'c1' });
  });

  it('shows nothing of what it holds', () => {
    const token = box.seal('access', { plone: 'eyJ-the-plone-token' }, 60000);
    expect(token).not.toContain('eyJ-the-plone-token');
    expect(Buffer.from(token, 'base64url').toString('latin1')).not.toContain('the-plone-token');
  });

  it('refuses one sealed as another kind', () => {
    const refresh = box.seal('refresh', { plone: 'jwt' }, 60000);
    expect(() => box.open('access', refresh)).toThrow(Unsealable);
  });

  it('refuses one that has expired', () => {
    const token = box.seal('code', { plone: 'jwt' }, -1);
    expect(() => box.open('code', token)).toThrow(/expired/);
  });

  it('refuses one that was changed', () => {
    const token = box.seal('access', { plone: 'jwt' }, 60000);
    const bytes = Buffer.from(token, 'base64url');
    bytes[bytes.length - 20] ^= 1;
    expect(() => box.open('access', bytes.toString('base64url'))).toThrow(Unsealable);
  });

  it('refuses one sealed with another key', () => {
    const token = sealer(randomBytes(32).toString('base64')).seal('access', { plone: 'jwt' }, 60000);
    expect(() => box.open('access', token)).toThrow(Unsealable);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => sealer(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });

  it('may hold no expiry (a client registration)', () => {
    const id = box.seal('client', { redirect_uris: ['https://claude.ai/cb'] }, null);
    expect(box.open('client', id).redirect_uris).toEqual(['https://claude.ai/cb']);
  });
});
