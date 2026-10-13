import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken } from './index.js';

/**
 * The SSR-safe copy of hydra-js's getAccessToken follows the same rule: a
 * stored editing token (sessionStorage or the bridge's 12-hour cookie) belongs
 * to the admin's iframe. A public page that found one fetched its data signed
 * in, and that fetch failing rendered the page as a 500 on every reload.
 */
function page(url, { name = '', stored = null, cookie = null } = {}) {
  const dom = new JSDOM('', { url });
  dom.window.name = name;
  if (stored) dom.window.sessionStorage.setItem('hydra_access_token', stored);
  if (cookie) dom.window.document.cookie = `access_token=${cookie}; path=/`;
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('sessionStorage', dom.window.sessionStorage);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getAccessToken (helpers)', () => {
  it('the admin iframe keeps its stored token across navigations', () => {
    page('https://site.example.org/page', {
      name: 'hydra-edit:https://admin.example.org',
      stored: 'editor-token',
    });
    expect(getAccessToken()).toBe('editor-token');
  });

  it('so does the admin iframe in view mode', () => {
    page('https://site.example.org/page', {
      name: 'hydra-view:https://admin.example.org',
      cookie: 'editor-token',
    });
    expect(getAccessToken()).toBe('editor-token');
  });

  it('a page outside the admin iframe does not use a stored token', () => {
    page('https://site.example.org/page', { stored: 'editor-token' });
    expect(getAccessToken()).toBeNull();
  });

  it('a page outside the admin iframe does not use the token cookie', () => {
    page('https://site.example.org/page', { cookie: 'editor-token' });
    expect(getAccessToken()).toBeNull();
  });

  it('a token in the URL is used wherever it is given', () => {
    page('https://site.example.org/page?access_token=url-token');
    expect(getAccessToken()).toBe('url-token');
  });
});
