/**
 * Sealed tokens: what the hosted server hands out (client ids, sign-in codes,
 * access and refresh tokens) is the data it needs back, encrypted and
 * authenticated with a key only the server has (AES-256-GCM). The server
 * keeps nothing: a token brings its own state, and whoever holds it can
 * neither read it nor change it.
 *
 * Each token is sealed as a kind ('client', 'code', 'access', …), so one
 * can't stand in for another, and most carry an expiry.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class Unsealable extends Error {}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** A sealer for `key`: 32 bytes, base64 (INKA_MCP_SECRET). */
export function sealer(key) {
  const secret = Buffer.from(key, 'base64');
  if (secret.length !== 32) throw new Error(`the sealing key must be 32 bytes (base64), not ${secret.length}`);
  return {
    /** Seal `data` as `kind`, good for `ttlMs` (null: no expiry). */
    seal(kind, data, ttlMs) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', secret, iv);
      const body = JSON.stringify({ kind, exp: ttlMs === null ? null : Date.now() + ttlMs, data });
      const sealed = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, sealed, cipher.getAuthTag()]).toString('base64url');
    },
    /** What `token` holds, if it was sealed here as `kind` and hasn't expired; else Unsealable. */
    open(kind, token) {
      const bytes = Buffer.from(String(token), 'base64url');
      if (bytes.length <= IV_BYTES + TAG_BYTES) throw new Unsealable('not a token from this server');
      const decipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(0, IV_BYTES));
      decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
      let body;
      try {
        body = Buffer.concat([decipher.update(bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES)), decipher.final()]);
      } catch (error) {
        // GCM's authentication failed: changed, or sealed with another key.
        if (error.message.includes('authenticate')) throw new Unsealable('not a token from this server');
        throw error;
      }
      const { kind: sealedAs, exp, data } = JSON.parse(body.toString('utf8'));
      if (sealedAs !== kind) throw new Unsealable(`a ${sealedAs} token, not a ${kind} token`);
      if (exp !== null && exp <= Date.now()) throw new Unsealable(`the ${kind} token has expired`);
      return data;
    },
  };
}
