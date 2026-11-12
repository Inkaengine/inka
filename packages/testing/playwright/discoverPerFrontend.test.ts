import { describe, test, expect, vi } from 'vitest';
import { discoverPerFrontend, type FrontendRegistry } from './global-setup';

/**
 * inka#619: each frontend's content is judged against the styles THAT
 * frontend offers. Discovery used one menu for all of them — FRONTEND_URL's,
 * or none at all without it — so a style one frontend offers failed (or
 * passed) for the others, and every styled paragraph failed with no
 * FRONTEND_URL set.
 */
const registry = (styleMenuClasses: string[]): FrontendRegistry => ({
  blocksConfig: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`type${i}`, {}])),
  frontendKeys: ['type0'],
  styleMenuClasses,
});

describe('discoverPerFrontend', () => {
  test("judges each frontend's content against that frontend's own style menu", async () => {
    const menus: Record<string, string[]> = {
      'http://nuxt': ['callout', 'lead'],
      'http://next': ['quote'],
    };
    const discover = vi.fn(async () => [{ type: 'slate' }]);
    await discoverPerFrontend(
      [['nuxt', 'http://nuxt'], ['next', 'http://next']],
      {
        reachable: async () => true,
        fetchRegistry: async (url) => registry(menus[url]),
        discover,
      },
    );
    expect(discover.mock.calls.map((call) => call[2])).toEqual([['callout', 'lead'], ['quote']]);
  });

  test('tags each block with the frontend it came from, and skips one that is down or gives no schemas', async () => {
    const result = await discoverPerFrontend(
      [['nuxt', 'http://nuxt'], ['down', 'http://down'], ['empty', 'http://empty']],
      {
        reachable: async (url) => url !== 'http://down',
        fetchRegistry: async (url) => (url === 'http://empty'
          ? { blocksConfig: {}, frontendKeys: [], styleMenuClasses: [] }
          : registry(['lead'])),
        discover: async () => [{ type: 'slate' }, { type: 'image' }],
      },
    );
    expect(result.blocks).toEqual([{ type: 'slate', frontend: 'nuxt' }, { type: 'image', frontend: 'nuxt' }]);
    expect(result.perFrontend).toEqual({ nuxt: 2 });
  });
});
