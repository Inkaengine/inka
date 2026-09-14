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
 * One representative intent per capability. If an adapter advertises the
 * capability, this call must work; if it does not, the call must fail cleanly
 * rather than half-working.
 */
const PROBES: Record<string, () => Promise<unknown>> = {
  content: () =>
    target.adapter.dispatch('content.get', { path: '/news/first-post' }),
  'search-fulltext': () => target.adapter.dispatch('search', { query: 'First' }),
  'search-filter': () => target.adapter.dispatch('tree.list', { parent: '/news' }),
  vocabulary: () =>
    target.adapter.dispatch('vocabulary.get', {
      name: target.vocabularies.categories,
      limit: 1,
    }),
  schema: () => target.adapter.dispatch('types.list', {}),
  asset: () =>
    target.adapter.dispatch('asset.imageUrl', {
      path: '/news/first-post',
      field: 'image',
      scale: 'preview',
    }),
  workflow: () => target.adapter.dispatch('workflow.get', { path: '/about' }),
  versioning: () => target.adapter.dispatch('revisions.list', { path: '/about' }),
  sharing: () => target.adapter.dispatch('permissions.get', { path: '/about' }),
  comments: () => target.adapter.dispatch('comments.list', { path: '/about' }),
};

describe('advertised capabilities are real', () => {
  it('declares at least one capability', () => {
    expect(target.adapter.capabilities.length).toBeGreaterThan(0);
  });

  for (const capability of Object.keys(PROBES)) {
    it(`${capability}: behaviour matches what the adapter advertises`, async () => {
      const advertised = target.adapter.capabilities.includes(capability as any);

      if (!advertised) {
        // An unadvertised capability must say so, not 500 or silently return
        // an empty result that the UI would render as "no items".
        await expect(PROBES[capability]()).rejects.toMatchObject({
          code: 'NOT_IMPLEMENTED',
        });
        return;
      }

      // Advertised: the intent must resolve, OR fail for a reason about THIS
      // request rather than about the feature being absent. asset.imageUrl on
      // a document with no image is a legitimate NOT_FOUND, for instance.
      try {
        await PROBES[capability]();
      } catch (err: any) {
        expect(err.code).not.toBe('NOT_IMPLEMENTED');
        expect(err.code).toBeDefined();
      }
    });
  }
});

/**
 * Screens the CMS answers for itself.
 *
 * An adapter may hand back toolbar entries pointing at its own admin — the
 * media library, the settings page, an edit form — rather than have Volto
 * reimplement each one. Optional by design: a CMS content with Volto's screens
 * declares nothing and this asserts nothing about it.
 *
 * What it does insist on is that a declared entry can actually be followed.
 * These leave the admin entirely, so a relative path or a link back to the
 * admin's own origin is not a lesser version of the feature — it is a dead end
 * for the user, and one that would only be discovered by clicking it.
 */
describe('native actions', () => {
  it('offer a way to manage your own profile', async () => {
    // Declared actions currently ride on PermissionsAndState.
    if (!target.adapter.capabilities.includes('state' as never)) return;

    const pas: any = await target.adapter.dispatch('state.get', {
      path: '/news/first-post',
    });
    const declared = pas.actions ?? [];

    // An adapter on the http passthrough does not need to declare anything:
    // Volto receives the CMS's OWN user actions verbatim, and Plone's include
    // `preferences`. Everyone else has to say where a profile lives, because
    // there is nothing for the admin to fall back on — and a profile is not
    // something we reimplement. Changing your password or your email belongs to
    // the CMS that owns the account.
    if (target.adapter.capabilities.includes('http-passthrough' as never)) return;

    const profile = declared.filter((a: any) => a.category === 'user');
    expect(
      profile.length,
      'no user-category action, so an editor cannot reach their own profile',
    ).toBeGreaterThan(0);

    for (const action of profile) {
      // It has to leave the admin for the CMS. A link back to our own origin is
      // a dead end the user only finds by clicking it.
      expect(action.url, `${action.id} needs a destination`).toMatch(/^https?:\/\//);
    }
  });

  it('point somewhere followable, on the CMS', async () => {
    // Declared actions currently ride on PermissionsAndState, so an adapter
    // without `state` has nowhere to put them and this asserts nothing about
    // it. (That they live there at all is a wart: a CMS can have its own
    // screens without having workflow.)
    if (!target.adapter.capabilities.includes('state' as never)) return;

    const pas: any = await target.adapter.dispatch('state.get', {
      path: '/news/first-post',
    });

    const declared = pas.actions ?? [];
    const seen = new Set<string>();

    for (const action of declared) {
      expect(typeof action.id).toBe('string');
      expect(action.id.length).toBeGreaterThan(0);
      expect(typeof action.title).toBe('string');
      expect(action.title.length).toBeGreaterThan(0);

      // Ids address the entry — a duplicate silently overrides its twin.
      expect(seen.has(action.id)).toBe(false);
      seen.add(action.id);

      if (action.url !== undefined) {
        expect(action.url).toMatch(/^https?:\/\//);
      }
      if (action.target !== undefined) {
        expect(['window', 'iframe']).toContain(action.target);
      }
      if (action.category !== undefined) {
        expect(['object', 'object-buttons', 'site', 'user']).toContain(
          action.category,
        );
      }
    }
  });
});
