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

/** A sealer for `key`: 32 bytes, base64 (INKA_MCP_SECRET). `now`: the clock expiries are read by. */
export function sealer(key, now = Date.now) {
  const secret = Buffer.from(key, 'base64');
  if (secret.length !== 32) throw new Error(`the sealing key must be 32 bytes (base64), not ${secret.length}`);
  return {
    /** Seal `data` as `kind`, good for `ttlMs` (null: no expiry). */
    seal(kind, data, ttlMs) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', secret, iv);
      const body = JSON.stringify({ kind, exp: ttlMs === null ? null : now() + ttlMs, data });
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
      if (exp !== null && exp <= now()) throw new Unsealable(`the ${kind} token has expired`);
      return data;
    },
    /**
     * Seal raw `bytes` as `kind`, for a token that must be short: the kind is
     * authenticated without being carried, and the expiry takes 6 bytes.
     */
    sealBytes(kind, bytes, ttlMs) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', secret, iv);
      cipher.setAAD(Buffer.from(kind));
      const exp = Buffer.alloc(6);
      exp.writeUIntBE(now() + ttlMs, 0, 6);
      const sealed = Buffer.concat([cipher.update(Buffer.concat([exp, bytes])), cipher.final()]);
      return Buffer.concat([iv, sealed, cipher.getAuthTag()]).toString('base64url');
    },
    /** The bytes `token` holds, if sealBytes sealed it here as `kind` and it hasn't expired; else Unsealable. */
    openBytes(kind, token) {
      const bytes = Buffer.from(String(token), 'base64url');
      if (bytes.length <= IV_BYTES + TAG_BYTES + 6) throw new Unsealable('not a token from this server');
      const decipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(0, IV_BYTES));
      decipher.setAAD(Buffer.from(kind));
      decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
      let body;
      try {
        body = Buffer.concat([decipher.update(bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES)), decipher.final()]);
      } catch (error) {
        // GCM's authentication failed: changed, another kind, or another key.
        if (error.message.includes('authenticate')) throw new Unsealable('not a token from this server');
        throw error;
      }
      if (body.readUIntBE(0, 6) <= now()) throw new Unsealable(`the ${kind} token has expired`);
      return body.subarray(6);
    },
  };
}
