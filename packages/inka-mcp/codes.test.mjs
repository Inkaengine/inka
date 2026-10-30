import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { sealer } from './sealed.mjs';
import { localCodes, storedCodes, sealedCodes, CodeElsewhere, instanceOfCode } from './codes.mjs';

const DATA = { client: 'c-hash', redirect: 'r-hash', code_challenge: 'x'.repeat(43), plone: 'a.b.c' };

/** A store of the kind a deployment brings (a database, a key-value service), in memory. */
function fakeStore(clock) {
  const held = new Map();
  const live = (key) => {
    const entry = held.get(key);
    if (entry && entry.until <= clock.now) held.delete(key);
    return held.get(key)?.value ?? null;
  };
  return {
    async put(key, value, ttlMs) { held.set(key, { value, until: clock.now + ttlMs }); },
    async get(key) { return live(key); },
    async take(key) { const value = live(key); held.delete(key); return value; },
  };
}

/** Two instances of a store kind, sharing what that kind shares (nothing, a key, or a store). */
const KINDS = {
  local: (clock) => {
    const make = (instance) => localCodes({ instance, now: () => clock.now });
    return [make('one'), make('two')];
  },
  stored: (clock) => {
    const store = fakeStore(clock);
    return [storedCodes({ store, now: () => clock.now }), storedCodes({ store, now: () => clock.now })];
  },
  sealed: (clock) => {
    const key = randomBytes(32).toString('base64');
    return [sealedCodes({ box: sealer(key, () => clock.now) }), sealedCodes({ box: sealer(key, () => clock.now) })];
  },
};

for (const [kind, make] of Object.entries(KINDS)) {
  describe(`${kind} codes`, () => {
    it('gives back what a code was issued with, until it lapses after a minute', async () => {
      const clock = { now: 1_000_000 };
      const [codes] = make(clock);
      const code = await codes.issue(DATA);
      expect(await codes.peek(code)).toEqual(DATA);
      clock.now += 61_000;
      await expect(codes.take(code)).rejects.toThrow(InvalidGrantError);
    });

    it('refuses a code it never issued', async () => {
      const [codes] = make({ now: 1_000_000 });
      await expect(codes.take('made-up')).rejects.toThrow(InvalidGrantError);
    });

    if (kind !== 'sealed') {
      it('is good once', async () => {
        const [codes] = make({ now: 1_000_000 });
        const code = await codes.issue(DATA);
        expect(await codes.take(code)).toEqual(DATA);
        await expect(codes.take(code)).rejects.toThrow(InvalidGrantError);
      });
    }
  });
}

describe('codes on several instances', () => {
  it('stored and sealed codes are taken on any instance', async () => {
    for (const kind of ['stored', 'sealed']) {
      const [one, two] = KINDS[kind]({ now: 1_000_000 });
      expect(await two.take(await one.issue(DATA))).toEqual(DATA);
    }
  });

  it("a local code names its instance, and another instance says where it is instead of refusing it", async () => {
    const [one, two] = KINDS.local({ now: 1_000_000 });
    const code = await one.issue(DATA);
    expect(instanceOfCode(code)).toBe('one');
    const elsewhere = await two.take(code).catch((error) => error);
    expect(elsewhere).toBeInstanceOf(CodeElsewhere);
    expect(elsewhere.instance).toBe('one');
    expect(await one.take(code)).toEqual(DATA);
  });

  it('a local store on its own instance names none', async () => {
    const codes = localCodes({ instance: null, now: () => 1_000_000 });
    expect(instanceOfCode(await codes.issue(DATA))).toBeNull();
  });
});

describe('sealed codes', () => {
  it('are short enough to try with clients: under 400 characters with a real-sized Plone token', async () => {
    const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const ploneToken = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'jane.editor', exp: 1_900_000_000, fullname: 'Jane Editor' })}.${randomBytes(32).toString('base64url')}`;
    const codes = sealedCodes({ box: sealer(randomBytes(32).toString('base64')) });
    const code = await codes.issue({ ...DATA, client: 'k'.repeat(22), redirect: 'r'.repeat(22), plone: ploneToken });
    expect(code.length).toBeLessThan(400);
  });
});
