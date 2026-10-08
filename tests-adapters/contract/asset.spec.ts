import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { resolveTarget, type Target } from '../targets';

let target: Target;

beforeAll(async () => {
  target = await resolveTarget();
  await target.start();
});

afterAll(async () => {
  await target.stop();
});

beforeEach(async () => {
  await target.seed();
});

/** A 1x1 transparent PNG, base64 — small enough to inline, real enough to upload. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('asset.upload', () => {
  it('creates an image and returns it as a canonical Document', async () => {
    const doc: any = await target.adapter.dispatch('asset.upload', {
      parentPath: '/news',
      filename: 'uploaded.png',
      contentType: 'image/png',
      data: PNG_1X1,
    });

    // Deliberately NOT asserting the asset lands under parentPath: Plone
    // stores an Image as content in the tree, WordPress puts every attachment
    // in one flat media library with no parent. What the contract fixes is
    // that an upload yields an addressable, correctly typed document.
    expect(doc.type).toBe(target.types.image);
    expect(typeof doc.id).toBe('string');
    expect(doc.id.length).toBeGreaterThan(0);
    expect(doc.path.startsWith('/')).toBe(true);
  });

  /**
   * A second upload is as ordinary as the first.
   *
   * An editor adding two images to a page is the base case, not an edge one.
   * This is asked of the ADAPTER, with no admin and no browser in the way,
   * because the symptom appears far from the cause: in the journey the second
   * upload came back 500, the block therefore rendered no image, and the
   * spec's ninety-second poll expired — reported as "the uploaded image does
   * not render", which is true and useless.
   *
   * Distinct filenames, so this cannot be read as a question about name
   * collisions: that was the first hypothesis and it was wrong — the second
   * upload failed whatever it was called.
   */
  it('accepts a second upload as readily as the first', async () => {
    const first: any = await target.adapter.dispatch('asset.upload', {
      parentPath: '/news',
      filename: 'first-upload.png',
      contentType: 'image/png',
      data: PNG_1X1,
    });

    const second: any = await target.adapter.dispatch('asset.upload', {
      parentPath: '/news',
      filename: 'second-upload.png',
      contentType: 'image/png',
      data: PNG_1X1,
    });

    expect(second.type).toBe(target.types.image);
    // Two uploads, two distinct assets — not one silently overwriting the
    // other, which would pass a "did it succeed" check while losing an image.
    expect(second.id).not.toBe(first.id);
    expect(second.path).not.toBe(first.path);
  });
});

describe('asset.imageUrl', () => {
  it('returns an absolute, fetchable URL for a named scale', async () => {
    const doc: any = await target.adapter.dispatch('asset.upload', {
      parentPath: '/news',
      filename: 'scaled.png',
      contentType: 'image/png',
      data: PNG_1X1,
    });

    const url: string = await target.adapter.dispatch('asset.imageUrl', {
      path: doc.path,
      field: 'image',
      scale: target.imageScale,
    });

    // Absolute: the admin renders this in an <img>, and it has no way to
    // resolve a CMS-relative path against the frontend's origin.
    expect(url).toMatch(/^https?:\/\//);

    const res = await target.fetchAsSession(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^image\//);
  });
});
