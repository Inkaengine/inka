import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { resolveTarget, type Target } from '../targets';

/**
 * Context expansion.
 *
 * Rendering one route makes the admin ask for the document and then, from
 * separate components, its breadcrumbs, navigation, available types and query
 * indexes. Measured against WordPress those extra reads cost ~1.1s each, and
 * neither `_embed` (which only follows declared `_links`) nor `/batch/v1`
 * (writes only — it rejects GET outright) can collapse them.
 *
 * So expansion is a contract concern: the admin declares that a route needs a
 * bundle, and each adapter satisfies it the best way its CMS allows. The rule
 * that keeps this honest is that expansion is a bundling optimisation and
 * never a new capability — which is what the equivalence test below pins down.
 */

const resolved = await resolveTarget();

/**
 * `actions` maps onto state.get, which is workflow. Plone's adapter does not
 * advertise 'state', so asking every target for it would test the gate rather
 * than expansion. The other four are universal.
 */
const UNIVERSAL = ['breadcrumbs', 'navigation', 'types', 'querystring'];
const hasState = resolved.capabilities.includes('state');
const ALL = hasState ? [...UNIVERSAL, 'actions'] : UNIVERSAL;

const PATH = '/news/first-post';

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

describe('content.get expansion', () => {
  it('omits context entirely when nothing was asked for', async () => {
    const doc: any = await target.adapter.dispatch('content.get', {
      path: PATH,
    });
    expect(doc.path).toBe(PATH);
    expect(doc).not.toHaveProperty('context');
  });

  it('returns exactly the requested keys, and no others', async () => {
    const doc: any = await target.adapter.dispatch('content.get', {
      path: PATH,
      expand: ['breadcrumbs', 'types'],
    });
    expect(Object.keys(doc.context).sort()).toEqual(['breadcrumbs', 'types']);
  });

  it('leaves the document itself untouched', async () => {
    const plain: any = await target.adapter.dispatch('content.get', {
      path: PATH,
    });
    const expanded: any = await target.adapter.dispatch('content.get', {
      path: PATH,
      expand: ALL,
    });
    const { context, ...document } = expanded;
    expect(document).toEqual(plain);
  });

  /**
   * The load-bearing test. If an expanded value ever differs from what the
   * standalone intent returns, expansion has become a second source of truth
   * and every caller now has to know which one it got.
   */
  it.each(ALL)('%s matches the standalone intent exactly', async (name) => {
    const INTENTS: Record<string, [string, any]> = {
      breadcrumbs: ['breadcrumbs.get', { path: PATH }],
      navigation: ['navigation.get', { path: PATH }],
      actions: ['state.get', { path: PATH }],
      types: ['types.list', { path: PATH }],
      querystring: ['querystring.getIndexes', {}],
    };
    const [intent, args] = INTENTS[name];

    const standalone = await target.adapter.dispatch(intent, args);
    const expanded: any = await target.adapter.dispatch('content.get', {
      path: PATH,
      expand: [name],
    });

    expect(expanded.context[name]).toEqual(standalone);
  });

  /**
   * Asserted by counting in-flight calls rather than by timing it, so this
   * fails on a sequential implementation instead of on a slow machine. A
   * sequential expandContext peaks at 2 (the outer content.get plus one
   * expansion); a concurrent one peaks at the whole bundle.
   */
  it('puts the whole bundle in flight at once', async () => {
    const adapter: any = target.adapter;
    const original = adapter.dispatchOnce.bind(adapter);
    let inFlight = 0;
    let peak = 0;

    adapter.dispatchOnce = async (intent: string, args: any) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        return await original(intent, args);
      } finally {
        inFlight -= 1;
      }
    };

    try {
      await target.adapter.dispatch('content.get', { path: PATH, expand: ALL });
    } finally {
      adapter.dispatchOnce = original;
    }

    expect(peak).toBeGreaterThanOrEqual(ALL.length);
  });

  /**
   * An expansion name the adapter does not know must fail loudly. Silently
   * dropping it would hand the admin a context bundle missing a key it asked
   * for, and the failure would surface far from its cause.
   */
  it('rejects an unknown expansion instead of dropping it', async () => {
    await expect(
      target.adapter.dispatch('content.get', {
        path: PATH,
        expand: ['breadcrumbs', 'not-a-real-expansion'],
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_EXPANSION' });
  });
});
