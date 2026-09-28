import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { resolveTarget, type Target } from '../targets';

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

/**
 * Several operations, one intention.
 *
 * Layered like expansion: the base class applies the operations itself, so every
 * adapter serves `batch` whether or not its CMS has anything bulk — and an
 * adapter whose CMS DOES gets to group them (WordPress's /batch/v1 takes 25
 * requests per call; Plone's @import takes a whole subtree) without the caller
 * knowing which it is talking to. `batch-native` says grouping actually saves
 * round trips here, exactly as `expand-native` says asking the CMS beats
 * emulating it.
 *
 * Where it must NOT follow expansion: expansion is reads, so it runs them
 * concurrently and omits what a CMS cannot serve. These are writes. Order is
 * part of the meaning, a half-applied batch is a real state someone has to
 * recover from, and atomicity is a promise that cannot be emulated — so it is
 * asked for explicitly and refused honestly.
 */
describe('batch', () => {
  it('applies the operations in the order given', async () => {
    // Two writes to the same document. Out of order, the first would win, and
    // "it worked" would be indistinguishable from "it was reordered".
    await target.adapter.dispatch('batch', {
      operations: [
        {
          intent: 'content.update',
          args: { path: '/news/first-post', data: { title: 'First write' } },
        },
        {
          intent: 'content.update',
          args: { path: '/news/first-post', data: { title: 'Second write' } },
        },
      ],
    });

    const doc: any = await target.adapter.dispatch('content.get', {
      path: '/news/first-post',
    });
    expect(doc.title).toBe('Second write');
  });

  it('answers with a result per operation, in the same order', async () => {
    const result: any = await target.adapter.dispatch('batch', {
      operations: [
        { intent: 'content.get', args: { path: '/news/first-post' } },
        { intent: 'content.get', args: { path: '/news/draft-post' } },
      ],
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[0].path).toBe('/news/first-post');
    expect(result.results[1].path).toBe('/news/draft-post');
  });

  it('stops at the first failure and says which operation it was', async () => {
    // A batch that fails silently, or reports only "something went wrong", leaves
    // the caller unable to tell what was applied — which for an importer means
    // it cannot resume.
    const attempt = target.adapter.dispatch('batch', {
      operations: [
        {
          intent: 'content.update',
          args: { path: '/news/first-post', data: { title: 'Applied' } },
        },
        { intent: 'content.get', args: { path: '/does-not-exist' } },
        {
          intent: 'content.update',
          args: { path: '/news/draft-post', data: { title: 'Never reached' } },
        },
      ],
    });
    await expect(attempt).rejects.toMatchObject({ failedIndex: 1 });

    // The first one stood — a batch is not a transaction unless it says so.
    const applied: any = await target.adapter.dispatch('content.get', {
      path: '/news/first-post',
    });
    expect(applied.title).toBe('Applied');

    // And nothing after the failure ran.
    const untouched: any = await target.adapter.dispatch('content.get', {
      path: '/news/draft-post',
    });
    expect(untouched.title).not.toBe('Never reached');
  });

  it('either honours atomic or refuses it, never pretends', async () => {
    // Emulation cannot roll back. An adapter that quietly ignored `atomic` would
    // have callers believing in a guarantee they do not have, which is worse than
    // not offering it.
    const attempt = target.adapter.dispatch('batch', {
      atomic: true,
      operations: [
        {
          intent: 'content.update',
          args: { path: '/news/first-post', data: { title: 'Atomic attempt' } },
        },
        { intent: 'content.get', args: { path: '/does-not-exist' } },
      ],
    });

    let refused = false;
    await attempt.catch((error: any) => {
      refused = error?.code === 'NOT_IMPLEMENTED';
    });

    const doc: any = await target.adapter.dispatch('content.get', {
      path: '/news/first-post',
    });
    if (refused) {
      // Refused: nothing was attempted, so nothing changed.
      expect(doc.title).not.toBe('Atomic attempt');
    } else {
      // Honoured: the failing operation rolled the first one back.
      expect(doc.title).not.toBe('Atomic attempt');
    }
  });

  it('applies nothing when an atomic batch is refused by the CMS', async () => {
    // Only for an adapter that CLAIMS it can promise atomicity — the floor
    // refuses, and that is covered above. WordPress's /batch/v1 pre-flights every
    // request under require-all-or-none, so a batch containing one bad operation
    // must leave the good one unapplied too.
    if (!target.adapter.capabilities.includes('batch-native' as never)) return;

    const before: any = await target.adapter.dispatch('content.get', {
      path: '/news/first-post',
    });

    await expect(
      target.adapter.dispatch('batch', {
        atomic: true,
        operations: [
          {
            intent: 'content.update',
            args: {
              path: '/news/first-post',
              data: { title: 'All or nothing' },
            },
          },
          {
            intent: 'content.update',
            args: { path: '/does-not-exist', data: { title: 'Cannot apply' } },
          },
        ],
      }),
    ).rejects.toThrow();

    const after: any = await target.adapter.dispatch('content.get', {
      path: '/news/first-post',
    });
    expect(after.title).toBe(before.title);
  });

  it('is served by every adapter, with or without a native bulk facility', async () => {
    // No capability gate on the floor. An importer that had to ask "can you
    // batch?" and keep its own fallback would make the layer pointless.
    const result: any = await target.adapter.dispatch('batch', {
      operations: [{ intent: 'content.get', args: { path: '/news' } }],
    });
    expect(result.results).toHaveLength(1);
  });
});
