import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import config from '@plone/volto/registry';
import Api from '../customizations/volto/helpers/Api/Api';

/**
 * The routing decision, pinned.
 *
 * Standalone Hydra has no CMS of its own, so a direct fetch in bridge mode is
 * not a fallback — it is a request aimed at nothing, or at the wrong CMS
 * entirely. These assertions exist so nobody can reintroduce one as a
 * well-meaning "graceful degradation".
 */

const originalFlag = config.settings.useBridgeBackend;
const originalExpanders = config.settings.apiExpanders;

beforeEach(() => {
  delete window.__hydraBridgeRpc;
});

afterEach(() => {
  config.settings.useBridgeBackend = originalFlag;
  config.settings.apiExpanders = originalExpanders;
  delete window.__hydraBridgeRpc;
});

/**
 * Speak as the frontend does on connect.
 *
 * Which transport a request takes depends on what the adapter says it can
 * serve, so a test that never announces one is not testing routing — it is
 * testing the unannounced state, which production never reaches: the adapter
 * host is mounted on every route.
 */
function announceAdapter(capabilities) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'ADAPTER_READY', name: 'test', capabilities, protocolVersion: 1 },
      origin: window.location.origin,
    }),
  );
}

describe('Api transport selection', () => {
  // Routing is decided PER CALL, not in the constructor: Volto builds one Api
  // at boot and the store closes over it for the app's lifetime, long before
  // any bridge exists. A constructor-time choice can only ever be wrong.
  it('routes a call over the bridge when one is published', async () => {
    config.settings.useBridgeBackend = true;
    const request = vi.fn().mockResolvedValue({ ok: 1 });
    window.__hydraBridgeRpc = { request };
    announceAdapter(['content', 'http-passthrough']);

    await new Api().get('/news');

    expect(request).toHaveBeenCalledWith(
      'http',
      expect.objectContaining({ op: 'get', path: '/news' }),
    );
  });

  it('throws rather than fetching directly when the bridge is missing', () => {
    config.settings.useBridgeBackend = true;
    // The client is published at module load, so its absence means bridge
    // mode is on with no bridge at all — a bug, not a reason to fall back.
    expect(() => new Api().get('/news')).toThrow(/cannot reach a CMS by itself/);
  });

  it('leaves stock behaviour alone when the flag is off', () => {
    config.settings.useBridgeBackend = false;
    const api = new Api();
    for (const method of ['get', 'post', 'put', 'patch', 'del']) {
      expect(typeof api[method]).toBe('function');
    }
    // No bridge consulted, no throw: this is stock superagent.
    expect(() => api.get('/news')).not.toThrow();
  });

  /**
   * SSR used to be allowed onto the direct path, on the grounds that there is
   * no iframe at render time. But "no iframe" does not make a direct fetch
   * correct — it just means there is nobody to ask, and answering from
   * `apiPath` sends the admin to the wrong CMS: one that does not exist for a
   * WordPress or Drupal site, and for a Plone site a DIFFERENT Plone, which
   * answers 200 and is indistinguishable from working.
   *
   * In a bridge session every route has its server-side prefetch stripped, so
   * nothing should be asking. If something does, that is the bug to fix, and
   * it has to be audible.
   */
  it('refuses to fetch during SSR rather than reaching for apiPath', () => {
    config.settings.useBridgeBackend = true;
    const request = vi.fn();
    window.__hydraBridgeRpc = { request };
    const api = new Api({ universalCookies: { get: () => null } });
    expect(() => api.get('/news')).toThrow(/server-side rendering/);
    expect(request).not.toHaveBeenCalled();
  });
});

/**
 * apiExpanders is read at TWO moments, and an announcement lands between them.
 *
 * Volto asks it once when it builds the content request — does this route
 * expand? — and again when the answer comes back — was this expanded, so the
 * reducer may take @components? Components consult it a third time to decide
 * whether to fetch their own data.
 *
 * Changing it on ADAPTER_READY desynchronises those readers. The route's
 * request goes out WITH `?expand=breadcrumbs,actions,types,navigation` and the
 * CMS answers it in full; the adapter then announces, apiExpanders is emptied,
 * and the actions reducer refuses the bundle it was handed because the config
 * now says nothing was expanded. Meanwhile the Toolbar, which mounted while
 * expanders were still configured, has already skipped its own fetch. The data
 * is fetched, delivered, and thrown away, and the toolbar renders no Edit
 * button — which is what broke every edit-mode spec in the suite.
 *
 * The decision belongs where it is made before the first request: statically,
 * in applyConfig. Whatever it decided must survive the announcement.
 */
describe('apiExpanders across an adapter announcement', () => {
  it('leaves the configured expanders untouched', () => {
    config.settings.useBridgeBackend = true;
    const configured = [{ match: '', GET_CONTENT: ['breadcrumbs', 'actions'] }];
    config.settings.apiExpanders = configured;

    announceAdapter(['content', 'http-passthrough']);

    expect(config.settings.apiExpanders).toEqual(configured);
  });
});
