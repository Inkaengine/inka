/**
 * A view-mode render of a draft: the page's front end opened as a visitor sees
 * it — no editor, no empty slots or placeholders — with its fetch of the page's
 * content answered by the draft, layered over the real response so expanders
 * (navigation, breadcrumbs) stay as they are.
 *
 * Works for a front end that fetches its content in the browser. One that
 * renders on its server never makes that fetch here, and that is an error, not
 * a quiet render of the saved page.
 */

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};
const SERVED_MS = 15000;
const QUIET_MS = 500;
const SETTLE_MS = 10000;

/** The front end's view-mode URL for the page, from the admin's edit frame. */
export async function frontendUrlOf(adminPage) {
  const src = await adminPage.locator('#previewIframe').getAttribute('src');
  if (!src) throw new Error('preview: the admin has no front-end frame to take the front end from');
  const url = new URL(src);
  url.searchParams.delete('_edit');
  return url.href;
}

/** Is `url` a fetch of `path`'s content (with or without ++api++, any query)? */
function isContentFetch(url, path) {
  const pathname = new URL(url).pathname.replace(/^\/\+\+api\+\+/, '').replace(/\/$/, '');
  return pathname === path.replace(/\/$/, '');
}

/**
 * Render `draft` (stored page data) in view mode at `frontendUrl`.
 * Returns `{ image, text }`: a PNG of the whole page (base64) and its visible text.
 */
export async function previewDraft(context, { frontendUrl, path, draft, viewport = 'desktop' }) {
  const size = VIEWPORTS[viewport];
  if (!size) throw new Error(`preview: no viewport "${viewport}" (${Object.keys(VIEWPORTS).join(', ')})`);
  const page = await context.newPage();
  try {
    await page.setViewportSize(size);
    let served = 0;
    await page.route(
      (url) => isContentFetch(url.href, path),
      async (route) => {
        const kind = route.request().resourceType();
        if (kind !== 'fetch' && kind !== 'xhr') return route.continue();
        const response = await route.fetch();
        const saved = await response.json();
        served++;
        return route.fulfill({ response, json: { ...saved, ...draft } });
      },
    );
    await page.goto(frontendUrl, { waitUntil: 'load' });
    const t0 = Date.now();
    while (served === 0) {
      if (Date.now() - t0 > SERVED_MS) {
        throw new Error(
          'preview: the front end did not fetch this page\'s content in the browser, so the draft '
          + 'could not be shown. A front end that renders on its server needs a preview endpoint.',
        );
      }
      await page.waitForTimeout(100);
    }
    await settle(page);
    const image = (await page.screenshot({ fullPage: true })).toString('base64');
    return { image, text: await page.evaluate(() => document.body.innerText) };
  } finally {
    await page.close();
  }
}

/** Wait until the DOM has been quiet for QUIET_MS (the draft rendered), and fonts are in. */
async function settle(page) {
  await page.evaluate(([quietMs, limitMs]) => new Promise((resolve, reject) => {
    let timer = setTimeout(done, quietMs);
    const limit = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`preview: the page kept changing for ${limitMs / 1000}s`));
    }, limitMs);
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(done, quietMs);
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    function done() {
      observer.disconnect();
      clearTimeout(limit);
      document.fonts.ready.then(() => resolve());
    }
  }), [QUIET_MS, SETTLE_MS]);
}
