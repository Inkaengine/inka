import { describe, it, expect } from 'vitest';
import { pagePool } from './pagePool.mjs';

/** Slots that record what was done to them, each signed in as `slot.user`. */
function fakeSlots({ parkFails = () => false } = {}) {
  const log = [];
  let made = 0;
  return {
    log,
    slots: {
      async assign(slot, user) {
        slot.name ??= `slot${++made}`;
        log.push(`assign ${slot.name} ${user.id}`);
        slot.user = { ...user };
      },
      async retoken(slot, user) {
        log.push(`retoken ${slot.name} ${user.id}`);
        slot.user = { ...user };
      },
      async park(slot) {
        if (parkFails(slot)) throw new Error('the page broke');
      },
      async close(slot) {
        log.push(`close ${slot.name}`);
      },
    },
  };
}

const jane = { id: 'jane', token: 't-jane' };
const bob = { id: 'bob', token: 't-bob' };
const ann = { id: 'ann', token: 't-ann' };

describe('pagePool', () => {
  it("keeps a user's page for their next call", async () => {
    const { log, slots } = fakeSlots();
    const pool = pagePool({ size: 2, slots });
    const first = await pool.use(jane, async (slot) => slot.name);
    const second = await pool.use(jane, async (slot) => slot.name);
    expect(second).toBe(first);
    expect(log).toEqual(['assign slot1 jane']);
  });

  it('opens pages up to its size, then hands the least recently used one to the next user', async () => {
    const { log, slots } = fakeSlots();
    const pool = pagePool({ size: 2, slots });
    await pool.use(jane, async () => {});
    await pool.use(bob, async () => {});
    await pool.use(jane, async () => {});
    // bob's page is the one used longest ago: ann gets it, signed in afresh.
    expect(await pool.use(ann, async (slot) => slot.name)).toBe('slot2');
    expect(log).toEqual(['assign slot1 jane', 'assign slot2 bob', 'assign slot2 ann']);
  });

  it('never gives one page to two calls at once', async () => {
    const { slots } = fakeSlots();
    const pool = pagePool({ size: 2, slots });
    const inUse = new Set();
    const call = (user) => pool.use(user, async (slot) => {
      expect(inUse.has(slot)).toBe(false);
      inUse.add(slot);
      await new Promise((r) => setTimeout(r, 20));
      inUse.delete(slot);
    });
    await Promise.all([call(jane), call(jane), call(bob), call(ann), call(jane)]);
  });

  it('makes a call wait while every page is busy, and gives up after waitMs', async () => {
    const { slots } = fakeSlots();
    const pool = pagePool({ size: 1, slots, waitMs: 50 });
    let release;
    const busy = pool.use(jane, () => new Promise((r) => { release = r; }));
    await expect(pool.use(bob, async () => {})).rejects.toThrow(/all 1 admin pages are busy/);
    const waiting = pool.use(bob, async (slot) => slot.user.id);
    release();
    await busy;
    expect(await waiting).toBe('bob');
  });

  it("takes a user's renewed token on their page, without signing in afresh", async () => {
    const { log, slots } = fakeSlots();
    const pool = pagePool({ size: 1, slots });
    await pool.use(jane, async () => {});
    expect(await pool.use({ ...jane, token: 't-jane-2' }, async (slot) => slot.user.token)).toBe('t-jane-2');
    expect(log).toEqual(['assign slot1 jane', 'retoken slot1 jane']);
  });

  it("drops a page that couldn't be left cleanly, and opens a new one for the next call", async () => {
    let broken = true;
    const { log, slots } = fakeSlots({ parkFails: () => broken });
    const pool = pagePool({ size: 1, slots });
    await expect(pool.use(jane, async () => 'done')).rejects.toThrow(/the page broke/);
    broken = false;
    expect(await pool.use(jane, async (slot) => slot.name)).toBe('slot2');
    expect(log).toEqual(['assign slot1 jane', 'close slot1', 'assign slot2 jane']);
  });

  it("returns the call's error, and the page goes back to the pool", async () => {
    const { log, slots } = fakeSlots();
    const pool = pagePool({ size: 1, slots });
    await expect(pool.use(jane, async () => { throw new Error('no such page'); })).rejects.toThrow('no such page');
    await pool.use(jane, async () => {});
    expect(log).toEqual(['assign slot1 jane']);
  });

  it('closes every page', async () => {
    const { log, slots } = fakeSlots();
    const pool = pagePool({ size: 2, slots });
    await Promise.all([pool.use(jane, async () => {}), pool.use(bob, async () => {})]);
    await pool.close();
    expect(log.filter((l) => l.startsWith('close')).sort()).toEqual(['close slot1', 'close slot2']);
  });
});
