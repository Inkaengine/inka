/**
 * The hosted MCP server end to end, as any MCP client meets it: the client
 * finds how to sign in, registers, sends the person through the site's own
 * sign-in (the admin's connect page) and gets tokens; its calls then run as
 * that person. Uses the MCP SDK's own client OAuth, as clients built on it do.
 */
import { randomBytes } from 'node:crypto';
import { createServer as httpListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { hostedServer } from '../../packages/inka-mcp/http.mjs';
import { localCodes, localPictures } from '../../packages/inka-mcp/codes.mjs';

/** Listen on a free loopback port; the server and its address. */
async function listen(handler: Parameters<typeof httpListener>[0] | ReturnType<typeof hostedServer>['app']) {
  const server: Server = httpListener(handler as any);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/** An MCP client's sign-in state, as a client app keeps it (OAuthClientProvider). */
function clientAuth(redirectUrl: string, openBrowser: (url: URL) => Promise<void>) {
  let info: any;
  let tokens: any;
  let verifier = '';
  return {
    redirectUrl,
    clientMetadata: { client_name: 'Test agent', redirect_uris: [redirectUrl], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] },
    clientInformation: () => info,
    saveClientInformation: (i: any) => { info = i; },
    tokens: () => tokens,
    saveTokens: (t: any) => { tokens = t; },
    redirectToAuthorization: openBrowser,
    saveCodeVerifier: (v: string) => { verifier = v; },
    codeVerifier: () => verifier,
    get current() { return tokens; },
  };
}

test.describe('hosted MCP server', () => {
  test('a client signs in through the site, and its calls run as that person', async ({ page, urls }) => {
    test.setTimeout(120000);
    const helper = new AdminUIHelper(page);
    await helper.login();

    // The client app's own redirect (where the browser comes back with a code).
    let gotCode!: (code: string) => void;
    const code = new Promise<string>((r) => { gotCode = r; });
    const clientApp = await listen((req, res) => {
      gotCode(new URL(req.url!, 'http://x').searchParams.get('code')!);
      res.end('back in the client');
    });

    // The hosted server, here on loopback (so the admin's connect page takes its callback as local).
    let hosted: ReturnType<typeof hostedServer>;
    const mcp = await listen((req, res) => hosted.app(req, res));
    hosted = hostedServer({
      adminUrl: urls.voltoSsr,
      publicUrl: mcp.url,
      secret: randomBytes(32).toString('base64'),
      codes: localCodes({ instance: null, now: Date.now }),
      pictures: localPictures({ instance: null, now: Date.now }),
      poolSize: 1,
    });

    const auth = clientAuth(`${clientApp.url}/cb`, async (url) => {
      // The person's browser: our /authorize, on to the admin's connect page; they allow it.
      await page.goto(url.href);
      await expect(page.getByText(/Test agent is asking|An agent on this computer is asking/)).toBeVisible();
      await page.getByRole('button', { name: 'Allow' }).click();
    });
    try {
      const first = new StreamableHTTPClientTransport(new URL('/mcp', mcp.url), { authProvider: auth });
      await expect(new Client({ name: 'test', version: '0' }).connect(first)).rejects.toThrow(UnauthorizedError);
      await first.finishAuth(await code);

      const client = new Client({ name: 'test', version: '0' });
      await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', mcp.url), { authProvider: auth }));
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('get_page');
      const read = await client.callTool({ name: 'get_page', arguments: { path: '/_test_data/line-breaks-page' } }, undefined, { timeout: 90000 });
      expect(read.isError, (read.content as any[])[0].text).toBeFalsy();
      expect(JSON.parse((read.content as any[])[0].text).path).toBe('/_test_data/line-breaks-page');

      // The client holds sealed tokens, not the person's Plone token.
      const signedInAs = (await page.context().cookies()).find((c) => c.name === 'auth_token')!.value;
      expect(JSON.stringify(auth.current)).not.toContain(signedInAs);
      await client.close();
    } finally {
      await hosted.close();
      mcp.server.close();
      clientApp.server.close();
    }
  });

  test('without a token, the server says how to sign in', async ({ urls }) => {
    let hosted: ReturnType<typeof hostedServer>;
    const mcp = await listen((req, res) => hosted.app(req, res));
    hosted = hostedServer({ adminUrl: urls.voltoSsr, publicUrl: mcp.url, secret: randomBytes(32).toString('base64'), codes: localCodes({ instance: null, now: Date.now }), pictures: null, poolSize: 1 });
    try {
      const res = await fetch(`${mcp.url}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain(`${mcp.url}/.well-known/oauth-protected-resource/mcp`);
      const meta = await (await fetch(`${mcp.url}/.well-known/oauth-protected-resource/mcp`)).json();
      expect(meta.authorization_servers).toEqual([`${mcp.url}/`]);
      // Also at the root path, for a client that looks there.
      expect(await (await fetch(`${mcp.url}/.well-known/oauth-protected-resource`)).json()).toEqual(meta);
      const as = await (await fetch(`${mcp.url}/.well-known/oauth-authorization-server`)).json();
      expect(as).toMatchObject({ registration_endpoint: `${mcp.url}/register`, code_challenge_methods_supported: ['S256'] });
    } finally {
      await hosted.close();
      mcp.server.close();
    }
  });
});
