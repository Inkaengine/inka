/**
 * An image field's metadata goes beside it, from whichever widget set it.
 */
import { withImageMetadata } from './imageMetadata';
import { holdImage, releaseImages } from './pendingImages';

const scales = { image: [{ download: 'http://site/img/@@images/image', scales: {} }] };

afterEach(() => releaseImages());

describe('withImageMetadata', () => {
  it('puts the image_field and image_scales the widget handed over beside the field', () => {
    expect(withImageMetadata({ '@type': 'image', url: 'http://site/img' }, 'http://site/img', {
      title: 'img',
      image_field: 'image',
      image_scales: scales,
    })).toEqual({ '@type': 'image', url: 'http://site/img', image_field: 'image', image_scales: scales });
  });

  it("drops the replaced image's metadata for an image held until save", () => {
    const held = holdImage(new File(['x'], 'held.png', { type: 'image/png' }), '/folder');
    expect(withImageMetadata({ url: held, image_field: 'image', image_scales: scales }, held, undefined))
      .toEqual({ url: held });
  });

  it('leaves the field alone when the widget handed over nothing', () => {
    const block = { url: 'http://elsewhere/pic.jpg', image_field: 'image', image_scales: scales };
    expect(withImageMetadata(block, 'http://elsewhere/pic.jpg', undefined)).toBe(block);
  });
});
