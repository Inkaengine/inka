import type { Page } from '@playwright/test';

import { holdOn, readFor } from './demoPacing';

/**
 * On-screen captions burned into a Playwright-recorded demo video.
 *
 * Playwright has no native video-caption API, so a caption has to be drawn by
 * us. There are two ways to do that, and this module picks the better one that
 * the running Playwright supports:
 *
 *   1. `screencast.showOverlay` (Playwright >= 1.61) — PREFERRED. The pill is
 *      composited into the VIDEO, so nothing is added to the DOM of the app
 *      being demoed, it survives full page navigations without re-injection
 *      (a DOM node is destroyed on navigate), and it is the same screencast
 *      API that `AdminUIHelper.enableDemoCursor()` needs to draw a pointer
 *      that tracks over the admin iframe.
 *   2. DOM injection — FALLBACK for older Playwright, or when video/screencast
 *      is off. A single fixed overlay on the top-level admin page (not the
 *      iframe), `pointer-events: none`, so it never intercepts the actions
 *      being demoed and still renders over the iframe.
 *
 * The fallback keeps `#__hydra_demo_caption__` exactly as it was when this was
 * DOM-only, so a suite that inspects that node still finds it on a Playwright
 * that can't do screencast overlays.
 */
const CAPTION_ID = '__hydra_demo_caption__';

/**
 * The live screencast overlay per page, so a new caption can dispose the
 * previous one — only ever ONE pill on screen. Keyed weakly: a closed page
 * drops out on its own. The DOM path needs no bookkeeping (it reuses the node).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const liveOverlay = new WeakMap<Page, any>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const screencastOf = (page: Page): any => (page as any).screencast;

const escapeHtml = (s: string): string =>
  s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));

/** Drop the current screencast pill, if any. */
async function disposeOverlay(page: Page): Promise<void> {
  const live = liveOverlay.get(page);
  if (live?.dispose) await live.dispose().catch(() => {});
  liveOverlay.delete(page);
}

/**
 * Show or update the caption. Pass '' to hide it.
 *
 * The pill stays up while the following actions run, until the next caption or
 * `clearCaption` replaces it — so place it right BEFORE the beat it narrates
 * ("Unlock the shared footer template"), not after. With DEMO_PACING on, it
 * first holds for as long as its words take to read (`readFor(text)`), or for
 * `hold` when given (e.g. `glance()`). Without DEMO_PACING it does not wait.
 *
 * No overlay `duration`: Playwright's showOverlay(html, { duration }) waits out
 * the whole duration before it returns, which made every caption a hidden
 * fixed wait (15s each).
 */
export async function showCaption(
  page: Page,
  text: string,
  { hold }: { hold?: number } = {},
): Promise<void> {
  await drawCaption(page, text);
  if (text) await holdOn(page, hold ?? readFor(text));
}

async function drawCaption(page: Page, text: string): Promise<void> {
  const sc = screencastOf(page);
  if (sc?.showOverlay) {
    await disposeOverlay(page);
    if (!text) return;
    const html =
      `<div style="position:fixed;left:50%;bottom:6%;transform:translateX(-50%);` +
      `max-width:80%;background:rgba(18,20,26,.9);color:#fff;padding:10px 20px;` +
      `border-radius:999px;font:600 16px/1.3 system-ui,-apple-system,sans-serif;` +
      `text-align:center;box-shadow:0 6px 20px rgba(0,0,0,.35);` +
      `z-index:2147483647;">${escapeHtml(text)}</div>`;
    liveOverlay.set(page, await sc.showOverlay(html));
    return;
  }

  // Fallback: inject/update the DOM overlay.
  await page.evaluate(
    ({ id, text }) => {
      let el = document.getElementById(id) as HTMLDivElement | null;
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        Object.assign(el.style, {
          position: 'fixed',
          left: '50%',
          bottom: '32px',
          transform: 'translateX(-50%)',
          zIndex: '2147483647',
          maxWidth: 'min(82vw, 880px)',
          padding: '12px 22px',
          background: 'rgba(17, 17, 26, 0.86)',
          color: '#fff',
          font: '600 20px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif',
          textAlign: 'center',
          borderRadius: '12px',
          boxShadow: '0 6px 24px rgba(0, 0, 0, 0.35)',
          pointerEvents: 'none',
          opacity: '0',
          transition: 'opacity 180ms ease',
        } as CSSStyleDeclaration);
        document.body.appendChild(el);
      }
      el.textContent = text;
      el.style.opacity = text ? '1' : '0';
    },
    { id: CAPTION_ID, text },
  );
}

/** Remove the caption entirely, whichever mechanism drew it. */
export async function clearCaption(page: Page): Promise<void> {
  await disposeOverlay(page);
  await page.evaluate((id) => {
    document.getElementById(id)?.remove();
  }, CAPTION_ID);
}
