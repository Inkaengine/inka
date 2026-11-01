/**
 * Images held until the page is saved (a front end that sets
 * `deferImageUploads`). The page names each by a short reference; on Save
 * each one the page still uses is uploaded and its reference replaced by the
 * image, as an upload at drop time would have left it. A failed upload
 * refuses the save and removes what that save had created.
 */
import {
  holdImage,
  heldImages,
  heldImagesIn,
  onImageHeld,
  releaseImages,
  uploadPendingImages,
  UploadFailed,
} from './pendingImages';

/** A dropped file, as the browser hands it over. */
const fileNamed = (name) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
const created = (id) => ({
  '@id': `http://site/news/${id}`,
  image: { download: `http://site/news/${id}/@@images/image.png`, width: 1, height: 1, scales: {} },
});

afterEach(() => releaseImages());

describe('pending images', () => {
  it('holds an image under a reference, and tells whoever is listening', () => {
    const heard = [];
    const file = fileNamed('shot.png');
    const stop = onImageHeld((ref, image) => heard.push([ref, image.file]));
    const ref = holdImage(file, '/news');
    stop();
    expect(ref).toMatch(/^inka-pending:/);
    // The file itself: the bytes are held once, by the browser, not copied as text.
    expect(heard).toEqual([[ref, file]]);
    expect(heard[0][1]).toBe(file);
    expect(heldImages().map(([held]) => held)).toEqual([ref]);
  });

  it('lists the images held for a folder as the Image items they will be, for the picker', () => {
    const ref = holdImage(fileNamed('shot.png'), '/news');
    holdImage(fileNamed('other.png'), '/events');
    expect(heldImagesIn('/news')).toEqual([{
      '@id': ref, '@type': 'Image', id: ref, getURL: ref, title: 'shot.png', is_folderish: false,
    }]);
    expect(heldImagesIn('/elsewhere')).toEqual([]);
  });

  it('on save, uploads each image the page uses and puts the image in its place', async () => {
    const used = holdImage(fileNamed('used.png'), '/news');
    holdImage(fileNamed('dropped.png'), '/news');
    const uploads = [];
    const saved = await uploadPendingImages(
      { blocks: { b1: { '@type': 'hero', image: used, heading: 'Hi' } } },
      { upload: async (image) => { uploads.push(image.file.name); return created('used.png'); }, remove: async () => {} },
    );
    expect(uploads).toEqual(['used.png']);
    expect(saved.blocks.b1).toEqual({
      '@type': 'hero',
      heading: 'Hi',
      image: 'http://site/news/used.png',
      image_field: 'image',
      image_scales: { image: [created('used.png').image] },
    });
  });

  it('an image named as an object gets its scales on that object', async () => {
    const ref = holdImage(fileNamed('a.png'), '/news');
    const saved = await uploadPendingImages(
      { blocks: { b1: { '@type': 'image', url: [{ '@id': ref, title: 'A' }] } } },
      { upload: async () => created('a.png'), remove: async () => {} },
    );
    expect(saved.blocks.b1.url).toEqual([{
      '@id': 'http://site/news/a.png', title: 'A', image_field: 'image', image_scales: { image: [created('a.png').image] },
    }]);
  });

  it('one image in two places is uploaded once', async () => {
    const ref = holdImage(fileNamed('a.png'), '/news');
    let uploads = 0;
    const saved = await uploadPendingImages(
      { blocks: { b1: { image: ref }, b2: { image: ref } } },
      { upload: async () => { uploads += 1; return created('a.png'); }, remove: async () => {} },
    );
    expect(uploads).toBe(1);
    expect(saved.blocks.b2.image).toBe('http://site/news/a.png');
  });

  it('a failed upload refuses the save and removes what it had created', async () => {
    const first = holdImage(fileNamed('first.png'), '/news');
    const second = holdImage(fileNamed('second.png'), '/news');
    const removed = [];
    const saving = uploadPendingImages(
      { blocks: { b1: { image: first }, b2: { image: second } } },
      {
        upload: async (image) => {
          if (image.file.name === 'second.png') throw new Error('413 too large');
          return created(image.file.name);
        },
        remove: async (url) => { removed.push(url); },
      },
    );
    await expect(saving).rejects.toThrow(UploadFailed);
    await expect(saving).rejects.toThrow(/second\.png.*413 too large/);
    expect(removed).toEqual(['http://site/news/first.png']);
  });

  it('a page naming an image nobody holds is refused, not saved with the reference', async () => {
    await expect(uploadPendingImages(
      { blocks: { b1: { image: 'inka-pending:gone' } } },
      { upload: async () => created('x'), remove: async () => {} },
    )).rejects.toThrow(/inka-pending:gone/);
  });

  it('a page with no held image is saved as it is', async () => {
    const page = { blocks: { b1: { image: '/images/a' } } };
    expect(await uploadPendingImages(page, { upload: async () => { throw new Error('no'); }, remove: async () => {} })).toBe(page);
  });
});
