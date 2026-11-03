/**
 * The mock site's login tokens: JWTs signed with the site's key, as Plone's
 * are. The mock accepts only the ones that verify; any other token makes a
 * request anonymous, as in Plone (mock-plone-api.cjs, requestUser).
 *
 * The key is fixed, like a deployment's JWT_SECRET, so a test can mint a token
 * the mock accepts without asking it (mintToken): AdminUIHelper gives each
 * test its own, which keeps the mock's per-token sessions apart.
 */
const { createHmac, randomUUID, timingSafeEqual } = require('node:crypto');

const SITE_KEY = 'inka-mock-site-key';

const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = (unsigned) => createHmac('sha256', SITE_KEY).update(unsigned).digest('base64url');

/** A token the mock site issued for `user`, good for a day (as Plone's default). */
function mintToken(user) {
  const unsigned = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({
    sub: user,
    exp: Math.floor(Date.now() / 1000) + 86400,
    // Unique, so every token is its own mock session (see getSessionId): with
    // only {sub, exp}, at second granularity, two sign-ins in the same second
    // got the same token and silently shared one session.
    jti: randomUUID(),
  })}`;
  return `${unsigned}.${sign(unsigned)}`;
}

/** `token`'s payload if the site signed it and it has not expired; else null. */
function verifyToken(token) {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) return null;
  const expected = Buffer.from(sign(`${header}.${payload}`));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (claims.exp * 1000 <= Date.now()) return null;
  return claims;
}

module.exports = { mintToken, verifyToken };
