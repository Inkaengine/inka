/**
 * Images held until the page is saved, for a front end that sets
 * `deferImageUploads` (voltoConfig.settings). An image dropped or picked in
 * the editor is not uploaded: it is held here, and the page names it by a
 * short reference (`inka-pending:<id>`). The file itself is held, as the
 * browser handed it over: its bytes live once, in the browser, and are made
 * into text only for the upload. The canvas is sent the file once (View.jsx
 * sends PENDING_IMAGE; a Blob crosses postMessage as a handle, not a copy) and
 * hydra.js swaps a blob: URL of it in for the renderer, so the page JSON,
 * which crosses the bridge on every edit, stays small.
 *
 * On Save (Form.jsx) each held image the page still uses is uploaded, as
 * ImageWidget would have at drop time, and its reference replaced by the
 * image. Cancel uploads nothing: the held images are let go.
 */
import { v4 as uuid } from 'uuid';

export const PENDING_PREFIX = 'inka-pending:';

/** A held image could not be uploaded, so the page was not saved. */
export class UploadFailed extends Error {}

const held = new Map();
const listeners = new Set();

/**
 * Hold `file` (a dropped or picked File) for upload into `folder` (a path).
 * Returns the reference the page names it by.
 */
export function holdImage(file, folder) {
  const ref = `${PENDING_PREFIX}${uuid()}`;
  const image = { file, folder };
  held.set(ref, image);
  for (const listener of listeners) listener(ref, image);
  return ref;
}

/** Every held image, as [ref, image]: what a newly loaded canvas is sent. */
export function heldImages() {
  return [...held.entries()];
}

/**
 * The images held for `folder` (a path), as the Image items they will be
 * there: the object browser lists them beside the folder's own, so a held
 * image can be picked again, as an uploaded one could. Picking one stores its
 * reference.
 */
export function heldImagesIn(folder) {
  return heldImages()
    .filter(([, image]) => image.folder === folder)
    .map(([ref, image]) => ({
      '@id': ref,
      '@type': 'Image',
      id: ref,
      getURL: ref,
      title: image.file.name,
      is_folderish: false,
    }));
}

/** The held image `ref` names. */
export function heldImage(ref) {
  if (!held.has(ref)) throw new Error(`No image is held for ${ref}`);
  return held.get(ref);
}

/** Call `listener(ref, image)` for each image held from now on; returns a stop function. */
export function onImageHeld(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A URL the admin's own pages can show a held image by (the widget's preview,
 * the object browser's thumbnail): a blob: URL of the file, made once.
 */
export function previewUrl(ref) {
  const image = heldImage(ref);
  if (!image.previewUrl) image.previewUrl = URL.createObjectURL(image.file);
  return image.previewUrl;
}

/** Let every held image go (saved, or the edit left). */
export function releaseImages() {
  for (const image of held.values()) {
    if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
  }
  held.clear();
}

export function isPendingImage(value) {
  return typeof value === 'string' && value.startsWith(PENDING_PREFIX);
}

/** The references `data` names, in the order it names them. */
function referencesIn(data, found = new Set()) {
  if (isPendingImage(data)) found.add(data);
  else if (data && typeof data === 'object') {
    for (const value of Object.values(data)) referencesIn(value, found);
  }
  return found;
}

/**
 * `data` with each reference replaced by its uploaded image: the URL where the
 * reference was, and on the object that held it the `image_field` and
 * `image_scales` an upload at drop time sets (ImageWidget).
 */
function withUploaded(data, uploaded) {
  if (!data || typeof data !== 'object') return data;
  const copy = Array.isArray(data) ? [...data] : { ...data };
  for (const [key, value] of Object.entries(data)) {
    if (isPendingImage(value)) {
      const content = uploaded.get(value);
      copy[key] = content['@id'];
      copy.image_field = 'image';
      copy.image_scales = { image: [content.image] };
    } else {
      copy[key] = withUploaded(value, uploaded);
    }
  }
  return copy;
}

/**
 * Upload each held image `formData` uses, and return it with the images in
 * place of the references. `upload(image)` (`{ file, folder }`) creates one
 * and resolves to the
 * created content (`{ '@id', image }`); `remove(url)` deletes one. If an
 * upload fails, the images this save created are removed and it throws:
 * nothing is half saved.
 */
export async function uploadPendingImages(formData, { upload, remove }) {
  const refs = referencesIn(formData);
  if (!refs.size) return formData;
  const uploaded = new Map();
  for (const ref of refs) {
    const image = heldImage(ref);
    try {
      uploaded.set(ref, await upload(image));
    } catch (error) {
      for (const content of uploaded.values()) await remove(content['@id']);
      throw new UploadFailed(`${image.file.name} could not be uploaded, so the page was not saved: ${error.message}`, { cause: error });
    }
  }
  return withUploaded(formData, uploaded);
}
