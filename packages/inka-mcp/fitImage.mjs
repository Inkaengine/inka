/**
 * A screenshot made to fit in a tool result. A client keeps a large result out
 * of the conversation: claude.ai writes one of more than about 150,000
 * characters to a file, and then neither the model nor the person sees the
 * picture. A full-page PNG of a real page is several times that.
 *
 * A PNG that fits is sent as it was taken. One that doesn't is drawn smaller,
 * as a JPEG, down to half its width (smaller, its text can't be read); a page
 * too long for even that is cut to its top, and the result says how much it
 * shows. The drawing is done in a blank page of the same browser: the rendered
 * page's own CSP may not allow a data: image.
 */

const QUALITY = 0.8;
const MIN_SCALE = 0.5;
/** Less of the page than this isn't worth sending: refuse instead. */
const MIN_HEIGHT = 200;

/**
 * `png` (a Buffer) as `{ data, mimeType, cropped }`, its base64 at most
 * `maxChars` long. `cropped` is null, or `{ shown, of }`: the picture is the
 * top `shown` pixels of a page `of` pixels tall.
 */
export async function fitImage(context, png, maxChars) {
  const data = png.toString('base64');
  if (data.length <= maxChars) return { data, mimeType: 'image/png', cropped: null };
  const page = await context.newPage();
  try {
    const fitted = await page.evaluate(async ({ src, maxChars, quality, minScale, minHeight }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement('canvas');
      let scale = 1;
      let shown = img.naturalHeight;
      for (;;) {
        if (shown < minHeight) return { shown };
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(shown * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, img.naturalWidth, shown, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL('image/jpeg', quality);
        const jpeg = url.slice(url.indexOf(',') + 1);
        if (jpeg.length <= maxChars) return { jpeg, shown, of: img.naturalHeight };
        // Size goes with area, a little more to land under the limit: first
        // both sides shrink (by the square root), then, at half width, the
        // page is cut.
        const ratio = (maxChars / jpeg.length) * 0.95;
        if (scale > minScale) scale = Math.max(minScale, scale * Math.sqrt(ratio));
        else shown = Math.floor(shown * ratio);
      }
    }, { src: `data:image/png;base64,${data}`, maxChars, quality: QUALITY, minScale: MIN_SCALE, minHeight: MIN_HEIGHT });
    if (!fitted.jpeg) {
      throw new Error(`a screenshot cannot fit in ${maxChars} characters: at half width, under ${MIN_HEIGHT}px of the page would show`);
    }
    const { jpeg, shown, of } = fitted;
    return { data: jpeg, mimeType: 'image/jpeg', cropped: shown < of ? { shown, of } : null };
  } finally {
    await page.close();
  }
}
