/**
 * The editor's pages are never kept by a shared cache.
 *
 * Volto sends no Cache-Control on a page and leaves caching to the proxy in
 * front of it. A CDN at its defaults then keeps a page for weeks, and serves the
 * old settings (which front ends to frame) after a deploy. Inka's server marks
 * every page `no-store`, including the ones Volto marks itself (its not-found
 * page asks for `no-cache`, its error page for `public, max-age=60`).
 */
import { test, expect } from '../fixtures';
import { URLS } from '../ports';

test.describe('the editor\'s pages and a shared cache', () => {
  test('a page is no-store', async ({ request }) => {
    const res = await request.get(`${URLS.voltoSsr}/test-page`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('<!doctype html>');
    expect(res.headers()['cache-control']).toBe('no-store');
  });

  /**
   * A path with no content behind it gets the same header.
   *
   * 200, not 404, and that is the architecture rather than a shortcoming: Inka
   * is client-side only. The admin reads its CMS through the frontend's
   * adapter, over the bridge, in the browser — on the server it does not even
   * know WHICH CMS is in play, because that arrives in the adapter's
   * announcement (see the Api shadow, which throws rather than quietly
   * answering a server-side read from the build's own apiPath). So the server
   * serves the shell for every path and the not-found page is rendered by
   * Volto in the browser, by which time the status line is long gone.
   *
   * Which leaves the header as the whole point, and it is the same point: the
   * response for a path that does not exist must not be kept by a shared cache
   * either. Volto's own not-found page asks for `no-cache`, so when this WAS
   * server-rendered the status was how the test reached that page; now it is
   * simply the shell.
   */
  test('a path with nothing behind it is no-store too', async ({ request }) => {
    const res = await request.get(`${URLS.voltoSsr}/no-such-page-anywhere`);
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toBe('no-store');
  });
});
