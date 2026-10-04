/**
 * Render pages and blocks through the real test frontend (no admin): the
 * frontend loads a page from the mock API, and we answer that request with the
 * draft. Needs `pnpm start:mock-api` and `pnpm start:test-frontend` running.
 */
import { chromium } from 'playwright';
import { simpleToStored } from '../mcp-format/formats.mjs';

const API = `http://localhost:${process.env.HYDRA_MOCK_API_PORT ?? 8888}`;
/** The frontend that renders: the test frontend by default, or e.g. RENDER_FRONTEND=http://localhost:3003 (Nuxt). */
const FRONTEND = process.env.RENDER_FRONTEND ?? `http://localhost:${process.env.HYDRA_TEST_FRONTEND_PORT ?? 8889}`;

/** Is this request the page-content fetch for `path` (with or without ++api++, any query)? */
const isContentFetch = (url, path) => {
  const u = new URL(url);
  return u.origin === API && u.pathname.replace(/^\/\+\+api\+\+/, '').replace(/\/$/, '') === path;
};
/** A plain page the draft stands in for (keeps its metadata, replaces its blocks). */
const DRAFT_PATH = '/docs/examples/content-types/page';

// One browser, shared: cache the launch promise so concurrent callers don't each launch one.
let browser;
export function openBrowser() { browser ??= chromium.launch(); return browser; }
export async function closeBrowser() { if (browser) await (await browser).close(); browser = undefined; }

/**
 * Which of the uids the page drew: a `data-block-uid` attribute, or a hydra
 * comment `<!-- hydra block-uid=… -->` (the test frontend marks hero that way).
 */
const DRAWN = (ids) => {
  const commented = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const m = /block-uid=(\S+)/.exec(n.nodeValue);
    if (m) commented.add(m[1]);
  }
  return ids.filter((id) => commented.has(id) || document.querySelector(`[data-block-uid="${id}"]`));
};

/** Wait until every listed block uid is drawn, or the limit passes. */
async function waitForBlocks(page, uids, limitMs = 10000) {
  const t0 = Date.now();
  for (;;) {
    let drawn = 0;
    try {
      drawn = (await page.evaluate(DRAWN, uids)).length;
    } catch (e) {
      // An SPA frontend (Nuxt) may navigate once after load; check again on the new document.
      if (!/Execution context was destroyed/.test(e.message)) throw e;
    }
    if (drawn === uids.length || Date.now() - t0 > limitMs) return drawn;
    await page.waitForTimeout(200);
  }
}

/** Let images and embedded frames (video players) finish loading so the screenshot shows them. */
async function imagesLoaded(page) {
  // Lazy images/iframes only load in view: scroll through the page first.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 100));
    }
    window.scrollTo(0, 0);
  });
  await page.evaluate(() => Promise.all([...document.images].map((img) => (img.complete ? null
    : new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 5000); })))));
  for (const frame of page.frames().slice(1)) {
    await frame.waitForLoadState('load', { timeout: 5000 }).catch((e) => { if (e.name !== 'TimeoutError') throw e; });
  }
  if (page.frames().length > 1) await page.waitForTimeout(1500); // players paint after load
}

/**
 * Render a canonical block list as a page. Returns a JPEG of the page and how
 * many top-level blocks the frontend drew, plus console errors.
 */
export async function renderDraft(blocks, { title = 'Draft', width = 1000, maxHeight = 4000 } = {}) {
  const b = await openBrowser();
  const page = await b.newPage({ viewport: { width, height: 800 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  const stored = simpleToStored(blocks);
  const original = await (await fetch(`${API}/++api++${DRAFT_PATH}`)).json();
  let served = 0;
  await page.route((url) => isContentFetch(url.href, DRAFT_PATH), (route) => { served++; return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ...original, title, blocks: stored.blocks, blocks_layout: stored.blocks_layout }),
  }); });
  try {
    await page.goto(`${FRONTEND}${DRAFT_PATH}`, { waitUntil: 'load' });
    const uids = stored.blocks_layout.items;
    const drawn = await waitForBlocks(page, uids);
    if (!served) throw new Error(`${FRONTEND} never fetched ${DRAFT_PATH} from ${API} — the draft was not rendered`);
    await imagesLoaded(page);
    const height = Math.min(maxHeight, await page.evaluate(() => document.documentElement.scrollHeight));
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true, clip: { x: 0, y: 0, width, height } });
    const shown = await page.evaluate(DRAWN, uids);
    const missing = uids.filter((id) => !shown.includes(id));
    return { jpeg, drawn, expected: uids.length, missing: missing.map((id) => stored.blocks[id]['@type']), errors };
  } finally {
    await page.close();
  }
}

/** Screenshot the first block of `type` on a real docs page (an example of how it looks). */
export async function screenshotBlock(path, uid, { width = 1000, draft } = {}) {
  const b = await openBrowser();
  const page = await b.newPage({ viewport: { width, height: 800 } });
  if (draft) {
    // Render a draft page in place of `path` (for an example the docs can't show here).
    const original = await (await fetch(`${API}/++api++${path}`)).json();
    await page.route((url) => isContentFetch(url.href, path), (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ ...original, ...draft }),
    }));
  }
  try {
    await page.goto(`${FRONTEND}${path}`, { waitUntil: 'load' });
    const drawn = await waitForBlocks(page, [uid]);
    if (!drawn) throw new Error(`${path}: block ${uid} was not drawn`);
    await imagesLoaded(page);
    // Mark the block's element (a comment-marked block is the element after its comment).
    await page.evaluate((id) => {
      let el = document.querySelector(`[data-block-uid="${id}"]`);
      if (!el) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
        for (let n = walker.nextNode(); n && !el; n = walker.nextNode()) {
          if (new RegExp(`block-uid=${id}(\\s|$)`).test(n.nodeValue)) el = n.nextElementSibling;
        }
      }
      if (!el) throw new Error(`no element for block ${id}`);
      el.setAttribute('data-shot', '');
    }, uid);
    // Pad thin blocks (a separator is 2px high): vision models reject tiny images.
    // Page coordinates (a fullPage clip is page-relative, boundingBox is viewport-relative).
    await page.locator('[data-shot]').first().scrollIntoViewIfNeeded();
    const box = await page.evaluate(() => {
      const r = document.querySelector('[data-shot]').getBoundingClientRect();
      return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
    });
    const pad = Math.max(16, Math.ceil((64 - box.height) / 2));
    const y = Math.max(0, box.y - pad);
    return await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true, clip: { x: Math.max(0, box.x - 16), y, width: Math.min(width, box.width + 32), height: box.height + 2 * pad } });
  } finally {
    await page.close();
  }
}
