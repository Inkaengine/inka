/**
 * An image field's metadata, kept beside it as Volto's image block keeps it.
 * The widget that sets the field (an upload, a pick in the object browser)
 * hands over `image_field` and `image_scales` with the URL, as onChange's
 * third argument; a front end builds the image's src and srcset from them.
 * Without them it has only the image's URL — its page, not a picture.
 */
import { isPendingImage } from './pendingImages';

/**
 * `holder` (the block, or the object the field is in) with the metadata `meta`
 * gives for the image `value` beside the field. An image held until save has
 * none yet, and the replaced image's would draw in its place: dropped. Save
 * sets its own (pendingImages.js).
 */
export function withImageMetadata(holder, value, meta) {
  if (meta?.image_scales) {
    return { ...holder, image_field: meta.image_field, image_scales: meta.image_scales };
  }
  if (isPendingImage(Array.isArray(value) ? value[0]?.['@id'] : value)) {
    const { image_field, image_scales, ...rest } = holder;
    return rest;
  }
  return holder;
}
