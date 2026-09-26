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
 * One document in several languages, linked as a group.
 *
 * Not a language field and not a translated interface: a set of documents that
 * know about each other, so an editor can move between them and the reader is
 * served the one in their language.
 *
 * A CMS that cannot do this must not claim `multilingual` — the admin gates
 * every translation affordance on the claim, and offering to create a
 * translation that cannot exist wastes the editor's work at the save.
 */
describe('translations', () => {
  it('rejects the whole group when it does not claim multilingual', async () => {
    if (advertises('multilingual')) return;
    // Honest refusal, not an empty answer: an empty group reads as "this
    // document has no translations yet", which invites the editor to make one.
    await expect(
      target.adapter.dispatch('translations.get', { path: '/news' }),
    ).rejects.toThrow();
  });

  it('answers with a group, empty or not', async () => {
    if (!advertises('multilingual')) return;
    const group: any = await target.adapter.dispatch('translations.get', {
      path: '/news',
    });
    expect(Array.isArray(group.items)).toBe(true);
    for (const item of group.items) {
      expect(typeof item.language).toBe('string');
      // A path, not a URL: every other intent here takes and returns paths, and
      // a URL would make the caller strip an origin the adapter knows better.
      expect(item.path.startsWith('/')).toBe(true);
    }
  });

  it('says where a translation belongs rather than assuming', async () => {
    if (!advertises('multilingual')) return;
    // The CMS decides: plone.app.multilingual walks up for the closest
    // translated parent, which is not always the language's root folder.
    const place: any = await target.adapter.dispatch('translations.locate', {
      path: '/news',
      language: 'de',
    });
    expect(typeof place.path).toBe('string');
    expect(place.path.startsWith('/')).toBe(true);
  });
});
