/**
 * A fixed number of admin pages shared by every user of the server, so the
 * server's size is set by how many calls run at once, not by how many people
 * use it.
 *
 * A call borrows a page signed in as its user, and gives it back when done:
 * - the user's own page, if one is free: warm, it costs a page move (~0.5s);
 * - else a new page, while there are fewer than `size`;
 * - else the free page used longest ago, signed in afresh as this user (the
 *   slots' `assign`, which must leave nothing of the user before);
 * - else the call waits for one, up to `waitMs`.
 * A page is never given to two calls at once. One that can't be left cleanly
 * after a call (`park` failed) is closed, not handed on. One left idle longer
 * than `maxIdleMs` is signed in afresh before it is used again: the admin may
 * have been redeployed since, and a machine that suspends resumes its pages as
 * they were, still running the admin code they loaded.
 *
 * `slots` does the browser work: assign(slot, user) signs a page in as
 * `user` (a new page, or one wiped of whoever had it), retoken(slot, user)
 * gives it the user's renewed token, park(slot) leaves it between calls,
 * close(slot) closes it. A user is { id, token }.
 */
export function pagePool({ size, slots, waitMs = 120000, maxIdleMs = Infinity, now = Date.now }) {
  if (!(size >= 1)) throw new Error(`pagePool: size must be at least 1 (got ${size})`);
  const pages = [];
  const waiting = [];
  let used = 0;

  /** A free page for `user`, taken now (no await between choosing and taking it). */
  function take(user) {
    const free = pages.filter((p) => !p.busy);
    const own = free.find((p) => p.user?.id === user.id);
    if (own) {
      if (now() - own.freedAt > maxIdleMs) return { slot: own, prepare: 'assign' };
      return { slot: own, prepare: own.user.token === user.token ? null : 'retoken' };
    }
    if (pages.length < size) {
      const slot = {};
      pages.push(slot);
      return { slot, prepare: 'assign' };
    }
    if (free.length) {
      const oldest = free.reduce((a, b) => (a.lastUsed <= b.lastUsed ? a : b));
      return { slot: oldest, prepare: 'assign' };
    }
    return null;
  }

  async function acquire(user) {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const taken = take(user);
      if (taken) {
        const { slot, prepare } = taken;
        slot.busy = true;
        if (prepare) {
          try {
            await slots[prepare](slot, user);
          } catch (error) {
            await drop(slot);
            throw error;
          }
        }
        return slot;
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`all ${size} admin pages are busy; try again shortly`);
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting.splice(waiting.indexOf(wake), 1);
          resolve();
        }, left);
        const wake = () => { clearTimeout(timer); resolve(); };
        waiting.push(wake);
      });
    }
  }

  function release(slot) {
    slot.busy = false;
    slot.lastUsed = ++used;
    slot.freedAt = now();
    waiting.shift()?.();
  }

  async function drop(slot) {
    pages.splice(pages.indexOf(slot), 1);
    try {
      await slots.close(slot);
    } finally {
      waiting.shift()?.();
    }
  }

  return {
    /** Run `work(slot)` on a page signed in as `user`; the page is left (parked) after. */
    async use(user, work) {
      const slot = await acquire(user);
      let result;
      try {
        result = await work(slot);
      } catch (error) {
        await leave(slot);
        throw error;
      }
      await leave(slot);
      return result;
    },
    /** The pages open now, and how many are in use. */
    get stats() {
      return { open: pages.length, busy: pages.filter((p) => p.busy).length, size };
    },
    async close() {
      await Promise.all([...pages].map((slot) => slots.close(slot)));
      pages.length = 0;
    },
  };

  /** Park `slot` and give it back; a page that won't park is dropped, and the call fails. */
  async function leave(slot) {
    try {
      await slots.park(slot);
    } catch (error) {
      await drop(slot);
      throw error;
    }
    release(slot);
  }
}
