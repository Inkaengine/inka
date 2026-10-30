#!/usr/bin/env node
/**
 * The hosted Inka MCP server: any MCP client reaches it by URL
 * (`<public URL>/mcp`, Streamable HTTP) and signs in with OAuth (oauth.mjs),
 * through the site's own sign-in. Each request runs as its user, on a page
 * from a pool shared by every user (adminPool.mjs). It keeps no state: the
 * tokens carry what it needs, sealed, and each request stands alone.
 *
 * Configuration (environment):
 *   INKA_ADMIN_URL       the site's admin, e.g. https://admin.example.org
 *   INKA_MCP_PUBLIC_URL  where clients reach this server, e.g. https://mcp.example.org;
 *                        the admin's RAZZLE_INKA_MCP_URL must be the same, so
 *                        its connect page will send sign-ins here
 *   INKA_MCP_SECRET      the sealing key: 32 random bytes, base64
 *   INKA_MCP_CODES       where sign-in codes wait between sign-in and the client's
 *                        exchange (codes.mjs): `memory` (one instance, or several
 *                        with a route, below), `sealed` (any instance, nothing
 *                        held), or `stored` (a store of the deployment's own that
 *                        every instance reaches: start the server from an entry
 *                        of your own, `await main(process.env, { makeStore })`,
 *                        where makeStore(env) returns the store codes.mjs
 *                        storedCodes describes)
 *   INKA_MCP_POOL_SIZE   how many admin pages to share (how many calls at once)
 *   INKA_MCP_PAGE_IDLE_SECONDS  how long a page may sit unused before it is
 *                        loaded afresh (the admin may have been redeployed)
 *   PORT                 the port to listen on
 *   INKA_FRONTEND_URL    optional: the front end the editor uses
 *
 * What depends on where it runs is the deployment's own code, passed from an
 * entry of its own: `await main(process.env, { makeStore, route })`.
 *   makeStore(env)  the store for INKA_MCP_CODES=stored (codes.mjs storedCodes)
 *   route           with `memory` on several instances, how an exchange that
 *                   reaches another instance gets to the one holding its code:
 *                   { instance: this instance's name (letters, digits, '-'),
 *                     send(owner, req, res): answer the exchange for `owner` }.
 *                   Sticky sessions can't do this: the exchange comes from the
 *                   client's server, without the browser's cookies. Two sends:
 *                   replayBy(header, value), for a proxy that replays a request
 *                   by a response header (it must replay the POST with its
 *                   body; nginx's X-Accel-Redirect makes it a GET), and
 *                   forwardTo(peerUrl), where instances reach each other.
 */
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.mjs';
import { adminPool } from './adminPool.mjs';
import { oauthProvider } from './oauth.mjs';
import { sealer } from './sealed.mjs';
import { localCodes, storedCodes, sealedCodes, instanceOfCode } from './codes.mjs';
import { renewThrough } from './signIn.mjs';

/** A form post's fields (the connect page posts application/x-www-form-urlencoded). */
async function formFields(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return Object.fromEntries(new URLSearchParams(body));
}

// An instance's name, as a code carries it and a route uses it in a header or
// an address: letters, digits and '-' only, so a made-up code can't send an
// exchange anywhere but to another instance.
const INSTANCE_NAME = /^[A-Za-z0-9-]{1,64}$/;

/** Where {instance} goes in `template`, or an error naming `what`. */
function instanceTemplate(what, template) {
  if (!String(template).includes('{instance}')) throw new Error(`${what} must say where {instance} goes`);
  return template;
}

/**
 * A route's send: answer with `header`, set to `value` with {instance}
 * replaced, for the proxy in front to replay the request on that instance.
 */
export function replayBy(header, value) {
  instanceTemplate('a replay value', value);
  return async (owner, req, res) => {
    res.set(header, value.replaceAll('{instance}', owner)).status(307).end();
  };
}

/**
 * A route's send: pass the exchange on to the instance, at `peerUrl` with
 * {instance} replaced (e.g. http://{instance}.internal:8080), and hand back
 * its answer. A request already passed on is not passed on again.
 */
