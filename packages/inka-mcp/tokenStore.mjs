/**
 * The tokens a person has connected the MCP server with, one per admin, in a
 * file only they can read (a token acts as them). Kept so that the browser
 * sign-in is needed again only once a token has expired.
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/** Where tokens are kept unless INKA_TOKEN_STORE says otherwise. */
export const DEFAULT_STORE = join(homedir(), '.config', 'inka-mcp', 'tokens.json');

function read(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

/** The token kept for `adminUrl`, or null. */
export function loadToken(file, adminUrl) {
  return read(file)[adminUrl] ?? null;
}

/** Keep `token` for `adminUrl`; the file and its folder are the owner's alone. */
export function saveToken(file, adminUrl, token) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ ...read(file), [adminUrl]: token }, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
}

function claims(token) {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('the token is not a JWT');
  return JSON.parse(Buffer.from(payload, 'base64url').toString());
}

/** When a token (a JWT) expires. */
export function expiresAt(token) {
  const { exp } = claims(token);
  if (!exp) throw new Error('the token has no expiry');
  return new Date(exp * 1000);
}

/** The user a token (a JWT) is for: its `sub`. */
export function subjectOf(token) {
  const { sub } = claims(token);
  if (!sub) throw new Error('the token names no user');
  return sub;
}
