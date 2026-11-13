import { getImageUrl } from '@volto-hydra/helpers';

/**
 * getImageUrl builds an image URL from a catalog-brain/summary shape
 * ({ '@id', image_field, image_scales }). Two cases matter:
 *
 *  - A normal leadimage: the scale lives on the item itself, so the URL is
 *    <item @id>/<hashed download>.
 *  - A `preview_image_link` relation (case-study teaser -> shared
 *    /logos/<client> image): plone.volto serializes the scale on the LINKED
 *    image and stamps `base_path` = the linked image's path. The URL must
 *    resolve against base_path, NOT the referencing item's @id — otherwise it
 *    requests /case-studies/<slug>/... and serves the wrong image (or 404s).
 *    Mirrors Volto's Image.jsx: `image.base_path || item['@id']`.
 *
 * Always uses the content-hashed `download` (not `@@images/<field>`) so a
 * replaced-in-place image yields a new URL and downstream caches (e.g. IPX)
 * bust automatically.
 */
const API = 'http://api.test';

describe('getImageUrl', () => {
  test('preview_image_link: resolves the hashed scale against base_path (the linked logo)', () => {
    const item = {
      '@id': '/case-studies/health-agency',
      image_field: 'preview_image_link',
      image_scales: {
        preview_image_link: [
          {
            download: '@@images/image-279-aaaaaaaa.png',
            base_path: '/logos/health-agency',
            width: 279,
            height: 65,
          },
        ],
      },
    };
    expect(getImageUrl(item, API)).toBe(
      `${API}/logos/health-agency/@@images/image-279-aaaaaaaa.png`,
    );
  });

  test('preview_image_link: never resolves against the referencing item @id', () => {
    const item = {
      '@id': '/case-studies/health-agency',
      image_field: 'preview_image_link',
      image_scales: {
        preview_image_link: [
          { download: '@@images/image-32-bbbb.png', base_path: '/logos/agency' },
        ],
      },
    };
    const url = getImageUrl(item, API);
    expect(url).not.toContain('/case-studies/');
    expect(url).toBe(`${API}/logos/agency/@@images/image-32-bbbb.png`);
  });

  test('leadimage (no base_path): resolves the hashed download against the item @id', () => {
    const item = {
      '@id': '/case-studies/archival-property-register',
      image_field: 'image',
      image_scales: { image: [{ download: '@@images/image-662-cccccccc.png' }] },
    };
    expect(getImageUrl(item, API)).toBe(
      `${API}/case-studies/archival-property-register/@@images/image-662-cccccccc.png`,
    );
  });

  test('absolute @id base is not re-prefixed with apiUrl', () => {
    const item = {
      '@id': 'http://api.test/case-studies/x',
      image_field: 'image',
      image_scales: { image: [{ download: '@@images/image-100-dddd.png' }] },
    };
    expect(getImageUrl(item, API)).toBe(
      'http://api.test/case-studies/x/@@images/image-100-dddd.png',
    );
  });
});

// A listing maps a result's image as `image_link`: the catalog brain inside a
// list, its scales with it. The first element is read as a brain too, not just
// for its `@id` (the page's address, which is no image).
describe('getImageUrl — a brain inside a list', () => {
  it('resolves the scale, not the page address', () => {
    const brain = {
      '@id': 'http://localhost:8888/news/a',
      image_field: 'image',
      image_scales: { image: [{ download: '@@images/image-800-abc.jpeg' }] },
    };
    expect(getImageUrl([brain], 'http://localhost:8888')).toBe(
      'http://localhost:8888/news/a/@@images/image-800-abc.jpeg',
    );
  });
});