export function forwardTo(peerUrl) {
  instanceTemplate('a peer URL', peerUrl);
  const base = peerUrl.replace(/\/$/, '');
  return async (owner, req, res) => {
    if (req.headers['x-inka-mcp-forwarded']) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'not a code from this server, or already used' });
      return;
    }
    const target = new URL(`${base.replaceAll('{instance}', owner)}/token`);
    const body = new URLSearchParams(req.body).toString();
    const answer = await new Promise((resolve, reject) => {
      const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
      const out = send(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'X-Inka-MCP-Forwarded': '1',
          ...(req.headers.authorization && { Authorization: req.headers.authorization }),
        },
      }, (back) => {
        const chunks = [];
        back.on('data', (chunk) => chunks.push(chunk));
        back.on('end', () => resolve({ status: back.statusCode, headers: back.headers, body: Buffer.concat(chunks) }));
        back.on('error', reject);
      });
      out.on('error', reject);
      out.end(body);
    });
    res.status(answer.status);
    for (const header of ['content-type', 'cache-control', 'pragma']) {
      if (answer.headers[header]) res.set(header, answer.headers[header]);
    }
    res.send(answer.body);
  };
}

/**
 * The server as an Express app (from the MCP SDK), and `close()` for its
 * browser. `publicUrl` is where clients reach it. `codes`: where sign-in
 * codes wait (codes.mjs). `route`: for local codes on several instances,
 * { instance, send } (see the configuration above).
 */
export function hostedServer({ adminUrl, publicUrl, secret, codes, route, poolSize, pageIdleMs, frontendUrl }) {
  if (!codes) throw new Error('hostedServer: `codes` is required, where sign-in codes wait (codes.mjs; codesFrom reads INKA_MCP_CODES)');
  if (route && !INSTANCE_NAME.test(route.instance)) {
    throw new Error(`a route's instance is its name: letters, digits and '-' (got ${JSON.stringify(route.instance)})`);
  }
  const base = new URL(publicUrl);
  const mcpUrl = new URL('/mcp', base);
  const admin = adminUrl.replace(/\/$/, '');
  const provider = oauthProvider({
    box: sealer(secret),
    codes,
    adminUrl: admin,
    callbackUrl: new URL('/oauth/callback', base).href,
    renew: (token) => renewThrough(admin, token),
    log: (line) => console.log(`oauth: ${line}`),
  });
  const pool = adminPool({ adminUrl: admin, frontendUrl, size: poolSize, maxIdleMs: pageIdleMs });

  // Requests must name this server's host (DNS rebinding protection).
  const app = createMcpExpressApp({ allowedHosts: [base.hostname] });
  // Each request, as it ends: method, path (never its query: codes travel
  // there) and status; for a refused sign-in step, the OAuth error answered
  // (an error code and description, nothing secret).
  app.use((req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 400 && ['/token', '/register', '/authorize'].includes(req.path)) {
        console.log(`http: ${req.method} ${req.path} answered ${JSON.stringify({ error: body?.error, error_description: body?.error_description })}`);
      }
      return json(body);
    };
    res.on('finish', () => console.log(`http: ${req.method} ${req.path} ${res.statusCode}`));
    next();
  });
  // A code exchange whose code another instance holds goes to that instance.
  if (route) {
    app.post('/token', async (req, res, next) => {
      // Read here; the SDK's own parser then finds the body read and keeps this.
      req.body = await formFields(req);
      const owner = req.body?.grant_type === 'authorization_code' ? instanceOfCode(req.body.code) : null;
      if (owner === null || owner === route.instance) {
        next();
        return;
      }
      if (!INSTANCE_NAME.test(owner)) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'not a code from this server, or already used' });
        return;
      }
      await route.send(owner, req, res);
    });
  }
  app.use(mcpAuthRouter({
    provider,
    issuerUrl: base,
    resourceServerUrl: mcpUrl,
    resourceName: 'Inka',
    // The client id is the sealed registration (oauth.mjs), not a random id.
    clientRegistrationOptions: { clientIdGeneration: false },
  }));

  // The resource's metadata at the root path too (RFC 9728 puts it at
  // /.well-known/oauth-protected-resource/mcp, which the SDK serves): a
  // client that looks for it at the root found a 404.
  app.get('/.well-known/oauth-protected-resource', (req, res) => {
    res.json({ resource: mcpUrl.href, authorization_servers: [base.href], resource_name: 'Inka' });
  });

  // The admin's connect page posts here: Allow (the Plone token) or Cancel.
  app.post('/oauth/callback', async (req, res) => {
    let next;
    try {
      next = await provider.callback(await formFields(req));
    } catch (error) {
      res.status(400).type('text/plain').send(`Not signed in: ${error.message}. Start again from your MCP client.`);
      return;
    }
    res.redirect(next);
  });

  const signedIn = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
  });
  // Each request on its own (stateless): the tools act as the request's user.
  app.post('/mcp', signedIn, async (req, res) => {
    const server = createServer((extra) => pool.forUser(async () => ({
      id: extra.authInfo.extra.user, token: extra.authInfo.extra.plone,
    })));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  // Stateless: no session stream to open (GET) or end (DELETE).
  const noSessions = (req, res) => res.status(405).set('Allow', 'POST').json({
    jsonrpc: '2.0', error: { code: -32000, message: 'This server keeps no sessions: POST each request.' }, id: null,
  });
  app.get('/mcp', noSessions);
  app.delete('/mcp', noSessions);

  return { app, close: () => pool.close() };
}

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`inka-mcp: ${name} is not set`);
  return value;
}

