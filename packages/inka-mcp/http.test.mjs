import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import { createServer, request } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { hostedServer, codesFrom, replayBy, forwardTo } from './http.mjs';
import { sealer } from './sealed.mjs';
import { localCodes, sealedCodes, localPictures } from './codes.mjs';


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
        text: async () => text,
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

// The suite's setup (Volto's) stubs the global fetch for the admin's
// component tests; these run a real server, which renews the sign-in through
// the admin below with a real one.
vi.unstubAllGlobals();

/**
 * The admin, as far as signing in needs it: the server renews the token the
 * connect page sends (@login-renew), and this renews any, for the same user.
 */
const admin = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/++api++/@login-renew') {
    res.statusCode = 404;
    res.end();
    return;
  }
  const { sub } = JSON.parse(Buffer.from(req.headers.authorization.split('.')[1], 'base64url').toString());
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ token: plone(sub) }));
});
await new Promise((listening) => { admin.listen(0, '127.0.0.1', listening); });
const ADMIN = `http://127.0.0.1:${admin.address().port}`;
afterAll(() => new Promise((closed) => { admin.close(closed); }));

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
    const [one, two] = await instances(2, () => ({ secret, codes: sealedCodes({ box: sealer(secret) }), pictures: null }));
    const answer = await exchange(two, await signIn(one));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toHaveProperty('access_token');
  });

  it('local, forwarded: another instance passes the exchange to the one that issued it', async () => {
    const secret = randomBytes(32).toString('base64');
    const [one, two] = await instances(2, (port) => ({
      secret,
      pictures: null,
      codes: localCodes({ instance: String(port), now: Date.now }),
      route: { instance: String(port), send: forwardTo('http://127.0.0.1:{instance}') },
    }));
    const signedIn = await signIn(one);
    const answer = await exchange(two, signedIn);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toHaveProperty('access_token');
    // Good once, wherever it is tried again.
    expect((await exchange(two, signedIn)).status).toBe(400);
  });

  it("local, a deployment's own route: another instance hands the exchange to it, naming the one that issued it", async () => {
    const secret = randomBytes(32).toString('base64');
    const [one, two] = await instances(2, (port) => ({
      secret,
      pictures: null,
      codes: localCodes({ instance: `m${port}`, now: Date.now }),
      route: { instance: `m${port}`, send: replayBy('X-Replay-To', 'machine={instance};path=/token') },
    }));
    const answer = await exchange(two, await signIn(one));
    expect(answer.headers.get('x-replay-to')).toBe(`machine=m${new URL(one).port};path=/token`);
  });

  it('local, routed: a code naming an instance that is not a plain name is refused, not routed', async () => {
    const secret = randomBytes(32).toString('base64');
    const [one] = await instances(1, (port) => ({
      secret,
      pictures: null,
      codes: localCodes({ instance: `m${port}`, now: Date.now }),
      route: { instance: `m${port}`, send: forwardTo('http://127.0.0.1:{instance}') },
    }));
    const signedIn = await signIn(one);
    const answer = await exchange(one, { ...signedIn, code: `evil.example%2Fx~${randomBytes(8).toString('base64url')}` });
    expect(answer.status).toBe(400);
  });
});

