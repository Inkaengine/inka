import { JSDOM } from 'jsdom';
import { getAccessToken } from './hydra.src.js';

/**
 * The editing token belongs to the admin's iframe.
 *
 * The admin opens the frontend in an iframe with ?access_token=…, and the bridge
 * keeps the token in sessionStorage so the iframe's later navigations stay
 * signed in. sessionStorage is shared by every page of that origin in the TAB,
 * though: when the same tab later shows the public site, its pages found the
 * editor's token, fetched their data signed in, and — that fetch failing — a
 * public page rendered as a 500 on every reload. Outside the admin's iframe, a
 * stored token is not this page's to use.
 *
 * The same goes for the token cookie the bridge sets on the frontend's domain:
 * it lasts 12 hours, so every public page of the site — in any tab — found it.
 */
/**
 * A page at `url`, in a window named `name`, with `stored` in sessionStorage
 * and `cookie` as the access_token cookie.
 */
function page(url, { name = '', stored = null, cookie = null } = {}) {
  const dom = new JSDOM('', { url });
  dom.window.name = name;
  if (stored) dom.window.sessionStorage.setItem('hydra_access_token', stored);
  if (cookie) dom.window.document.cookie = `access_token=${cookie}; path=/`;
  global.window = dom.window;
  global.document = dom.window.document;
  global.sessionStorage = dom.window.sessionStorage;
}

afterEach(() => {
  delete global.window;
  delete global.document;
  delete global.sessionStorage;
});

describe('getAccessToken', () => {
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
      stored: 'editor-token',
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

  it('the admin iframe still reads the token cookie', () => {
    page('https://site.example.org/page', {
      name: 'hydra-edit:https://admin.example.org',
      cookie: 'editor-token',
    });
    expect(getAccessToken()).toBe('editor-token');
  });

  it('a token in the URL is used wherever it is given', () => {
    page('https://site.example.org/page?access_token=url-token');
    expect(getAccessToken()).toBe('url-token');
  });
});
