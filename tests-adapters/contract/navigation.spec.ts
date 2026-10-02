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

const advertises = (capability: string) =>
  target.adapter.capabilities.includes(capability as never);

/**
 * What appears in the menu, and what it is called there.
 *
 * Navigation is not the same question as workflow state, and the difference is
 * the point of these: a document kept out of the menu is still readable by
 * anyone holding its address. Conflating the two would have editors
 * unpublishing pages to tidy a menu.
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

  it('can hide a document from the menu without unpublishing it', async () => {
    if (!advertises('navigation-exclusion')) return;

    const before: any = await target.adapter.dispatch('navigation.get', { path: '/' });
    const victim = before.items[0];
    expect(victim, 'nothing in the menu to hide').toBeDefined();

    await target.adapter.dispatch('navigation.setExcluded', {
      path: victim.path,
      excluded: true,
    });

    const after: any = await target.adapter.dispatch('navigation.get', { path: '/' });
    expect(after.items.map((i: any) => i.path)).not.toContain(victim.path);

    // Still there, still readable. Hiding from a menu is not a state change.
    const doc: any = await target.adapter.dispatch('content.get', {
      path: victim.path,
    });
    expect(doc.path).toBe(victim.path);
  });

  it('a document kept out of the menu is still findable and editable', async () => {
    if (!advertises('navigation-exclusion')) return;

    const before: any = await target.adapter.dispatch('navigation.get', { path: '/' });
    const victim = before.items[0];
    expect(victim).toBeDefined();

    const doc: any = await target.adapter.dispatch('content.get', {
      path: victim.path,
    });

    await target.adapter.dispatch('navigation.setExcluded', {
      path: victim.path,
      excluded: true,
    });

    // Out of the menu is not out of the CMS, and BROWSABLE is the requirement —
    // not merely findable if you already know what to search for. The Contents
    // view is how an editor reaches a document they cannot see in the menu, so
    // it has to still be listed there. Otherwise "hide from navigation" is a
    // one-way door whose only way back is the native screen we were trying not
    // to send them to.
    const listing: any = await target.adapter.dispatch('tree.list', {
      parent: '/',
    });
    expect(listing.items.map((i: any) => i.path)).toContain(victim.path);

    // And still writable, which is the half that would fail quietly: on a CMS
    // where the menu IS the hierarchy, a document with no link can lose the
    // place edits are addressed to.
    await target.adapter.dispatch('content.update', {
      path: victim.path,
      data: { title: `${doc.title} (edited while hidden)` },
    });
    const after: any = await target.adapter.dispatch('content.get', {
      path: victim.path,
    });
    expect(after.title).toBe(`${doc.title} (edited while hidden)`);
  });

  it('can call a document something else in the menu', async () => {
    if (!advertises('navigation-title')) return;

    const before: any = await target.adapter.dispatch('navigation.get', { path: '/' });
    const item = before.items[0];
    expect(item, 'nothing in the menu to rename').toBeDefined();

    await target.adapter.dispatch('navigation.setTitle', {
      path: item.path,
      title: 'Shorter',
    });

    const after: any = await target.adapter.dispatch('navigation.get', { path: '/' });
    const renamed = after.items.find((i: any) => i.path === item.path);
    expect(renamed.title).toBe('Shorter');

    // The DOCUMENT keeps its own title. That separation is the whole feature.
    const doc: any = await target.adapter.dispatch('content.get', {
      path: item.path,
    });
    expect(doc.title).not.toBe('Shorter');
  });
});
