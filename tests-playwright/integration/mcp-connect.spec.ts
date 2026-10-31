/**
 * The admin's /connect-agent page: a person signed in to the admin allows an
 * agent on their computer (the MCP server) to act as them, and their token
 * goes to the server's loopback listener, and nowhere else.
 */
import { createServer, type Server } from 'node:http';
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectInBrowser } from '../../packages/inka-mcp/connect.mjs';
import { signIn } from '../../packages/inka-mcp/signIn.mjs';
import { loadToken } from '../../packages/inka-mcp/tokenStore.mjs';

/** A stand-in for the MCP server's listener: what it was posted. */
async function listener(): Promise<{ url: string; posted: Promise<URLSearchParams>; close: () => void }> {
  let resolve!: (fields: URLSearchParams) => void;
  const posted = new Promise<URLSearchParams>((r) => { resolve = r; });
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { res.end('ok'); resolve(new URLSearchParams(body)); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}/callback`, posted, close: () => server.close() };
}

/** The token the admin holds now: it renews the one it signed in with as it loads. */
const heldToken = async (page) => (await page.context().cookies()).find((c) => c.name === 'auth_token')!.value;

const connectPage = (adminUrl: string, redirectUri: string, state = 'the-state') => (
  `${adminUrl}/connect-agent?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`
);

test.describe('connect-agent', () => {
  test("Allow sends the person's token, with the state, to the agent's listener", async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    const agent = await listener();
    try {
      await page.goto(connectPage(helper.adminUrl, agent.url));
      await expect(page.getByText('as admin')).toBeVisible();
      await page.getByRole('button', { name: 'Allow' }).click();
      const fields = await agent.posted;
      expect(fields.get('token')).toBe(await heldToken(page));
      expect(fields.get('state')).toBe('the-state');
    } finally {
      agent.close();
    }
  });

  test('Cancel tells the agent no, and sends no token', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    const agent = await listener();
    try {
      await page.goto(connectPage(helper.adminUrl, agent.url));
      await page.getByRole('button', { name: 'Cancel' }).click();
      const fields = await agent.posted;
      expect(fields.get('error')).toBe('access_denied');
      expect(fields.get('state')).toBe('the-state');
      expect(fields.has('token')).toBe(false);
    } finally {
      agent.close();
    }
  });

  test('not signed in: sign in first, then back to the same page', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const url = connectPage(helper.adminUrl, 'http://127.0.0.1:9/callback');
    await page.goto(url);
    await page.waitForURL(/\/login\?/);
    const returnUrl = new URL(page.url()).searchParams.get('return_url');
    expect(returnUrl).toBe(url.slice(helper.adminUrl.length));
  });

  test('a sign-in the site no longer accepts: sign in again first, then back to the same page', async ({ page, urls }) => {
    // A deploy reset the site, which stopped accepting the tokens it had
    // issued. The page offered Allow on the dead one, and handed it to the
    // agent, whose every call then failed.
    const helper = new AdminUIHelper(page);
    await helper.login();
    const revoked = await fetch(`${urls.mockApi}/@mock-revoke-token`, {
      method: 'POST', headers: { Authorization: `Bearer ${helper.authToken}` },
    });
    expect(revoked.status).toBe(204);
    const url = connectPage(helper.adminUrl, 'http://127.0.0.1:9/callback');
    await page.goto(url);
    await page.waitForURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get('return_url')).toBe(url.slice(helper.adminUrl.length));
    await expect(page.getByRole('button', { name: 'Allow' })).toHaveCount(0);
  });

  for (const [what, redirectUri] of [
    ['another site', 'https://example.org/callback'],
    ['https on loopback', 'https://127.0.0.1:9/callback'],
    ['a name that only looks local', 'http://127.0.0.1.example.org/callback'],
  ]) {
    test(`refuses to send a token to ${what}`, async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await page.goto(connectPage(helper.adminUrl, redirectUri));
      await expect(page.getByText(/only to an agent on this computer or to this site.s MCP server/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Allow' })).toHaveCount(0);
    });
  }

  test('refuses a request without a state', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}/connect-agent?redirect_uri=${encodeURIComponent('http://127.0.0.1:9/callback')}`);
    await expect(page.getByText(/incomplete/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Allow' })).toHaveCount(0);
  });

  test("the MCP server's own sign-in, through this page", async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    const token = await connectInBrowser({
      adminUrl: helper.adminUrl,
      open: async (url: string) => {
        await page.goto(url);
        await page.getByRole('button', { name: 'Allow' }).click();
      },
    });
    expect(token).toBe(await heldToken(page));
    await expect(page.getByText('Connected. You can close this tab.')).toBeVisible();
  });

  test('the server signs in through the browser once, then renews the kept token without asking', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    const store = join(mkdtempSync(join(tmpdir(), 'inka-mcp-')), 'tokens.json');
    const env = { INKA_TOKEN_STORE: store };
    let asked = 0;
    const first = signIn(env, {
      adminUrl: helper.adminUrl,
      open: async (url: string) => {
        asked++;
        await page.goto(url);
        await page.getByRole('button', { name: 'Allow' }).click();
      },
    });
    const token = await first.token();
    expect(asked).toBe(1);
    expect(loadToken(store, helper.adminUrl)).toBe(token);

    // A later start: the kept token is renewed, and no one is asked.
    const later = signIn(env, {
      adminUrl: helper.adminUrl,
      open: async () => { throw new Error('should not ask again'); },
    });
    const renewed = await later.token();
    expect(renewed).not.toBe(token);
    expect(loadToken(store, helper.adminUrl)).toBe(renewed);
    // The renewed token is the person's: the API answers with it.
    const me = await fetch(`${helper.adminUrl}/++api++/_test_data/test-page`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${renewed}` },
    });
    expect(me.status).toBe(200);
  });
});
