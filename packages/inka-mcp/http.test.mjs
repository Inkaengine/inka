import { describe, it, expect, afterEach } from 'vitest';
import { createServer, request } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { hostedServer, codesFrom } from './http.mjs';
import { sealer } from './sealed.mjs';
import { localCodes, sealedCodes } from './codes.mjs';

const ADMIN = 'https://admin.example.org';

/**
 * An HTTP request with Node's own client, never following a redirect (the
 * suite's jsdom replaces the global fetch): its status, headers and body.
 */
function call(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: { get: (name) => res.headers[name.toLowerCase()] ?? null },
        json: async () => JSON.parse(text),
      }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
const CLIENT_CB = 'https://client.example/cb';

/** A Plone token (a JWT) for `user`. */
const plone = (user) => {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part({ sub: user, exp: Math.floor(Date.now() / 1000) + 12 * 3600 })}.sig`;
};

const running = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map(({ listening, close }) => new Promise((done) => listening.close(done)).then(close)));
});

/** Instances of the server, each on a port of its own, made by `make(port)`, all reached at `public` by clients. */
async function instances(count, make) {
  const ports = await Promise.all(Array.from({ length: count }, () => new Promise((done) => {
    const probe = createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => done(port)); });
  })));
  const publicUrl = `http://127.0.0.1:${ports[0]}`;
  return ports.map((port) => {
    const { app, close } = hostedServer({ adminUrl: ADMIN, publicUrl, poolSize: 1, pageIdleMs: 60_000, ...make(port) });
    const listening = createServer(app).listen(port, '127.0.0.1');
    running.push({ listening, close });
    return `http://127.0.0.1:${port}`;
  });
}

/** Register, authorize and allow on `on`, as a client and the admin's connect page do: the code sent back. */
async function signIn(on) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const client = await (await call(`${on}/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [CLIENT_CB], client_name: 'Some agent', token_endpoint_auth_method: 'none' }),
  })).json();
  const authorize = new URL(`${on}/authorize`);
  for (const [k, v] of Object.entries({
    client_id: client.client_id, redirect_uri: CLIENT_CB, response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', state: 'client-state',
  })) authorize.searchParams.set(k, v);
  const toAdmin = new URL((await call(authorize.href)).headers.get('location'));
  const allowed = await call(`${on}/oauth/callback`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: String(new URLSearchParams({ token: plone('jane'), state: toAdmin.searchParams.get('state') })),
  });
  const code = new URL(allowed.headers.get('location')).searchParams.get('code');
  return { client, verifier, code };
}

/** The client's exchange of `code` at `on`. */
const exchange = (on, { client, verifier, code }) => call(`${on}/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: String(new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: CLIENT_CB })),
});

describe('a sign-in code across instances', () => {
  it('sealed: any instance takes it', async () => {
    const secret = randomBytes(32).toString('base64');
    const [one, two] = await instances(2, () => ({ secret, codes: sealedCodes({ box: sealer(secret) }) }));
    const answer = await exchange(two, await signIn(one));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toHaveProperty('access_token');
  });

  it('local, forwarded: another instance passes the exchange to the one that issued it', async () => {
    const secret = randomBytes(32).toString('base64');
    const [one, two] = await instances(2, (port) => ({
      secret,
      codes: localCodes({ instance: String(port), now: Date.now }),
      route: { kind: 'forward', instance: String(port), peerUrl: 'http://127.0.0.1:{instance}' },
    }));
    const signedIn = await signIn(one);
    const answer = await exchange(two, signedIn);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toHaveProperty('access_token');
    // Good once, wherever it is tried again.
    expect((await exchange(two, signedIn)).status).toBe(400);
  });

  it('local, replayed: another instance asks the platform to replay the exchange on the one that issued it', async () => {
    const secret = randomBytes(32).toString('base64');
    const [one, two] = await instances(2, (port) => ({
      secret,
      codes: localCodes({ instance: `m${port}`, now: Date.now }),
      route: { kind: 'fly-replay', instance: `m${port}` },
    }));
    const answer = await exchange(two, await signIn(one));
    expect(answer.headers.get('fly-replay')).toBe(`instance=m${new URL(one).port}`);
  });

  it('local, routed: a code naming an instance that is not a plain name is refused, not routed', async () => {
    const secret = randomBytes(32).toString('base64');
    const [one] = await instances(1, (port) => ({
      secret,
      codes: localCodes({ instance: `m${port}`, now: Date.now }),
      route: { kind: 'forward', instance: `m${port}`, peerUrl: 'http://127.0.0.1:{instance}' },
    }));
    const signedIn = await signIn(one);
    const answer = await exchange(one, { ...signedIn, code: `evil.example%2Fx~${randomBytes(8).toString('base64url')}` });
    expect(answer.status).toBe(400);
  });
});

describe('INKA_MCP_CODES', () => {
  const secret = randomBytes(32).toString('base64');

  it("stored: the deployment's own store, passed to the server from its own entry, given the environment", async () => {
    const held = new Map();
    const makeStore = (env) => ({
      async put(key, value) { held.set(env.MY_PREFIX + key, value); },
      async get(key) { return held.get(env.MY_PREFIX + key) ?? null; },
      async take(key) { const v = held.get(env.MY_PREFIX + key) ?? null; held.delete(env.MY_PREFIX + key); return v; },
    });
    const { codes, route } = await codesFrom({ INKA_MCP_CODES: 'stored', MY_PREFIX: 'x:' }, secret, { makeStore });
    expect(route).toBeUndefined();
    const data = { client: 'c', redirect: 'r', code_challenge: 'x', plone: 'a.b.c' };
    expect(await codes.take(await codes.issue(data))).toEqual(data);
    expect([...held.keys()]).toEqual([]);
  });

  it('stored, with no store passed: says how to pass one', async () => {
    await expect(codesFrom({ INKA_MCP_CODES: 'stored' }, secret)).rejects.toThrow(/main\(process\.env, \{ makeStore \}\)/);
  });

  it('says what it takes when it is something else', async () => {
    await expect(codesFrom({ INKA_MCP_CODES: 'redis://somewhere' }, secret)).rejects.toThrow(/memory, sealed or stored/);
  });

  it('routes only codes held in memory', async () => {
    await expect(codesFrom({ INKA_MCP_CODES: 'sealed', INKA_MCP_CODE_ROUTE: 'forward' }, secret)).rejects.toThrow(/routes codes held in memory/);
  });
});
