/**
 * How the MCP server gets, and keeps, the token it acts with:
 *
 * - INKA_TOKEN: that token;
 * - INKA_USER + INKA_PASSWORD (+ INKA_API_URL): a login, for a site with
 *   plain accounts;
 * - otherwise, the person's own sign-in, through their browser (connect.mjs).
 *   The token is kept (tokenStore.mjs) and renewed on the next start, so the
 *   browser is needed again only once it has expired.
 *
 * Renewal goes through the admin's own API path (/++api++/@login-renew), so
 * the server needs only the admin's address.
 */
import { connectInBrowser, openInBrowser } from './connect.mjs';
import { DEFAULT_STORE, loadToken, saveToken, expiresAt } from './tokenStore.mjs';

// A kept token closer than this to expiring is not worth renewing.
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export class SignedOut extends Error {}

/**
 * `view` (the admin as the tools use it, for one user) telling `onSignedOut`
 * when a call finds the site no longer accepts the sign-in (SignedOut), before
 * the call fails, so whoever holds it stops using it.
 */
export function watchSignOut(view, onSignedOut) {
  const watched = (call) => async (...args) => {
    try {
      return await call(...args);
    } catch (error) {
      if (error instanceof SignedOut) onSignedOut();
      throw error;
    }
  };
  return Object.fromEntries(Object.entries(view).map(([name, call]) => [name, watched(call)]));
}

/** How long to wait before renewing `token`: half the time it has left. */
export function renewDelay(token, now = Date.now()) {
  return Math.max(0, (expiresAt(token).getTime() - now) / 2);
}

/** Renew `token` through the admin; SignedOut if the CMS no longer takes it. */
export async function renewThrough(adminUrl, token) {
  const response = await fetch(`${adminUrl}/++api++/@login-renew`, {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) throw new SignedOut('the CMS no longer accepts the token');
  if (!response.ok) throw new Error(`renewing the token answered ${response.status}`);
  return (await response.json()).token;
}

async function login(env) {
  const apiUrl = required(env, 'INKA_API_URL');
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}/@login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: required(env, 'INKA_USER'), password: required(env, 'INKA_PASSWORD') }),
  });
  if (!response.ok) throw new Error(`inka-mcp: login failed (${response.status})`);
  return (await response.json()).token;
}

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`inka-mcp: ${name} is not set`);
  return value;
}

/**
 * The server's sign-in for the admin at `adminUrl`: `token()` gets a token
 * (asking the person in their browser only if there is none to renew), and
 * `renew(token)` renews one as the server runs, keeping it if it was kept.
 */
export function signIn(env, { adminUrl, open = openInBrowser }) {
  const admin = adminUrl.replace(/\/$/, '');
  const kept = !env.INKA_TOKEN && !env.INKA_USER;
  const store = env.INKA_TOKEN_STORE || DEFAULT_STORE;
  const keep = (token) => {
    if (kept) saveToken(store, admin, token);
    return token;
  };
  return {
    async token() {
      if (env.INKA_TOKEN) return env.INKA_TOKEN;
      if (env.INKA_USER) return login(env);
      const saved = loadToken(store, admin);
      if (saved && expiresAt(saved).getTime() - Date.now() > EXPIRY_MARGIN_MS) {
        try {
          return keep(await renewThrough(admin, saved));
        } catch (error) {
          if (!(error instanceof SignedOut)) throw error;
        }
      }
      return keep(await connectInBrowser({ adminUrl: admin, open }));
    },
    async renew(token) {
      return keep(await renewThrough(admin, token));
    },
  };
}
