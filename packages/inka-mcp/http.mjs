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
 *   INKA_MCP_POOL_SIZE   how many admin pages to share (how many calls at once)
 *   INKA_MCP_PAGE_IDLE_SECONDS  how long a page may sit unused before it is
 *                        loaded afresh (the admin may have been redeployed)
 *   PORT                 the port to listen on
 *   INKA_FRONTEND_URL    optional: the front end the editor uses
 */
import { realpathSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.mjs';
import { adminPool } from './adminPool.mjs';
import { oauthProvider } from './oauth.mjs';
import { sealer } from './sealed.mjs';
import { renewThrough } from './signIn.mjs';

/** A form post's fields (the connect page posts application/x-www-form-urlencoded). */
async function formFields(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return Object.fromEntries(new URLSearchParams(body));
}

/**
 * The server as an Express app (from the MCP SDK), and `close()` for its
 * browser. `publicUrl` is where clients reach it.
 */
export function hostedServer({ adminUrl, publicUrl, secret, poolSize, pageIdleMs, frontendUrl }) {
  const base = new URL(publicUrl);
  const mcpUrl = new URL('/mcp', base);
  const admin = adminUrl.replace(/\/$/, '');
  const provider = oauthProvider({
    box: sealer(secret),
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
  app.use(mcpAuthRouter({
    provider,
    issuerUrl: base,
    resourceServerUrl: mcpUrl,
    resourceName: 'Inka',
    // The client id is the sealed registration (oauth.mjs), not a random id.
    clientRegistrationOptions: { clientIdGeneration: false },
  }));

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

async function main(env) {
  const poolSize = Number(required(env, 'INKA_MCP_POOL_SIZE'));
  const { app, close } = hostedServer({
    adminUrl: required(env, 'INKA_ADMIN_URL'),
    publicUrl: required(env, 'INKA_MCP_PUBLIC_URL'),
    secret: required(env, 'INKA_MCP_SECRET'),
    poolSize,
    pageIdleMs: Number(required(env, 'INKA_MCP_PAGE_IDLE_SECONDS')) * 1000,
    frontendUrl: env.INKA_FRONTEND_URL,
  });
  // Every request, before anything can refuse it (the SDK's Host check runs
  // first in the app): method, path without its query, Host, user agent, and
  // the status it got.
  const listening = httpServer((req, res) => {
    res.on('finish', () => {
      const path = req.url.split('?')[0];
      console.log(`req: ${req.method} ${path} host=${req.headers.host} ua="${req.headers['user-agent']}" -> ${res.statusCode}`);
    });
    app(req, res);
  }).listen(Number(required(env, 'PORT')));
  const stop = () => listening.close(() => close().then(() => process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await main(process.env);
}
