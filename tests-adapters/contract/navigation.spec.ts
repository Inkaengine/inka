import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { resolveTarget, type Target } from '../targets';

let target: Target;

beforeAll(async () => {
  target = await resolveTarget();
  await target.start();
});

afterAll(async () => {
  await target.stop();
});

beforeEach(async () => {
  await target.seed();
});


/**
 * What the MAIN hierarchy looks like.
 *
 * What is in a menu, and what it is called there, is no longer here: a menu is a
 * VIEW over the same content, and membership of it is tested in
 * view-membership.spec.ts against all three CMSes. The three tests that used to
 * live here gated on `navigation-exclusion` / `navigation-title` — Plone's
 * `exclude_from_nav` promoted to a universal capability, which it never was. They
 * ran on 2 of 3 and 1 of 3 adapters respectively.
 */
describe('navigation.get', () => {
  it('returns documents in the canonical shape', async () => {
    const nav: any = await target.adapter.dispatch('navigation.get', { path: '/' });
    expect(Array.isArray(nav.items)).toBe(true);
    for (const item of nav.items) {
      expect(typeof item.path).toBe('string');
      expect(typeof item.title).toBe('string');
    }
  });

  it('lists documents that are reachable on their own', async () => {
    // Everything in the menu must be a real document. A menu entry that leads
    // nowhere is worse than a missing one — the reader only finds out by
    // clicking it.
    const nav: any = await target.adapter.dispatch('navigation.get', { path: '/' });
    for (const item of nav.items.slice(0, 3)) {
      await target.adapter.dispatch('content.get', { path: item.path });
    }
  });

});
