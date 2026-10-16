/**
 * Run: node --test tests-playwright/helpers/imageSizes.test.mjs
 *
 * Pure contract logic — no browser, no servers, no ports.
 *
 * Every case here is phrased as "the data offered X, the render did Y", which
 * is the only thing Inka gets to have an opinion about. How a frontend builds
 * its URLs is its own business.
 */
import test from 'node:test';
import assert from 'node:assert';
import { scalesAvailable, sizesOffered, usesAvailableSizes } from './imageSizes.mjs';

const API = 'https://api.test';

/** A reference offering six distinct widths, as Plone serialises one. */
const sixScales = () => ({
  '@id': '/getty.jpg',
  image_field: 'image',
  image_scales: {
    image: [{
      download: '@@images/image-1920-abc123def456.jpeg',
      width: 1920,
      height: 1280,
      scales: {
        icon: { download: '@@images/image-32-a1.jpeg', width: 32, height: 21 },
        thumb: { download: '@@images/image-128-b2.jpeg', width: 128, height: 85 },
        preview: { download: '@@images/image-400-c3.jpeg', width: 400, height: 266 },
        large: { download: '@@images/image-800-d4.jpeg', width: 800, height: 533 },
        huge: { download: '@@images/image-1600-e5.jpeg', width: 1600, height: 1066 },
      },
    }],
  },
});

test('counts the distinct widths the data offers', () => {
  assert.equal(scalesAvailable(sixScales(), 'image'), 6);
});

test('names that collapse onto one width are not a choice', () => {
  // Plone caps every scale at the SOURCE: on a 200px image, large/huge/great
  // all return 200. Three names, one size, nothing for the browser to pick.
  const capped = {
    image_field: 'image',
    image_scales: {
      image: [{
        download: '@@images/image-200-aa.png', width: 200, height: 100,
        scales: {
          large: { download: '@@images/image-200-bb.png', width: 200, height: 100 },
          huge: { download: '@@images/image-200-cc.png', width: 200, height: 100 },
        },
      }],
    },
  };
  assert.equal(scalesAvailable(capped, 'image'), 1);
  assert.ok(usesAvailableSizes({ field: 'image', entry: capped, srcset: `${API}/a.png 200w` }).ok,
    'a genuinely single-size image must not be failed for rendering one candidate');
});

test('srcset is counted by URL, not by width descriptor', () => {
  // The pretagov hero on 2026-10-15: nine descriptors, one file. The browser
  // has one image to choose from and downloads the full-size original.
  const nineSame = Array.from({ length: 9 }, (_, i) => `${API}/getty.jpg ${320 * (i + 1)}w`).join(', ');
  assert.equal(sizesOffered(nineSame), 1);

  const v = usesAvailableSizes({ field: 'image', entry: sixScales(), srcset: nineSame });
  assert.equal(v.ok, false, 'nine identical URLs is one size, not nine');
  assert.equal(v.available, 6);
  assert.equal(v.offered, 1);
  assert.match(v.reason, /6 distinct sizes/);
  assert.match(v.reason, /same file/);
});

test('a real responsive srcset passes', () => {
  const srcset = [
    `${API}/getty.jpg/@@images/image/preview 400w`,
    `${API}/getty.jpg/@@images/image/large 800w`,
    `${API}/getty.jpg/@@images/image/huge 1600w`,
  ].join(', ');
  const v = usesAvailableSizes({ field: 'image', entry: sixScales(), srcset });
  assert.ok(v.ok, v.reason);
  assert.equal(v.offered, 3);
});

test('no srcset at all, with scales available, is a violation', () => {
  const v = usesAvailableSizes({ field: 'image', entry: sixScales(), srcset: '' });
  assert.equal(v.ok, false);
  assert.match(v.reason, /no srcset/);
});

test('a field with a value that rendered nothing is a violation', () => {
  // The other half of the vacuity: every existing image rule is "for each
  // rendered <img>, assert it loads", which says nothing when no <img> exists.
  const v = usesAvailableSizes({ field: 'image', entry: sixScales(), srcset: '', rendered: false });
  assert.equal(v.ok, false);
  assert.match(v.reason, /no media element was rendered/);
  assert.match(v.reason, /data-edit-media="image"/);
});

test('a reference with no scale data is not judged', () => {
  // Inka cannot know what sizes exist if the data does not say, so it must not
  // invent a requirement.
  for (const entry of [null, undefined, {}, { image_field: 'image' }]) {
    assert.equal(scalesAvailable(entry, 'image'), 0);
    assert.ok(usesAvailableSizes({ field: 'image', entry, srcset: `${API}/x.png` }).ok);
  }
});

test('the field is honoured, not assumed to be "image"', () => {
  // A preview_image_link teaser serialises its scales under its own field.
  const entry = {
    image_field: 'preview_image',
    image_scales: {
      preview_image: [{
        download: '@@images/preview_image-400-aa.png', width: 400, height: 162,
        scales: { mini: { download: '@@images/preview_image-200-bb.png', width: 200, height: 81 } },
      }],
    },
  };
  assert.equal(scalesAvailable(entry, 'preview_image'), 2);
  assert.equal(scalesAvailable(entry, 'image'), 0, 'must not read scales from the wrong field');
});

test('malformed srcset values do not throw', () => {
  for (const s of [undefined, null, '', '   ', ',,,', 'justaurl']) {
    assert.doesNotThrow(() => sizesOffered(s));
  }
  assert.equal(sizesOffered('justaurl'), 1);
});