/**
 * The code store INKA_MCP_CODES describes, and the route it is used with.
 * `makeStore(env)`: the deployment's own store, for `stored`. `route`: the
 * deployment's own, for `memory` on several instances.
 */
export async function codesFrom(env, secret, { makeStore, route } = {}) {
  const kind = required(env, 'INKA_MCP_CODES');
  if (route && kind !== 'memory') {
    throw new Error(`a route routes codes held in memory; INKA_MCP_CODES is ${kind}, which any instance can take`);
  }
  if (kind === 'sealed') return { codes: sealedCodes({ box: sealer(secret) }) };
  if (kind === 'stored') {
    if (!makeStore) {
      throw new Error('INKA_MCP_CODES=stored needs your store: start the server from your own entry, with `await main(process.env, { makeStore })`');
    }
    return { codes: storedCodes({ store: await makeStore(env), now: Date.now }) };
  }
  if (kind !== 'memory') throw new Error(`INKA_MCP_CODES is memory, sealed or stored, not ${JSON.stringify(kind)}`);
  if (!route) return { codes: localCodes({ instance: null, now: Date.now }) };
  if (!INSTANCE_NAME.test(route.instance)) {
    throw new Error(`a route's instance is its name: letters, digits and '-' (got ${JSON.stringify(route.instance)})`);
  }
  return { codes: localCodes({ instance: route.instance, now: Date.now }), route };
}

/**
 * Start the server as the environment describes. A deployment with a code
 * store of its own starts it from an entry of its own, passing `makeStore`.
 */
export async function main(env, { makeStore, route } = {}) {
  const poolSize = Number(required(env, 'INKA_MCP_POOL_SIZE'));
  const secret = required(env, 'INKA_MCP_SECRET');
  const { app, close } = hostedServer({
    adminUrl: required(env, 'INKA_ADMIN_URL'),
    publicUrl: required(env, 'INKA_MCP_PUBLIC_URL'),
    secret,
    ...(await codesFrom(env, secret, { makeStore, route })),
    poolSize,
    pageIdleMs: Number(required(env, 'INKA_MCP_PAGE_IDLE_SECONDS')) * 1000,
    frontendUrl: env.INKA_FRONTEND_URL,
  });
  // Every request, before anything can refuse it (the SDK's Host check runs
  // first in the app): method, path without its query, Host, user agent, and
  // the status it got.
  const listening = httpServer((req, res) => {
    // Taken now: Express rewrites req.url as it routes.
    const path = req.url.split('?')[0];
    // A refused MCP request says why in its body (a JSON-RPC error, no
    // arguments or tokens): kept to log with it.
    let refusal = '';
    if (path === '/mcp') {
      const end = res.end.bind(res);
      res.end = (chunk, ...rest) => {
        if (res.statusCode >= 400 && chunk) refusal = String(chunk).slice(0, 300);
        return end(chunk, ...rest);
      };
    }
    res.on('finish', () => {
      if (refusal) {
        console.log(`req: refused ${req.method} /mcp protocol=${req.headers['mcp-protocol-version']} accept="${req.headers.accept}" -> ${refusal}`);
      }
      // For an MCP request, what it asked for: its JSON-RPC method, and the
      // tool for a tool call (no arguments).
      const rpc = path === '/mcp' && req.body?.method
        ? ` ${req.body.method}${req.body.params?.name ? `:${req.body.params.name}` : ''}` : '';
      console.log(`req: ${req.method} ${path}${rpc} host=${req.headers.host} ua="${req.headers['user-agent']}" -> ${res.statusCode}`);
    });
    app(req, res);
  }).listen(Number(required(env, 'PORT')));
  const stop = () => listening.close(() => close().then(() => process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
