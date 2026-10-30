/**
 * Where a one-time sign-in code waits between the callback that issues it and
 * the client's exchange (oauth.mjs). The exchange is sent by the client's own
 * server, not the person's browser: it carries none of the browser's cookies,
 * so with several instances of the MCP server it can reach any of them. Each
 * store answers that its own way:
 *
 * - local: held in this instance's memory, good once. A code names the
 *   instance that issued it, and another instance that gets it says where it
 *   is (CodeElsewhere), for the server to route the exchange there (http.mjs:
 *   a platform replay, or forwarding to the instance).
 * - stored: held in a store the deployment brings, which every instance
 *   reaches (a database, a key-value service): good once if its `take` is.
 * - sealed: the code is the data, sealed (sealed.mjs): any instance opens it,
 *   nothing is held. It can't be made good once; PKCE means a copy is no use
 *   without the client's verifier.
 *
 * Each has issue(data) -> code, peek(code) -> data, take(code) -> data (the
 * exchange: good once where the store can tell). A code that is unknown,
 * used or lapsed is an InvalidGrantError.
 */
import { randomBytes } from 'node:crypto';
import { InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { Unsealable } from './sealed.mjs';

const CODE_MS = 60 * 1000;
const SEPARATOR = '~';

/** A code issued by another instance's local store: `instance` holds it. */
export class CodeElsewhere extends Error {
  constructor(instance) {
    super(`the code is held by instance ${instance}`);
    this.instance = instance;
  }
}

/** The instance a local store's code names, or null (one that names none, or any other kind of code). */
export function instanceOfCode(code) {
  const at = String(code).indexOf(SEPARATOR);
  return at > 0 ? decodeURIComponent(String(code).slice(0, at)) : null;
}

const newId = () => randomBytes(24).toString('base64url');
const unknown = () => new InvalidGrantError('not a code from this server, or already used');
const lapsed = () => new InvalidGrantError('the code has lapsed; sign in again');

/** Codes in this instance's memory. `instance`: its name, or null when it is the only one. */
export function localCodes({ instance, now }) {
  const held = new Map();
  const find = (code, { use }) => {
    const owner = instanceOfCode(code);
    if (owner !== (instance ?? null)) {
      if (owner !== null && instance !== null) throw new CodeElsewhere(owner);
      throw unknown();
    }
    const entry = held.get(code);
    if (!entry) throw unknown();
    if (use) held.delete(code);
    if (entry.until <= now()) throw lapsed();
    return entry.data;
  };
  return {
    async issue(data) {
      for (const [code, entry] of held) if (entry.until <= now()) held.delete(code);
      const code = instance === null ? newId() : `${encodeURIComponent(instance)}${SEPARATOR}${newId()}`;
      held.set(code, { data, until: now() + CODE_MS });
      return code;
    },
    async peek(code) { return find(code, { use: false }); },
    async take(code) { return find(code, { use: true }); },
  };
}

/**
 * Codes in a store the deployment brings. `store` has put(key, value, ttlMs),
 * get(key) and take(key) (get it and remove it, at once if the store can, so
 * a code is good once), each resolving; get and take resolve null for a key
 * it doesn't hold. Values are strings.
 */
export function storedCodes({ store, now }) {
  const key = (code) => `inka-mcp:code:${code}`;
  const read = (stored) => {
    if (stored === null) throw unknown();
    const { data, until } = JSON.parse(stored);
    if (until <= now()) throw lapsed();
    return data;
  };
  return {
    async issue(data) {
      const code = newId();
      await store.put(key(code), JSON.stringify({ data, until: now() + CODE_MS }), CODE_MS);
      return code;
    },
    async peek(code) { return read(await store.get(key(code))); },
    async take(code) { return read(await store.take(key(code))); },
  };
}

// A sealed code's data, packed to keep the code short: these fields, in this
// order. Each is split at '.' (a JWT's parts), and each piece is its raw bytes
// where it is base64url (hashes, the PKCE challenge, a JWT's parts), else UTF-8.
const FIELDS = ['client', 'redirect', 'code_challenge', 'plone'];
const RAW = 1;
const TEXT = 0;

function pack(data) {
  const keys = Object.keys(data).sort();
  if (keys.join() !== [...FIELDS].sort().join()) throw new Error(`a sealed code holds ${FIELDS.join(', ')}, not ${keys.join(', ')}`);
  const out = [];
  for (const field of FIELDS) {
    const pieces = String(data[field]).split('.');
    out.push(Buffer.from([pieces.length]));
    for (const piece of pieces) {
      const raw = Buffer.from(piece, 'base64url');
      const asRaw = raw.toString('base64url') === piece;
      const bytes = asRaw ? raw : Buffer.from(piece, 'utf8');
      const head = Buffer.alloc(3);
      head.writeUInt8(asRaw ? RAW : TEXT, 0);
      head.writeUInt16BE(bytes.length, 1);
      out.push(head, bytes);
    }
  }
  return Buffer.concat(out);
}

function unpack(bytes) {
  const data = {};
  let at = 0;
  for (const field of FIELDS) {
    const pieces = [];
    const count = bytes.readUInt8(at);
    at += 1;
    for (let i = 0; i < count; i++) {
      const how = bytes.readUInt8(at);
      const length = bytes.readUInt16BE(at + 1);
      const piece = bytes.subarray(at + 3, at + 3 + length);
      at += 3 + length;
      pieces.push(how === RAW ? piece.toString('base64url') : piece.toString('utf8'));
    }
    data[field] = pieces.join('.');
  }
  return data;
}

/** Codes that are their own data, sealed by `box`. */
export function sealedCodes({ box }) {
  const open = (code) => {
    try {
      return unpack(box.openBytes('code', code));
    } catch (error) {
      if (!(error instanceof Unsealable)) throw error;
      if (/expired/.test(error.message)) throw lapsed();
      throw unknown();
    }
  };
  return {
    async issue(data) { return box.sealBytes('code', pack(data), CODE_MS); },
    async peek(code) { return open(code); },
    async take(code) { return open(code); },
  };
}
