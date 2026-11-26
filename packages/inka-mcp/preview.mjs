/**
 * A view-mode render of a draft: the page's front end opened as a visitor sees
 * it — no editor, no empty slots or placeholders — and handed the draft through
 * its bridge, as the editor's compare view hands a version to its panes. That
 * takes no fetch from the browser, so it works for a front end that renders on
 * its server as well as one that renders in the browser, and the frame's access
 * token lets it load a page visitors can't reach yet.
 *
 * The bridge starts only inside a frame, and talks to its parent at the origin
 * window.name gives. So the front end is framed by a page of this code's own,
 * served on the front end's origin: a site that limits who may frame it allows
 * itself. The frame starts at the screen's size, and takes the height of what it
 * draws for the picture of the whole page; a part sized in vh grows with it.
 *
 * A front end whose bridge doesn't connect is an error, not a quiet picture of
 * the saved page.
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
const CONNECT_MS = 15000;
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
  url.searchParams.set('_edit', 'false');
  return url.href;
}

/** Where the page framing the front end is served, on the front end's origin. */
const HOST_PATH = '/__inka-preview';
const FRAME_NAME = (origin) => `hydra-view:${origin}`;

const hostPage = (frontendUrl) => `<!DOCTYPE html><html><body style="margin:0"><iframe
  name="${FRAME_NAME(new URL(frontendUrl).origin)}" src="${frontendUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"
  style="display:block;border:0;width:100%;height:100vh"></iframe></body></html>`;

/**
 * In the page framing the front end: answer its bridge as an admin would, with
 * `message` once it says it is there, and once more a moment later for a front
 * end that registers its onEditChange after the bridge starts (identical
 * content, so harmless).
 */
function answerAsAdmin({ message, nudgeMs }) {
  if (window !== window.top) return;
  window.addEventListener('message', ({ data, source, origin }) => {
    if (data?.type !== 'INIT' || origin !== window.location.origin) return;
    window.__inkaBridgeConnected = true;
    source.postMessage(message, origin);
    setTimeout(() => source.postMessage(message, origin), nudgeMs);
  });
}

/**
 * Render `draft` (stored page data, with the admin's `blockPathMap` for it,
 * which the bridge requires) in view mode at `frontendUrl`.
 * Returns `{ image, mimeType, cropped, text }`: a picture of the whole page
 * (base64, made to fit in `maxChars`: see fitImage.mjs) and its visible text —
 * or, with `focus`, of just that block (the element the front end marks with
 * its uid).
 */
export async function previewDraft(context, { frontendUrl, draft, blockPathMap, viewport = 'desktop', focus, maxChars }) {
  if (!maxChars) throw new Error('preview: maxChars is not set: a picture must fit in the result that carries it');
  if (!blockPathMap) throw new Error('preview: blockPathMap is not set: the bridge throws without one');
  const size = VIEWPORTS[viewport];
  if (!size) throw new Error(`preview: no viewport "${viewport}" (${Object.keys(VIEWPORTS).join(', ')})`);
  const page = await context.newPage();
  try {
    await page.setViewportSize(size);
    const activity = watchActivity(page);
    const thrown = [];
    page.on('pageerror', (error) => thrown.push(error.message));
    await page.addInitScript(answerAsAdmin, {
      message: { type: 'FORM_DATA', data: draft, blockPathMap },
      nudgeMs: QUIET_MS / 2,
    });
    let answered = null;
    page.on('response', (response) => {
      if (answered === null && response.url() === frontendUrl) answered = response.status();
    });
    const hostUrl = new URL(HOST_PATH, frontendUrl).href;
    await page.route(hostUrl, (route) => route.fulfill({ contentType: 'text/html', body: hostPage(frontendUrl) }));
    await page.goto(hostUrl, { waitUntil: 'load' });
    const frame = page.frame({ name: FRAME_NAME(new URL(frontendUrl).origin) });
    if (answered >= 400) throw await renderFailed(frame, `its page answered ${answered}`, thrown);
    try {
      await page.waitForFunction(() => window.__inkaBridgeConnected, null, { timeout: CONNECT_MS });
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
      throw await renderFailed(frame, 'the front end\'s bridge did not connect in view mode (window.name "hydra-view:…"), so it was never given the draft', thrown);
    }
    await activity.settled(frame);
    const hasBlocks = (draft.blocks_layout?.items ?? []).length > 0;
    if (hasBlocks && await frame.locator('[data-block-uid]').count() === 0) {
      throw await renderFailed(frame, 'it shows none of its blocks', thrown);
    }
    if (thrown.length) throw await renderFailed(frame, 'the page threw', thrown);
    const height = await frame.evaluate(() => document.documentElement.scrollHeight);
    await page.locator('iframe').evaluate((element, px) => { element.style.height = `${px}px`; }, height);
    if (focus) {
      const block = frame.locator(`[data-block-uid="${focus}"]`);
      if (await block.count() === 0) throw new Error(`preview: the front end rendered no element for block ${focus}`);
      const first = block.first();
      return picture(context, await first.screenshot(), maxChars, await first.innerText());
    }
    return picture(context, await page.screenshot({ fullPage: true }), maxChars, await frame.evaluate(() => document.body.innerText));
  } finally {
    await page.close();
  }
}

/** RenderFailed, saying why, what the page threw, and what the front end's `frame` showed. */
async function renderFailed(frame, why, thrown) {
  const shown = (await frame.evaluate(() => document.body?.innerText ?? '')).trim().replace(/\s+/g, ' ').slice(0, SHOWN_CHARS);
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
    async settled(frame) {
      const deadline = Date.now() + SETTLE_MS;
      for (;;) {
        const lastDom = await frame.evaluate(() => window.__inkaLastChange);
        const quietSince = Math.max(lastNetwork, lastDom);
        if (inFlight === 0 && Date.now() - quietSince >= QUIET_MS) break;
        if (Date.now() > deadline) {
          throw new Error(`preview: the page was still loading or changing after ${SETTLE_MS / 1000}s`);
        }
        await page.waitForTimeout(100);
      }
      await frame.evaluate(() => document.fonts.ready);
    },
  };
}
