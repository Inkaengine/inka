/**
 * A view-mode render of a draft: the page's front end opened as a visitor sees
 * it — no editor, no empty slots or placeholders — with its fetch of the page's
 * content answered by the draft, layered over the real response so expanders
 * (navigation, breadcrumbs) stay as they are.
 *
 * Works for a front end that fetches its content in the browser. One that
 * renders on its server never makes that fetch here, and that is an error, not
 * a quiet render of the saved page.
 *
 * A draft the front end doesn't render is an error too (RenderFailed), not a
 * picture of the failure: the page load answered an error status, the page
 * threw, or it shows none of the blocks the front end marks (data-block-uid,
 * which the editor needs too). A front end that catches a render error shows
 * its own error page, and an agent handed a screenshot of it as a preview goes
 * on as if the change worked.
 */

import { fitImage } from './fitImage.mjs';

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};
const SERVED_MS = 15000;
const QUIET_MS = 500;
const SETTLE_MS = 30000;
/** How much of a failed page's text an error carries: enough for its message. */
const SHOWN_CHARS = 600;

/** The front end did not render the draft. */
export class RenderFailed extends Error {}

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
 * Returns `{ image, mimeType, cropped, text }`: a picture of the whole page
 * (base64, made to fit in `maxChars`: see fitImage.mjs) and its visible text —
 * or, with `focus`, of just that block (the element the front end marks with
 * its uid).
 */
export async function previewDraft(context, { frontendUrl, path, draft, viewport = 'desktop', focus, maxChars }) {
  if (!maxChars) throw new Error('preview: maxChars is not set: a picture must fit in the result that carries it');
  const size = VIEWPORTS[viewport];
  if (!size) throw new Error(`preview: no viewport "${viewport}" (${Object.keys(VIEWPORTS).join(', ')})`);
  const page = await context.newPage();
  try {
    await page.setViewportSize(size);
    const activity = watchActivity(page);
    const thrown = [];
    page.on('pageerror', (error) => thrown.push(error.message));
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
    const loaded = await page.goto(frontendUrl, { waitUntil: 'load' });
    if (loaded.status() >= 400) throw await renderFailed(page, `its page answered ${loaded.status()}`, thrown);
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
    await activity.settled();
    const hasBlocks = (draft.blocks_layout?.items ?? []).length > 0;
    if (hasBlocks && await page.locator('[data-block-uid]').count() === 0) {
      throw await renderFailed(page, 'it shows none of its blocks', thrown);
    }
    if (thrown.length) throw await renderFailed(page, 'the page threw', thrown);
    if (focus) {
      const block = page.locator(`[data-block-uid="${focus}"]`);
      if (await block.count() === 0) throw new Error(`preview: the front end rendered no element for block ${focus}`);
      const first = block.first();
      return picture(context, await first.screenshot(), maxChars, await first.innerText());
    }
    return picture(context, await page.screenshot({ fullPage: true }), maxChars, await page.evaluate(() => document.body.innerText));
  } finally {
    await page.close();
  }
}

/** RenderFailed, saying why, what the page threw, and what it showed. */
async function renderFailed(page, why, thrown) {
  const shown = (await page.evaluate(() => document.body?.innerText ?? '')).trim().replace(/\s+/g, ' ').slice(0, SHOWN_CHARS);
  const errors = thrown.length ? ` It threw: ${thrown.join('; ')}.` : '';
  return new RenderFailed(`the front end did not render the draft: ${why}.${errors} The page showed: "${shown}"`);
}

async function picture(context, png, maxChars, text) {
  const { data, mimeType, cropped } = await fitImage(context, png, maxChars);
  return { image: data, mimeType, cropped, text };
}

/**
 * Track what the page is still doing: requests in flight, and the time of the
 * last DOM change or finished request. `settled()` resolves once nothing has
 * been in flight or changed for QUIET_MS, and fonts are in. A quiet DOM alone
 * isn't enough: a front end can sit on its "Loading..." for longer than that,
 * waiting on a slow request. (In view mode there is no bridge traffic, so the
 * network is a fair signal here.)
 */
function watchActivity(page) {
  let inFlight = 0;
  let lastNetwork = Date.now();
  const started = () => { inFlight++; lastNetwork = Date.now(); };
  const ended = () => { inFlight--; lastNetwork = Date.now(); };
  page.on('request', started);
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  page.addInitScript(() => {
    window.__inkaLastChange = Date.now();
    new MutationObserver(() => { window.__inkaLastChange = Date.now(); })
      .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  return {
    async settled() {
      const deadline = Date.now() + SETTLE_MS;
      for (;;) {
        const lastDom = await page.evaluate(() => window.__inkaLastChange);
        const quietSince = Math.max(lastNetwork, lastDom);
        if (inFlight === 0 && Date.now() - quietSince >= QUIET_MS) break;
        if (Date.now() > deadline) {
          throw new Error(`preview: the page was still loading or changing after ${SETTLE_MS / 1000}s`);
        }
        await page.waitForTimeout(100);
      }
      await page.evaluate(() => document.fonts.ready);
    },
  };
}
