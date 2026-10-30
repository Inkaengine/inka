import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sealer } from './sealed.mjs';
import { oauthProvider } from './oauth.mjs';
import { localCodes } from './codes.mjs';
import { SignedOut } from './signIn.mjs';

const ADMIN = 'https://admin.example.org';
const CALLBACK = 'https://mcp.example.org/oauth/callback';
const CLIENT_CB = 'https://client.example/cb';

/** A Plone token (a JWT) for `user`, expiring in `hours`. */
const plone = (user, hours = 12) => {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part({ sub: user, exp: Math.floor(Date.now() / 1000) + hours * 3600 })}.sig`;
};

function setup({ renew = async (token) => plone('jane') + token.length, now = Date.now } = {}) {
  const renewed = [];
  const logged = [];
  const provider = oauthProvider({
    box: sealer(randomBytes(32).toString('base64')),
    adminUrl: ADMIN,
    callbackUrl: CALLBACK,
    renew: async (token) => { renewed.push(token); return renew(token); },
    log: (line) => logged.push(line),
    codes: localCodes({ instance: null, now }),
  });
  return { provider, renewed, logged };
}

/** Register a client and sign `user` in through it, up to the code it is sent back with (not yet exchanged). */
async function codeFor(provider, user = 'jane') {
  const client = await provider.clientsStore.registerClient({ redirect_uris: [CLIENT_CB], client_name: 'Some agent', token_endpoint_auth_method: 'none' });
  let to;
  await provider.authorize(client, { redirectUri: CLIENT_CB, codeChallenge: 'challenge', state: 'client-state' }, { redirect: (url) => { to = new URL(url); } });
  const back = new URL(await provider.callback({ token: plone(user), state: to.searchParams.get('state') }));
  return { client, code: back.searchParams.get('code') };
}

/** The whole sign-in, as the OAuth flow does it: the client's tokens. */
async function signedIn(provider, user = 'jane') {
  const { client, code } = await codeFor(provider, user);
  return { client, code, tokens: await provider.exchangeAuthorizationCode(client, code, 'verifier', CLIENT_CB) };
}

describe('oauthProvider', () => {
  it('keeps a client registration in the client id itself', async () => {
    const { provider } = setup();
    const client = await provider.clientsStore.registerClient({ redirect_uris: [CLIENT_CB], client_name: 'Some agent' });
    expect(await provider.clientsStore.getClient(client.client_id)).toMatchObject({ redirect_uris: [CLIENT_CB], client_name: 'Some agent' });
    expect(await provider.clientsStore.getClient('made-up')).toBeUndefined();
  });

  it("sends the person to the admin's connect page, naming the client", async () => {
    const { provider } = setup();
    const client = await provider.clientsStore.registerClient({ redirect_uris: [CLIENT_CB], client_name: 'Some agent' });
    let to;
    await provider.authorize(client, { redirectUri: CLIENT_CB, codeChallenge: 'challenge', state: 's' }, { redirect: (url) => { to = new URL(url); } });
    expect(to.origin + to.pathname).toBe(`${ADMIN}/connect-agent`);
    expect(to.searchParams.get('redirect_uri')).toBe(CALLBACK);
    expect(to.searchParams.get('client')).toBe('Some agent');
    expect(to.searchParams.get('state')).toBeTruthy();
  });

  it('on Allow, sends the client a code, with its own state; the code gives tokens holding the Plone token', async () => {
    const { provider } = setup();
    const { client, code } = await codeFor(provider);
    expect(await provider.challengeForAuthorizationCode(client, code)).toBe('challenge');
    const tokens = await provider.exchangeAuthorizationCode(client, code, 'verifier', CLIENT_CB);
    expect(tokens).toMatchObject({ token_type: 'Bearer' });
    expect(tokens.expires_in).toBeGreaterThan(0);
    expect(tokens.expires_in).toBeLessThanOrEqual(3600);
    const auth = await provider.verifyAccessToken(tokens.access_token);
    expect(auth.clientId).toBe(client.client_id);
    expect(auth.extra.user).toBe('jane');
    expect(auth.extra.plone.split('.').length).toBe(3);
  });

  it('on Cancel, tells the client the person declined', async () => {
    const { provider } = setup();
    const client = await provider.clientsStore.registerClient({ redirect_uris: [CLIENT_CB] });
    let to;
    await provider.authorize(client, { redirectUri: CLIENT_CB, codeChallenge: 'c', state: 'client-state' }, { redirect: (url) => { to = new URL(url); } });
    const back = new URL(await provider.callback({ error: 'access_denied', state: to.searchParams.get('state') }));
    expect(back.origin + back.pathname).toBe(CLIENT_CB);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('state')).toBe('client-state');
  });

  it('refuses a callback whose state it did not make', async () => {
    const { provider } = setup();
    await expect(provider.callback({ token: plone('jane'), state: 'forged' })).rejects.toThrow(/not a token from this server/);
  });

  it("refuses another client's code", async () => {
    const { provider } = setup();
    const { code } = await codeFor(provider);
    const other = await provider.clientsStore.registerClient({ redirect_uris: [CLIENT_CB] });
    await expect(provider.exchangeAuthorizationCode(other, code, 'v', CLIENT_CB)).rejects.toThrow(/another client/);
  });

  it('a refresh renews the Plone token', async () => {
    const { provider, renewed } = setup();
    const { client, tokens } = await signedIn(provider);
    const fresh = await provider.exchangeRefreshToken(client, tokens.refresh_token);
    expect(renewed).toHaveLength(1);
    const before = (await provider.verifyAccessToken(tokens.access_token)).extra.plone;
    expect((await provider.verifyAccessToken(fresh.access_token)).extra.plone).not.toBe(before);
  });

  it('a refresh Plone refuses means signing in again', async () => {
    const { provider } = setup({ renew: async () => { throw new SignedOut('the CMS no longer accepts the token'); } });
    const { client, tokens } = await signedIn(provider);
    await expect(provider.exchangeRefreshToken(client, tokens.refresh_token)).rejects.toThrow(/sign in again/);
  });

  it('refuses an access token it did not make, or a refresh token as an access token', async () => {
    const { provider } = setup();
    const { tokens } = await signedIn(provider);
    await expect(provider.verifyAccessToken('made-up')).rejects.toThrow(/not a token from this server/);
    await expect(provider.verifyAccessToken(tokens.refresh_token)).rejects.toThrow(/not a access token|refresh token/);
  });

  it("ends an access token before the Plone token in it does", async () => {
    const { provider } = setup();
    const client = await provider.clientsStore.registerClient({ redirect_uris: [CLIENT_CB] });
    let to;
    await provider.authorize(client, { redirectUri: CLIENT_CB, codeChallenge: 'c', state: 's' }, { redirect: (url) => { to = new URL(url); } });
    const short = plone('jane', 0.25); // 15 minutes left
    const code = new URL(await provider.callback({ token: short, state: to.searchParams.get('state') })).searchParams.get('code');
    const tokens = await provider.exchangeAuthorizationCode(client, code, 'v', CLIENT_CB);
    expect(tokens.expires_in).toBeLessThan(15 * 60);
  });

  it('logs each sign-in step: who, and where the browser goes; never a code or token', async () => {
    const { provider, logged } = setup();
    const { tokens } = await signedIn(provider);
    expect(logged).toEqual([
      `client registered: "Some agent", returns to ["${CLIENT_CB}"]`,
      `sign-in started by "Some agent", to return to ${CLIENT_CB}`,
      `sign-in allowed for jane; sending the browser to ${CLIENT_CB}`,
      'code exchanged by "Some agent" for jane\'s tokens',
    ]);
    expect(logged.join('\n')).not.toContain(tokens.access_token);
    expect(logged.join('\n')).not.toContain('code=');
  });

  it('hands the client a short code, as OAuth clients expect, good once', async () => {
    // A code carrying the sealed sign-in ran to ~1,400 characters; Claude's
    // callback took it and never came back to exchange it.
    const { provider } = setup();
    const { client, code } = await signedIn(provider);
    expect(code.length).toBeLessThanOrEqual(64);
    await expect(provider.exchangeAuthorizationCode(client, code, 'v', CLIENT_CB)).rejects.toThrow(/already used|not a code/);
  });

  it('refuses a code once it has lapsed', async () => {
    let clock = 1_000_000;
    const { provider } = setup({ now: () => clock });
    const client = await provider.clientsStore.registerClient({ redirect_uris: [CLIENT_CB] });
    let to;
    await provider.authorize(client, { redirectUri: CLIENT_CB, codeChallenge: 'c', state: 's' }, { redirect: (url) => { to = new URL(url); } });
    const code = new URL(await provider.callback({ token: plone('jane'), state: to.searchParams.get('state') })).searchParams.get('code');
    clock += 61_000;
    await expect(provider.exchangeAuthorizationCode(client, code, 'v', CLIENT_CB)).rejects.toThrow(/lapsed/);
  });
});
