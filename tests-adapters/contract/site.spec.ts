import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { resolveTarget, type Target } from '../targets';

let target: Target;

beforeAll(async () => {
  target = await resolveTarget();
  await target.start();
});

afterAll(async () => {
  await target.stop();
});

/**
 * What the deployment is, as opposed to what any document is.
 *
 * The admin gates real affordances on this: `features.multilingual` decides
 * whether Manage Translations exists at all, and the default language decides
 * what the server renders in. Both were Plone reads the bridge had no route
 * for, so in an adapter session the admin saw a single-language site with no
 * default language — and every multilingual affordance quietly disappeared,
 * against every CMS, with nothing failing to say so.
 *
 * Every CMS knows its own default language, so this is not optional: an
 * adapter that cannot answer it leaves the admin guessing about the thing it
 * renders in.
 */
describe('site.get', () => {
  it('names the default language', async () => {
    const site: any = await target.adapter.dispatch('site.get', {});
    expect(typeof site.defaultLanguage).toBe('string');
    expect(site.defaultLanguage.length).toBeGreaterThan(0);
  });

  it('says whether it can hold translations, rather than leaving it open', async () => {
    // A CMS with no multilingual support must say `false`, not omit it: the
    // admin offering to create a translation that cannot exist is worse than
    // not offering.
    const site: any = await target.adapter.dispatch('site.get', {});
    expect(typeof site.features?.multilingual).toBe('boolean');
  });

  it('says HOW it holds translations, where it holds them at all', async () => {
    // Not a property of the CMS — a property of how this site is set up.
    //
    //   grouped  — one document per language, linked. Linking an existing page
    //              into a group and detaching one are both lossless.
    //   variants — one entity carrying a version of each field per language.
    //              There is no second document, so there is nothing to link,
    //              and removing a language deletes its content.
    //
    // Drupal can be either: Content Translation gives variants, while a site
    // built on separate nodes joined by a reference field is grouped. The
    // adapter is told which by whoever constructs it, because the frontend
    // knows its own site and the CMS type does not settle it.
    // Asked of any adapter that can serve translations at all, not only of a
    // site that happens to have a second language configured today: the mode is
    // structural, and the admin needs it before an editor adds a language.
    if (!target.adapter.capabilities.includes('multilingual' as never)) return;
    const site: any = await target.adapter.dispatch('site.get', {});
    expect(['grouped', 'variants']).toContain(site.features?.translations);
  });

  it('lists the languages it offers, including its default', async () => {
    const site: any = await target.adapter.dispatch('site.get', {});
    expect(Array.isArray(site.languages)).toBe(true);
    expect(site.languages).toContain(site.defaultLanguage);
  });
});
