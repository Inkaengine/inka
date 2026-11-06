/** The content type a file is uploaded as: image/* an Image, anything else a File. */
export function uploadTypeOf(file) {
  return (file.type || '').startsWith('image/') ? 'Image' : 'File';
}

/**
 * Build a createContent payload from a dropped/picked file and its data URL.
 * image/* → Plone Image (image field); anything else → File (file field).
 *
 * @param {{name: string, type: string}} file
 * @param {string} dataUrl - result of readAsDataURL(file)
 * @returns {object} createContent body
 */
export function buildUploadPayload(file, dataUrl) {
  const fields = dataUrl.match(/^data:(.*);(.*),(.*)$/);
  if (!fields) {
    throw new Error(`buildUploadPayload: unparseable data URL for ${file.name}`);
  }
  const type = uploadTypeOf(file);
  const field = type === 'Image' ? 'image' : 'file';
  return {
    '@type': type,
    title: file.name,
    [field]: {
      data: fields[3],
      encoding: fields[2],
      'content-type': fields[1],
      filename: file.name,
    },
  };
}
