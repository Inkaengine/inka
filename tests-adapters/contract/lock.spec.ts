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

const advertises = (capability: string) =>
  target.adapter.capabilities.includes(capability as never);

/**
 * Who is editing this right now.
 *
 * Not a nicety: without it two people overwrite each other with no warning, and
 * the loser finds out when their work is gone. Plone has it, and the admin asks
 * for it on every edit route — but only when the content says it can be locked,
 * which is what makes this a CONTRACT obligation rather than a feature:
 *
 *   an adapter whose `content.get` returns `fields.lock` MUST serve
 *   `content.lock` and `content.unlock`
 *
 * `fields` is where the canonical document keeps CMS-native extras, and
 * plonify spreads it to the top level — so `fields.lock` IS `content.lock` by
 * the time Volto reads it.
 *
 * Volto reads `content.lock !== undefined` and locks on that alone. Advertising
 * the field without the operations is how the editor came to die on a failed
 * lock: the throw became LOCK_CONTENT_FAIL, which shares a reducer branch with
 * GET_CONTENT_FAIL and sets `data: null`, so a failed LOCK wiped the loaded
 * CONTENT and no form rendered at all.
 */
describe('content.lock', () => {
  it('refuses when the CMS has no locking, and then promises no lock field', async (ctx) => {
    if (advertises('locking')) ctx.skip();
    await expect(
      target.adapter.dispatch('content.lock', { path: '/about' }),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });

    // The other half of the obligation. A `lock` field here would send the
    // admin after an operation this adapter just said it does not have.
    const content: any = await target.adapter.dispatch('content.get', {
      path: '/about',
    });
    expect(content.fields?.lock).toBeUndefined();
  });

  it('reports an unlocked document as unlocked', async (ctx) => {
    if (!advertises('locking')) ctx.skip();
    const content: any = await target.adapter.dispatch('content.get', {
      path: '/about',
    });
    expect(content.fields?.lock?.locked).toBe(false);
  });

  it('takes a lock, and says who holds it', async (ctx) => {
    if (!advertises('locking')) ctx.skip();
    const lock: any = await target.adapter.dispatch('content.lock', {
      path: '/about',
    });
    expect(lock.locked).toBe(true);
    // A token the holder can prove later — an unlock without one is a steal.
    expect(typeof lock.token).toBe('string');
    expect(lock.token.length).toBeGreaterThan(0);

    // And the document itself now says so, because that is where the admin
    // looks before deciding whether to warn.
    const content: any = await target.adapter.dispatch('content.get', {
      path: '/about',
    });
    expect(content.fields.lock.locked).toBe(true);
  });

  it('releases a lock it took', async (ctx) => {
    if (!advertises('locking')) ctx.skip();
    await target.adapter.dispatch('content.lock', { path: '/about' });
    const released: any = await target.adapter.dispatch('content.unlock', {
      path: '/about',
    });
    expect(released.locked).toBe(false);

    const content: any = await target.adapter.dispatch('content.get', {
      path: '/about',
    });
    expect(content.fields.lock.locked).toBe(false);
  });

  it('locking twice from the same session is not an error', async (ctx) => {
    if (!advertises('locking')) ctx.skip();
    // Entering edit, leaving by a route change that does not unlock, and
    // entering again is ordinary. Refusing the second would strand the editor
    // out of a document they themselves hold.
    await target.adapter.dispatch('content.lock', { path: '/about' });
    const again: any = await target.adapter.dispatch('content.lock', {
      path: '/about',
    });
    expect(again.locked).toBe(true);
  });

  it('rejects a path that does not exist', async (ctx) => {
    if (!advertises('locking')) ctx.skip();
    await expect(
      target.adapter.dispatch('content.lock', { path: '/no-such-page' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
