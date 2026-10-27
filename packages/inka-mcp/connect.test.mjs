// @vitest-environment node
// The listener is a Node server, and the browser posting to it is Node fetch.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectInBrowser } from './connect.mjs';
import { loadToken, saveToken, expiresAt } from './tokenStore.mjs';

const ADMIN = 'https://admin.example.org';

/** A browser that, on opening the connect page, posts `fields` to its redirect_uri. */
const browserThatPosts = (fields) => async (url) => {
  const connect = new URL(url);
  const body = new URLSearchParams(fields(connect.searchParams.get('state')));
  await fetch(connect.searchParams.get('redirect_uri'), { method: 'POST', body });
};

describe('connectInBrowser', () => {
  it("opens the admin's connect page, with a loopback address to send the token to", async () => {
    let opened;
    const token = await connectInBrowser({
      adminUrl: ADMIN,
      open: async (url) => { opened = new URL(url); await browserThatPosts((state) => ({ token: 'jwt-1', state }))(url); },
    });
    expect(token).toBe('jwt-1');
    expect(opened.origin + opened.pathname).toBe(`${ADMIN}/connect-agent`);
    expect(new URL(opened.searchParams.get('redirect_uri')).hostname).toBe('127.0.0.1');
    expect(opened.searchParams.get('state')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses a token sent with another state', async () => {
    await expect(connectInBrowser({ adminUrl: ADMIN, open: browserThatPosts(() => ({ token: 'jwt-1', state: 'forged' })) }))
      .rejects.toThrow(/did not come from the connect page this server opened/);
  });

  it('says so when the person declines', async () => {
    await expect(connectInBrowser({ adminUrl: ADMIN, open: browserThatPosts((state) => ({ error: 'access_denied', state })) }))
      .rejects.toThrow(/declined/);
  });

  it('gives up when no answer comes', async () => {
    await expect(connectInBrowser({ adminUrl: ADMIN, open: async () => {}, timeoutMs: 200 }))
      .rejects.toThrow(/no answer from the connect page/);
  });
});

describe('tokenStore', () => {
  const jwt = (exp) => `h.${Buffer.from(JSON.stringify({ sub: 'jane', exp })).toString('base64url')}.s`;

  it('keeps a token per admin, in a file only its owner can read', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'inka-mcp-')), 'nested', 'tokens.json');
    saveToken(file, ADMIN, 'jwt-a');
    saveToken(file, 'https://other.example.org', 'jwt-b');
    expect(loadToken(file, ADMIN)).toBe('jwt-a');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ [ADMIN]: 'jwt-a', 'https://other.example.org': 'jwt-b' });
  });

  it('has nothing for an admin it was never given a token for', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'inka-mcp-')), 'tokens.json');
    expect(loadToken(file, ADMIN)).toBeNull();
  });

  it("reads a token's expiry", () => {
    expect(expiresAt(jwt(4102444800))).toEqual(new Date(4102444800 * 1000));
  });
});
