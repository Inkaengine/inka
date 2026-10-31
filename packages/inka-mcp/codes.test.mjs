import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { sealer } from './sealed.mjs';
import {
  localCodes, storedCodes, sealedCodes, CodeElsewhere, instanceOfCode, localPictures, storedPictures, PictureGone,
} from './codes.mjs';

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

// The pictures a client's view fetches (server.mjs: the `picture` tool) are
// held the way codes are: a client that shows views (Claude) hands a view the
// tool's result without its pictures, so the view asks for them by id, maybe
// on another instance. Sealed, nothing is held anywhere, and a picture is too
// big to travel in its id: there is no sealed picture store.
const PICTURE = { user: 'jane', mimeType: 'image/png', data: 'iVBORw0KGgo' };

const PICTURE_KINDS = {
  local: (clock) => ['one', 'two'].map((instance) => localPictures({ instance, now: () => clock.now })),
  stored: (clock) => {
    const store = fakeStore(clock);
    return [storedPictures({ store, now: () => clock.now }), storedPictures({ store, now: () => clock.now })];
  },
};

for (const [kind, make] of Object.entries(PICTURE_KINDS)) {
  describe(`${kind} pictures`, () => {
    it('gives a picture back as often as it is asked for, for ten minutes', async () => {
      const clock = { now: 1_000_000 };
      const [pictures] = make(clock);
      const id = await pictures.issue(PICTURE);
      expect(await pictures.peek(id)).toEqual(PICTURE);
      clock.now += 9 * 60_000;
      expect(await pictures.peek(id)).toEqual(PICTURE);
      clock.now += 2 * 60_000;
      await expect(pictures.peek(id)).rejects.toThrow(PictureGone);
    });

    it('refuses an id it never issued', async () => {
      const [pictures] = make({ now: 1_000_000 });
      await expect(pictures.peek('made-up')).rejects.toThrow(PictureGone);
    });
  });
}

describe('pictures on several instances', () => {
  it('a stored picture is had on any instance', async () => {
    const [one, two] = PICTURE_KINDS.stored({ now: 1_000_000 });
    expect(await two.peek(await one.issue(PICTURE))).toEqual(PICTURE);
  });

  it('a local picture names its instance, and another instance says where it is', async () => {
    const [one, two] = PICTURE_KINDS.local({ now: 1_000_000 });
    const id = await one.issue(PICTURE);
    expect(instanceOfCode(id)).toBe('one');
    const elsewhere = await two.peek(id).catch((error) => error);
    expect(elsewhere).toBeInstanceOf(CodeElsewhere);
    expect(elsewhere.instance).toBe('one');
  });

  it('a stored picture is kept apart from the codes in the same store', async () => {
    const clock = { now: 1_000_000 };
    const store = fakeStore(clock);
    const pictures = storedPictures({ store, now: () => clock.now });
    const codes = storedCodes({ store, now: () => clock.now });
    await expect(codes.take(await pictures.issue(PICTURE))).rejects.toThrow(InvalidGrantError);
  });
});
