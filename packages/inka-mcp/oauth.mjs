/**
 * The hosted MCP server's sign-in: the OAuth authorization server the MCP
 * spec asks a remote server for, bridged to the site's own sign-in.
 *
 * A client (any MCP client) registers, then sends the person to `authorize`;
 * we send them on to the admin's /connect-agent page, where they sign in as
 * they always do and allow the client. The admin posts their Plone token to
 * our `callback`, which sends the client a code; the client trades the code
 * (with its PKCE verifier) for an access token and a refresh token.
 *
 * Little is stored: client ids, the pending sign-in and the tokens are sealed
 * (sealed.mjs), and the access and refresh tokens carry the Plone token,
 * unreadable to the client. The one-time code is the exception: a short
 * random id, held in memory for its minute and good once, because clients
 * expect a code to be short (Claude took a ~1,400-character sealed one and
 * never came back to exchange it). With several machines, a code must be
 * exchanged on the one that issued it. An access token ends before the Plone
 * token in it does; a refresh renews the Plone token, and when Plone won't,
 * the client is told to sign in again.
 */
import {
  InvalidGrantError, InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { randomBytes } from 'node:crypto';
import { Unsealable } from './sealed.mjs';
import { SignedOut } from './signIn.mjs';
import { expiresAt, subjectOf } from './tokenStore.mjs';

const PENDING_MS = 10 * 60 * 1000;
const CODE_MS = 60 * 1000;
const ACCESS_MS = 60 * 60 * 1000;
// An access token ends this long before the Plone token in it, so a refresh
// renews the Plone token while it still can.
const PLONE_MARGIN_MS = 5 * 60 * 1000;

/**
 * `box`: a sealer (sealed.mjs). `adminUrl`: the site's admin. `callbackUrl`:
 * where the admin's connect page posts (this server's /oauth/callback).
 * `renew(ploneToken)`: a renewed Plone token, or SignedOut. `log(line)`: each
 * sign-in step, for following one through (client names and return addresses;
 * never a code or token).
 */
export function oauthProvider({ box, adminUrl, callbackUrl, renew, log, now = Date.now }) {
  /** One-time codes: short id -> { data, until }, good once (see above). */
  const codes = new Map();
  const issueCode = (data) => {
    for (const [id, held] of codes) if (held.until <= now()) codes.delete(id);
    const id = randomBytes(24).toString('base64url');
    codes.set(id, { data, until: now() + CODE_MS });
    return id;
  };
  const codeData = (id, { use }) => {
    const held = codes.get(id);
    if (!held) throw new InvalidGrantError('not a code from this server, or already used');
    if (use) codes.delete(id);
    if (held.until <= now()) throw new InvalidGrantError('the code has lapsed; sign in again');
    return held.data;
  };
  /** Open a sealed token, turning a bad one into the OAuth error `Error`. */
  const open = (kind, token, Error) => {
    try {
      return box.open(kind, token);
    } catch (error) {
      if (error instanceof Unsealable) throw new Error(error.message);
      throw error;
    }
  };
  const sameClient = (data, client) => {
    if (data.client_id !== client.client_id) throw new InvalidGrantError('this was issued to another client');
  };
  /** Access and refresh tokens holding `ploneToken`, for `client`. */
  const tokensFor = (client, ploneToken) => {
    const ploneLeft = expiresAt(ploneToken).getTime() - Date.now();
    const accessMs = Math.min(ACCESS_MS, ploneLeft - PLONE_MARGIN_MS);
    if (accessMs <= 0) throw new InvalidGrantError('the sign-in to the site has run out; sign in again');
    const held = { client_id: client.client_id, plone: ploneToken };
    return {
      access_token: box.seal('access', { ...held, until: Date.now() + accessMs }, accessMs),
      token_type: 'Bearer',
      expires_in: Math.floor(accessMs / 1000),
      refresh_token: box.seal('refresh', held, ploneLeft),
    };
  };

  return {
    clientsStore: {
      getClient(clientId) {
        try {
          return { ...box.open('client', clientId), client_id: clientId };
        } catch (error) {
          if (error instanceof Unsealable) return undefined;
          throw error;
        }
      },
      registerClient(metadata) {
        log(`client registered: "${metadata.client_name}", returns to ${JSON.stringify(metadata.redirect_uris)}`);
        const registered = { ...metadata, client_id_issued_at: Math.floor(Date.now() / 1000) };
        return { ...registered, client_id: box.seal('client', registered, null) };
      },
    },

    async authorize(client, params, res) {
      log(`sign-in started by "${client.client_name}", to return to ${params.redirectUri}`);
      const pending = box.seal('pending', {
        client_id: client.client_id,
        redirect_uri: params.redirectUri,
        code_challenge: params.codeChallenge,
        state: params.state,
        resource: params.resource?.href,
      }, PENDING_MS);
      const connect = new URL(`${adminUrl}/connect-agent`);
      connect.searchParams.set('redirect_uri', callbackUrl);
      connect.searchParams.set('state', pending);
      if (client.client_name) connect.searchParams.set('client', client.client_name);
      res.redirect(connect.href);
    },

    /**
     * The admin's connect page answered (`token` on Allow, `error` on
     * Cancel, and our `state`): where to send the person's browser next.
     */
    async callback({ token, error, state }) {
      const pending = open('pending', state, InvalidGrantError);
      const back = new URL(pending.redirect_uri);
      if (pending.state !== undefined) back.searchParams.set('state', pending.state);
      if (error) {
        back.searchParams.set('error', 'access_denied');
        log(`sign-in declined; sending the browser to ${back.origin}${back.pathname}`);
        return back.href;
      }
      if (!token) throw new InvalidGrantError('the connect page sent no token');
      subjectOf(token);
      back.searchParams.set('code', issueCode({ ...pending, plone: token }));
      log(`sign-in allowed for ${subjectOf(token)}; sending the browser to ${back.origin}${back.pathname}`);
      return back.href;
    },

    async challengeForAuthorizationCode(client, code) {
      const data = codeData(code, { use: false });
      sameClient(data, client);
      return data.code_challenge;
    },

    async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
      try {
        const data = codeData(code, { use: true });
        sameClient(data, client);
        if (redirectUri && redirectUri !== data.redirect_uri) throw new InvalidGrantError('the redirect_uri differs from the one signed in with');
        const tokens = tokensFor(client, data.plone);
        log(`code exchanged by "${client.client_name}" for ${subjectOf(data.plone)}'s tokens`);
        return tokens;
      } catch (error) {
        log(`code exchange by "${client.client_name}" refused: ${error.message}`);
        throw error;
      }
    },

    async exchangeRefreshToken(client, refreshToken) {
      try {
        const data = open('refresh', refreshToken, InvalidGrantError);
        sameClient(data, client);
        let renewed;
        try {
          renewed = await renew(data.plone);
        } catch (error) {
          if (error instanceof SignedOut) throw new InvalidGrantError(`the site signed this out (${error.message}); sign in again`);
          throw error;
        }
        const tokens = tokensFor(client, renewed);
        log(`tokens refreshed by "${client.client_name}" for ${subjectOf(renewed)}`);
        return tokens;
      } catch (error) {
        log(`refresh by "${client.client_name}" refused: ${error.message}`);
        throw error;
      }
    },

    async verifyAccessToken(token) {
      const data = open('access', token, InvalidTokenError);
      return {
        token,
        clientId: data.client_id,
        scopes: [],
        expiresAt: Math.floor(data.until / 1000),
        extra: { user: subjectOf(data.plone), plone: data.plone },
      };
    },
  };
}