/** A tool call on `on`, signed in with `accessToken`, as an MCP client (or a view, through it) sends one: its JSON-RPC answer. */
async function callTool(on, accessToken, name, args) {
  const answer = await call(`${on}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await answer.text();
  // Streamable HTTP answers as an event stream: the message is its data line.
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  return { status: answer.status, headers: answer.headers, message: data && JSON.parse(data.slice(6)) };
}

const PICTURE = { mimeType: 'image/png', data: 'iVBORw0KGgo' };

describe('a picture across instances', () => {
  // A client (Claude) hands the view a tool's result without its pictures:
  // the view asks for each by id (the `picture` tool), and like a code
  // exchange, the ask can reach any instance.
  // Forwarding reaches an instance by its name (here, its port); a replay
  // names it to the proxy in front, any way the deployment likes.
  async function twoInstances(send, nameOf = (port) => `m${port}`) {
    const secret = randomBytes(32).toString('base64');
    const pictures = {};
    const urls = await instances(2, (port) => {
      pictures[port] = localPictures({ instance: nameOf(port), now: Date.now });
      return {
        secret,
        codes: localCodes({ instance: nameOf(port), now: Date.now }),
        pictures: pictures[port],
        route: { instance: nameOf(port), send },
      };
    });
    return { urls, picturesOn: (url) => pictures[new URL(url).port] };
  }

  it('local, forwarded: another instance passes the ask to the one holding the picture', async () => {
    const { urls: [one, two], picturesOn } = await twoInstances(forwardTo('http://127.0.0.1:{instance}'), String);
    const { access_token: token } = await (await exchange(one, await signIn(one))).json();
    const id = await picturesOn(one).issue({ user: 'jane', ...PICTURE });
    const { status, message } = await callTool(two, token, 'picture', { id });
    expect(status).toBe(200);
    expect(message.result.structuredContent).toEqual(PICTURE);
  });

  it("local, a deployment's own route: the ask is handed back, naming the instance holding the picture", async () => {
    const { urls: [one, two], picturesOn } = await twoInstances(replayBy('X-Replay-To', 'machine={instance}'));
    const { access_token: token } = await (await exchange(one, await signIn(one))).json();
    const id = await picturesOn(one).issue({ user: 'jane', ...PICTURE });
    const { headers } = await callTool(two, token, 'picture', { id });
    expect(headers.get('x-replay-to')).toBe(`machine=m${new URL(one).port}`);
  });

  it("is only the user's who took it", async () => {
    const { urls: [one], picturesOn } = await twoInstances(forwardTo('http://127.0.0.1:{instance}'), String);
    const { access_token: token } = await (await exchange(one, await signIn(one))).json();
    const id = await picturesOn(one).issue({ user: 'someone-else', ...PICTURE });
    const { message } = await callTool(one, token, 'picture', { id });
    expect(message.result.isError).toBe(true);
    expect(message.result.structuredContent).toBeUndefined();
  });
});

describe('hostedServer', () => {
  it('refuses to start without a code store', () => {
    expect(() => hostedServer({ adminUrl: ADMIN, publicUrl: 'http://127.0.0.1:1', secret: randomBytes(32).toString('base64'), poolSize: 1, pageIdleMs: 60_000 }))
      .toThrow(/codes/);
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

  it('memory with a route: codes name the instance the route says this is', async () => {
    const route = { instance: 'm-1', send: replayBy('fly-replay', 'instance={instance}') };
    const { codes, route: kept } = await codesFrom({ INKA_MCP_CODES: 'memory' }, secret, { route });
    expect(kept).toBe(route);
    const data = { client: 'c', redirect: 'r', code_challenge: 'x', plone: 'a.b.c' };
    expect((await codes.issue(data)).startsWith('m-1~')).toBe(true);
  });

  it("a route needs its instance's name: a platform variable that isn't set is refused", async () => {
    await expect(codesFrom({ INKA_MCP_CODES: 'memory' }, secret, { route: { instance: undefined, send: forwardTo('http://{instance}') } }))
      .rejects.toThrow(/letters, digits and '-'/);
  });

  it("a route's instance is a plain name", async () => {
    await expect(codesFrom({ INKA_MCP_CODES: 'memory' }, secret, { route: { instance: 'evil.example/x', send: forwardTo('http://{instance}') } }))
      .rejects.toThrow(/letters, digits and '-'/);
  });

  it('a replay or a forward says where {instance} goes', () => {
    expect(() => replayBy('X-Replay-To', 'somewhere')).toThrow(/\{instance\}/);
    expect(() => forwardTo('http://peer')).toThrow(/\{instance\}/);
  });

  it('memory: pictures are held as codes are, naming the instance', async () => {
    const route = { instance: 'm-1', send: replayBy('fly-replay', 'instance={instance}') };
    const { pictures } = await codesFrom({ INKA_MCP_CODES: 'memory' }, secret, { route });
    expect((await pictures.issue({ user: 'jane', ...PICTURE })).startsWith('m-1~')).toBe(true);
  });

  it("stored: pictures in the deployment's store too", async () => {
    const held = new Map();
    const makeStore = () => ({
      async put(key, value) { held.set(key, value); },
      async get(key) { return held.get(key) ?? null; },
      async take(key) { const v = held.get(key) ?? null; held.delete(key); return v; },
    });
    const { pictures } = await codesFrom({ INKA_MCP_CODES: 'stored' }, secret, { makeStore });
    await pictures.issue({ user: 'jane', ...PICTURE });
    expect([...held.keys()]).toEqual([expect.stringMatching(/^inka-mcp:picture:/)]);
  });

  it('sealed: no pictures are kept (nothing is held, and a picture is too big for its id)', async () => {
    const { pictures } = await codesFrom({ INKA_MCP_CODES: 'sealed' }, secret);
    expect(pictures).toBeNull();
  });

  it('routes only codes held in memory', async () => {
    const route = { instance: 'm-1', send: forwardTo('http://{instance}') };
    await expect(codesFrom({ INKA_MCP_CODES: 'sealed' }, secret, { route })).rejects.toThrow(/routes codes held in memory/);
  });
});
