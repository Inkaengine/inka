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

  test('a page that is not there is no-store too', async ({ request }) => {
    const res = await request.get(`${URLS.voltoSsr}/no-such-page-anywhere`);
    expect(res.status()).toBe(404);
    expect(res.headers()['cache-control']).toBe('no-store');
  });
});
