import { expandListingBlocks } from '@volto-hydra/helpers';

/**
 * SSR / SSG safety: hydra.js runs server-side during a Nuxt `ssr: true`
 * render (and `nuxt generate` prerender), where there is no `window`.
 * Its internal log() must not dereference `window` unguarded —
 * expandListingBlocks calls log(), so a crash there 500s every
 * server-rendered page that contains a listing or contextNavigation
 * block (e.g. every /docs/* page).
 */
describe('hydra.js SSR safety', () => {
  test('expandListingBlocks runs with no window global', async () => {
    expect(typeof window).toBe('undefined');
    await expect(
      expandListingBlocks([], { fetchItems: {}, itemTypeField: 'variation' }),
    ).resolves.toBeDefined();
  });
});
