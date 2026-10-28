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
 * Nothing is stored: client ids, the pending sign-in, codes and tokens are
 * all sealed (sealed.mjs), and the access and refresh tokens carry the Plone
 * token, unreadable to the client. An access token ends before the Plone
 * token in it does; a refresh renews the Plone token, and when Plone won't,
 * the client is told to sign in again.
 */
import {
  InvalidGrantError, InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
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
 * `renew(ploneToken)`: a renewed Plone token, or SignedOut.
 */
export function oauthProvider({ box, adminUrl, callbackUrl, renew }) {
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
        const registered = { ...metadata, client_id_issued_at: Math.floor(Date.now() / 1000) };
        return { ...registered, client_id: box.seal('client', registered, null) };
      },
    },

    async authorize(client, params, res) {
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
        return back.href;
      }
      if (!token) throw new InvalidGrantError('the connect page sent no token');
      subjectOf(token);
      back.searchParams.set('code', box.seal('code', { ...pending, plone: token }, CODE_MS));
      return back.href;
    },

    async challengeForAuthorizationCode(client, code) {
      const data = open('code', code, InvalidGrantError);
      sameClient(data, client);
      return data.code_challenge;
    },

    async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
      const data = open('code', code, InvalidGrantError);
      sameClient(data, client);
      if (redirectUri && redirectUri !== data.redirect_uri) throw new InvalidGrantError('the redirect_uri differs from the one signed in with');
      return tokensFor(client, data.plone);
    },

    async exchangeRefreshToken(client, refreshToken) {
      const data = open('refresh', refreshToken, InvalidGrantError);
      sameClient(data, client);
      let renewed;
      try {
        renewed = await renew(data.plone);
      } catch (error) {
        if (error instanceof SignedOut) throw new InvalidGrantError(`the site signed this out (${error.message}); sign in again`);
        throw error;
      }
      return tokensFor(client, renewed);
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

