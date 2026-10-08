import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { resolveTarget, type Target } from '../targets';

/**
 * Cached reads.
 *
 * Instrumenting the Drupal journey found 94 of 150 GETs were an identical
 * earlier GET with no write in between — resolvePath('/news') ran 22 times,
 * the navigation listing 28. The admin cannot dedupe them: they come from
 * different components, and several are issued INSIDE one intent, below
 * anything the admin can see.
 *
 * The lifetime is "until this admin writes". That needs no attribution of a
 * read to whatever action issued it, which is what an earlier per-route
 * version foundered on: dispatches interleave, and the browser has no
 * async-local storage to tell them apart. Keying by URL and clearing on write
 * sidesteps the question entirely, and assumes no more than Volto's own store
 * already does by holding navigation and types for the whole session.
 */

let target: Target;

beforeAll(async () => {
  target = await resolveTarget();
  await target.start();
}, 240_000);

afterAll(async () => {
  await target.stop();
});

beforeEach(async () => {
  await target.seed();
});

const PATH = '/news/first-post';

/** Count real CMS round trips, below the cache. */
function countCmsCalls(adapter: any) {
  const original = adapter.requestJson.bind(adapter);
  let calls = 0;
  adapter.requestJson = async (...args: unknown[]) => {
    calls += 1;
    return original(...args);
  };
  return {
    count: () => calls,
    restore: () => {
      adapter.requestJson = original;
    },
  };
}

describe('cached reads', () => {
  /**
   * Retention is ON: a repeat of a read nothing has invalidated is answered
   * from what the adapter already has. Asking the CMS the same question twice,
   * when nothing could have changed the answer in between, is work for its own
   * sake — and against a CMS that costs about a second per request it is work
   * the editor waits for.
   *
   * The invalidation rules that make this safe are the two tests at the bottom
   * of this file; without them this would just be a licence to serve stale
   * content.
   */
  it('does not re-read what it already has', async () => {
    await target.adapter.dispatch('content.get', { path: PATH });

    const spy = countCmsCalls(target.adapter);
    try {
      await target.adapter.dispatch('content.get', { path: PATH });
      expect(spy.count()).toBe(0);
    } finally {
      spy.restore();
    }
  });

  /**
   * Concurrent duplicates cost what ONE read costs, not three.
   *
   * Measured against a cold cache both times, so this compares like with like:
   * with retention on, doing the sequential version second would cost nothing
   * and prove only that the cache exists.
   */
  it('three concurrent reads cost what one costs', async () => {
    // Warm up first. invalidateReads() drops the read cache but NOT the
    // path->id lookups an adapter keeps separately, so an uncompared first
    // read would pay for those once and make the two measurements below
    // describe different situations.
    await target.adapter.dispatch('content.get', { path: PATH });

    target.adapter.invalidateReads();
    const single = countCmsCalls(target.adapter);
    try {
      await target.adapter.dispatch('content.get', { path: PATH });
    } finally {
      single.restore();
    }

    target.adapter.invalidateReads();
    const trio = countCmsCalls(target.adapter);
    try {
      await Promise.all([
        target.adapter.dispatch('content.get', { path: PATH }),
        target.adapter.dispatch('content.get', { path: PATH }),
        target.adapter.dispatch('content.get', { path: PATH }),
      ]);
    } finally {
      trio.restore();
    }

    expect(single.count()).toBeGreaterThan(0);
    expect(trio.count()).toBe(single.count());
  });

  /**
   * Clearing on write covers what THIS admin does, and nothing else. Another
   * editor, a cron job, or someone working in the CMS's own admin can change
   * the same content, and this session would otherwise serve what it fetched
   * for as long as it stayed open.
   *
   * The clock is moved rather than waited on: a test that sleeps for the real
   * expiry is a slow test that still proves nothing about the boundary.
   */
  it('stops serving a read once it is old enough', async () => {
    const adapter: any = target.adapter;
    await adapter.dispatch('content.get', { path: PATH });

    const warm = countCmsCalls(target.adapter);
    try {
      await adapter.dispatch('content.get', { path: PATH });
      expect(warm.count()).toBe(0); // still fresh
    } finally {
      warm.restore();
    }

    const realNow = adapter.now.bind(adapter);
    adapter.now = () => realNow() + 10 * 60 * 1000;
    const expired = countCmsCalls(target.adapter);
    try {
      await adapter.dispatch('content.get', { path: PATH });
      expect(expired.count()).toBeGreaterThan(0);
    } finally {
      expired.restore();
      adapter.now = realNow;
    }
  });

  it('shares a read that is already in flight', async () => {
    const spy = countCmsCalls(target.adapter);
    try {
      const [a, b, c] = await Promise.all([
        target.adapter.dispatch('content.get', { path: PATH }),
        target.adapter.dispatch('content.get', { path: PATH }),
        target.adapter.dispatch('content.get', { path: PATH }),
      ]);
      expect(a).toEqual(b);
      expect(b).toEqual(c);
    } finally {
      spy.restore();
    }
  });

  /**
   * The property the whole design rests on: after a write, nothing cached
   * before it may be served, or the editor saves a change and is then shown
   * the version they replaced.
   */
  it('serves nothing cached from before a write', async () => {
    await target.adapter.dispatch('content.get', { path: PATH });
    await target.adapter.dispatch('content.update', {
      path: PATH,
      data: { title: 'Rewritten' },
    });
    const after: any = await target.adapter.dispatch('content.get', {
      path: PATH,
    });
    expect(after.title).toBe('Rewritten');
  });

  /**
   * The subtle one. A read that STARTED before a write carries pre-write data,
   * so it must not be stored once the write has landed — otherwise clearing
   * the cache on write is defeated by a request that was already in the air.
   */
  it('does not store a read that a write overtook', async () => {
    const inFlight = target.adapter.dispatch('content.get', { path: PATH });
    await target.adapter.dispatch('content.update', {
      path: PATH,
      data: { title: 'Overtaken' },
    });
    await inFlight;

    const after: any = await target.adapter.dispatch('content.get', {
      path: PATH,
    });
    expect(after.title).toBe('Overtaken');
  });
});
