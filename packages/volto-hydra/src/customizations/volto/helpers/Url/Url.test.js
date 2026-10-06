/**
 * Unit tests for the Hydra shadow of @plone/volto/helpers/Url/Url.
 *
 * The shadow extends `flattenToAppURL` and `isInternalURL` so they
 * recognise iframe-frontend URLs registered in the saved-URLs cookie /
 * RAZZLE_DEFAULT_IFRAME_URL env. Without this, pasting a link from a
 * published frontend ("https://www.example.com/about") into a Volto
 * widget would be stored as an absolute URL — break resolveuid, break
 * cross-environment portability.
 *
 * Volto's stock helper only knows about `settings.apiPath`,
 * `settings.internalApiPath`, and `settings.publicURL` (which Volto
 * conflates with admin URL). It cannot strip the frontend's published
 * origin.
 */

import Cookies from 'js-cookie';
import config from '@plone/volto/registry';
import { getSavedUrlsCookieName } from '../../../../utils/cookieNames';
import {
  checkAndNormalizeUrl,
  flattenToAppURL,
  flattenScales,
  isInternalURL,
  resolveRelativeUrl,
} from './Url';

beforeEach(() => {
  // Make config.settings deterministic — flattenToAppURL strips these
  // first, so we set them to no-op values that won't accidentally match
  // our test URLs.
  config.settings.apiPath = 'http://api.localhost';
  config.settings.internalApiPath = '';
  config.settings.publicURL = 'http://admin.localhost';
  config.settings.externalRoutes = [];
});

afterEach(() => {
  Cookies.remove(getSavedUrlsCookieName());
});

describe('flattenToAppURL (Hydra shadow)', () => {
  it('strips Volto apiPath like the stock helper', () => {
    expect(flattenToAppURL('http://api.localhost/foo/bar')).toBe('/foo/bar');
  });

  it('strips a known frontend edit URL', () => {
    Cookies.set(
      getSavedUrlsCookieName(),
      'Edit|https://edit.example.com',
    );
    expect(flattenToAppURL('https://edit.example.com/about')).toBe('/about');
  });

  it('strips a known frontend publish URL (different origin than edit)', () => {
    Cookies.set(
      getSavedUrlsCookieName(),
      'Site|https://edit.example.com|https://www.example.com',
    );
    expect(flattenToAppURL('https://www.example.com/about')).toBe('/about');
  });

  it('leaves an unknown absolute URL untouched', () => {
    expect(flattenToAppURL('https://unrelated.example.org/x')).toBe(
      'https://unrelated.example.org/x',
    );
  });
});

describe('isInternalURL (Hydra shadow)', () => {
  it('treats a known frontend publish URL as internal', () => {
    Cookies.set(
      getSavedUrlsCookieName(),
      'Site|https://edit.example.com|https://www.example.com',
    );
    expect(isInternalURL('https://www.example.com/about')).toBe(true);
  });

  it('still rejects unknown absolute URLs', () => {
    expect(isInternalURL('https://elsewhere.example.org/x')).toBe(false);
  });
});

describe('checkAndNormalizeUrl (Hydra shadow) — relative paths', () => {
  // Stock Volto only lets `/` and `#` through as paths: `./page` was given an
  // `http://` prefix, failed the URL check, and the link editor silently
  // refused it.
  it('accepts a path relative to the page, unchanged', () => {
    expect(checkAndNormalizeUrl('./another-page')).toMatchObject({
      url: './another-page',
      isValid: true,
    });
  });

  it('accepts a path to a parent folder, unchanged', () => {
    expect(checkAndNormalizeUrl('../elsewhere')).toMatchObject({
      url: '../elsewhere',
      isValid: true,
    });
  });

  it('still prefixes a bare host', () => {
    expect(checkAndNormalizeUrl('plone.org')).toMatchObject({
      url: 'http://plone.org',
      isValid: true,
    });
  });
});

describe('resolveRelativeUrl (Hydra shadow)', () => {
  // Resolved like a browser resolves a link on the page: `./x` on
  // /about/team is /about/x, a sibling.
  it('resolves ./ against the page, as a sibling', () => {
    expect(resolveRelativeUrl('./login', '/about/team')).toBe('/about/login');
  });

  it('resolves ../ up from the page\'s folder', () => {
    expect(resolveRelativeUrl('../contact', '/about/team')).toBe('/contact');
  });

  it('keeps a fragment and a query string', () => {
    expect(resolveRelativeUrl('./faq?x=1#top', '/about/team')).toBe(
      '/about/faq?x=1#top',
    );
  });

  it('leaves anything that is not relative alone', () => {
    expect(resolveRelativeUrl('/about', '/about/team')).toBe('/about');
    expect(resolveRelativeUrl('#top', '/about/team')).toBe('#top');
    expect(resolveRelativeUrl('https://plone.org', '/about/team')).toBe(
      'https://plone.org',
    );
  });
});

// Deep-freeze, the way the Redux store hands block/image data to the editor.
const deepFreeze = (o) => {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

describe('flattenScales (Hydra shadow) — frozen image data', () => {
  // Regression: image-led teasers carry `image_scales`; the data arrives FROZEN
  // from the store. flattenScales aliased image.scales and then mutated
  // scales[key].download in place → "Cannot assign to read only property
  // 'download'", surfaced by react-beautiful-dnd's error boundary when editing
  // a teaser inside a gridBlock.
  it('does not mutate the frozen input (no read-only download error)', () => {
    const image = deepFreeze({
      'content-type': 'image/jpeg',
      download: 'http://api.localhost/Plone/work/@@images/image.jpeg',
      scales: {
        preview: { download: 'http://api.localhost/Plone/work/@@images/image-400.jpeg' },
        teaser: { download: 'http://api.localhost/Plone/work/@@images/image-600.jpeg' },
      },
    });

    expect(() => flattenScales('/work', image)).not.toThrow();

    const out = flattenScales('/work', image);
    // download URLs flattened (apiPath stripped) on the OUTPUT...
    expect(out.download).not.toContain('http://api.localhost');
    expect(out.scales.preview.download).not.toContain('http://api.localhost');
    expect(out.scales.teaser.download).not.toContain('http://api.localhost');
    // ...and the frozen INPUT is left untouched.
    expect(image.scales.preview.download).toBe(
      'http://api.localhost/Plone/work/@@images/image-400.jpeg',
    );
  });
});
