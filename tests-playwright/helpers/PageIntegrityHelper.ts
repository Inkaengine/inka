/**
 * Page-level integrity checks that run on a fully loaded rendered page,
 * complementing the per-block checks in BlockVerificationHelper. The
 * per-block helper only sees the block under test; this helper sees the
 * whole page, so it catches things like a stray slate link in some other
 * block pointing at the backend API.
 *
 * Intended to be called by a per-page walker (one call per page in the
 * site's @search result) from a consumer repo's playwright spec:
 *
 *   for (const p of pages) {
 *     await page.goto(p);
 *     await page.waitForLoadState('networkidle').catch(() => {});
 *     await verifyPageIntegrity(page);
 *   }
 */
import { Page, expect } from '@playwright/test';

export interface PageIntegrityOptions {
  /**
   * Origins considered "the backend" — any rendered `<a href>` pointing here
   * is an integrity failure (indicates the frontend failed to strip the
   * backend base URL from a resolveuid-expanded link). Defaults to other
   * localhost origins (a reasonable heuristic when tests run against local
   * mock-api + frontend on different ports).
   */
  backendOriginMatches?: (origin: string) => boolean;
}

/**
 * No *visible* rendered `<img>` should be broken (empty src, failed load).
 * Skips data: URIs (often inline placeholders) and images that aren't actually
 * displayed. A hidden image can't be a visible defect, and — crucially — an
 * `<img loading="lazy">` inside hidden UI (e.g. a responsive mobile nav that is
 * `display:none` at desktop width) never enters the viewport, so it never
 * starts loading and legitimately reports `naturalWidth === 0`. Flagging that as
 * "broken" is a false positive; only images the user can actually see count.
 *
 * "Broken" means *finished and empty* (`complete && naturalWidth === 0`) — a
 * 404, a wrong content-type, or bytes the decoder rejected. An image that is
 * merely unfinished (`complete === false`) is still downloading, which is a
 * different thing entirely: waiting is the answer, not failing. Conflating the
 * two makes the check race the network, so a loaded CI runner "finds" broken
 * images on a page that is perfectly fine. Unfinished images are waited for and
 * then reported separately for diagnosis.
 */
export async function verifyNoBrokenImages(
  page: Page,
  options: { settleTimeout?: number } = {},
): Promise<void> {
  const settleTimeout = options.settleTimeout ?? 10000;

  // An image that hasn't finished downloading is not a broken image. `complete
  // === false` is the browser saying "still in flight", and asserting on it
  // turns a slow run into a phantom "broken image" failure — the page is fine,
  // the check simply looked too early. So wait for anything that has actually
  // started to settle before judging.
  //
  // `loading="lazy"` images that never enter the viewport never start, so they
  // can't be waited for; they're excluded here and skipped below rather than
  // being allowed to hold the wait open for the full timeout.
  await page
    .waitForFunction(
      () =>
        Array.from(document.images).every(
          (img) => img.complete || img.loading === 'lazy',
        ),
      undefined,
      { timeout: settleTimeout },
    )
    .catch(() => {});

  const { broken, stillLoading } = await page.evaluate(() => {
    const visible = Array.from(document.querySelectorAll('img')).filter((img) => {
      if (!img.src || img.src.startsWith('data:')) return false;
      // Skip images that aren't displayed. `offsetParent === null` catches an
      // element with `display:none` on itself OR any ancestor — e.g. a
      // responsive mobile nav hidden at desktop width, whose lazy <img> never
      // enters the viewport, so it never loads and reports naturalWidth 0
      // without being a real defect. (position:fixed also yields a null
      // offsetParent but is visible; the nav/content images here aren't
      // fixed.) A broken image in a *visible* container keeps a non-null
      // offsetParent even if it collapses to zero size, so it's still caught.
      const style = getComputedStyle(img);
      const hidden =
        (img.offsetParent === null && style.position !== 'fixed') ||
        style.visibility === 'hidden' ||
        style.display === 'none';
      return !hidden;
    });
    const describe = (img: HTMLImageElement) => ({ src: img.src, alt: img.alt });
    return {
      // Finished, and decoded to nothing: a 404, a wrong content-type, or bytes
      // the decoder rejected. This is the real defect.
      broken: visible.filter((img) => img.complete && img.naturalWidth === 0).map(describe),
      // Never finished within the settle window. Reported for diagnosis, but it
      // does not fail the check on its own — a lazy image below the fold is
      // expected to sit here, and a slow response is not a broken page.
      stillLoading: visible
        .filter((img) => !img.complete && img.loading !== 'lazy')
        .map(describe),
    };
  });

  const note = stillLoading.length
    ? `\n(also still loading after ${settleTimeout}ms, not counted as broken:\n` +
      `${JSON.stringify(stillLoading, null, 2)})`
    : '';
  expect(
    broken,
    `Broken images on ${page.url()}:\n${JSON.stringify(broken, null, 2)}${note}`,
  ).toEqual([]);
}

/**
 * No rendered link should point at an origin other than the page's, when
 * that other origin is considered "the backend" (default: any other
 * localhost service). Catches resolveuid-expanded backend URLs that the
 * frontend forgot to strip.
 */
export async function verifyNoBackendLinks(
  page: Page,
  options: PageIntegrityOptions = {},
): Promise<void> {
  const matchJs = options.backendOriginMatches
    ? options.backendOriginMatches.toString()
    : '(origin) => origin.includes("localhost")';

  const offSite = await page.evaluate(`(() => {
    const pageOrigin = window.location.origin;
    const isBackend = ${matchJs};
    return Array.from(document.querySelectorAll('a[href]'))
      // Intentional cross-origin admin links (e.g. Login to Volto) opt out
      // via data-linkable-allow, same as block-level edit annotation checks.
      .filter((el) => !el.hasAttribute('data-linkable-allow'))
      .map((el) => el.getAttribute('href'))
      .filter((h) => {
        if (!h || h.startsWith('#') || h.startsWith('/')) return false;
        try {
          const linkOrigin = new URL(h, pageOrigin).origin;
          return linkOrigin !== pageOrigin && isBackend(linkOrigin);
        } catch { return false; }
      });
  })()`) as string[];

  expect(offSite, `Links pointing at backend on ${page.url()}:\n${offSite.join('\n')}`).toEqual([]);
}

/**
 * Every internal link must actually resolve.
 *
 * Until now nothing checked this. `verifyNoBackendLinks` above discards any
 * href starting with "/" before it looks at anything — it asks "does this point
 * at the wrong ORIGIN?", never "does this go anywhere?" — and the block-level
 * check in BlockVerificationHelper does the same. So a link to a page that does
 * not exist passed every gate and shipped: a doc page linking to
 * /components/sections when the page is `section`, a card whose href was the
 * Plone admin's own `./add?type=Document` (which resolved to
 * /./add?type=Document), and a set of "related pages" lists.
 *
 * Asking the browser is what makes this simple. The alternative — matching paths
 * against the content manifest offline — cannot tell a typo from a link that is
 * fine: content served under a mount prefix, a frontend route with no content
 * object behind it (/dev/blocks/*), a relative href, a static asset in public/.
 * Each needed its own special case and the result still misjudged links. The
 * browser resolves all of that natively, because it is the thing doing the
 * resolving.
 *
 * `alreadyChecked` lets a per-page walker share one set across pages, so the
 * site chrome's links (nav, footer) are fetched once rather than once per page.
 */
export async function verifyNoDeadLinks(
  page: Page,
  options: { alreadyChecked?: Set<string>; concurrency?: number } = {},
): Promise<void> {
  const seen = options.alreadyChecked;
  // Gentle by default. A local server shrugs off 8 at once; the deployed single
  // machine returns 500 for ALL of them — verified: the same URLs answer 200
  // sequentially. A checker that manufactures its own failures is worse than no
  // checker, so callers hitting a real host should lower this further.
  const concurrency = options.concurrency ?? 4;

  const hrefs = (await page.evaluate(`(() => {
    const origin = window.location.origin;
    const out = new Set();
    for (const el of document.querySelectorAll('a[href]')) {
      const raw = el.getAttribute('href');
      if (!raw) continue;
      // A fragment is a position on this page, not a destination. Other schemes
      // (mailto:, tel:) are not ours to resolve.
      if (raw.startsWith('#')) continue;
      let url;
      try { url = new URL(raw, window.location.href); } catch { continue; }
      if (url.origin !== origin) continue;   // off-site: verifyNoBackendLinks' job
      out.add(url.pathname + url.search);
    }
    return Array.from(out);
  })()`)) as string[];

  const toCheck = hrefs.filter((h) => !seen || !seen.has(h));
  for (const h of toCheck) seen?.add(h);

  // Fetched from INSIDE the page, concurrently.
  //
  // Not page.request (Playwright's APIRequestContext): against the deployed
  // site every one of those timed out at 15s while curl answered the same HEAD
  // in 0.5s — a harness problem masquerading as dead links. The page's own
  // fetch() is the same mechanism the browser uses for the links being checked,
  // has the page's cookies and origin, and is what the video/audio check
  // already uses successfully.
  //
  // Serially this is fine on localhost and hopeless remotely (~25 chrome links
  // × network latency), so it runs with a small concurrency cap.
  const dead = await page.evaluate(
    async ({ hrefs, concurrency }: { hrefs: string[]; concurrency: number }) => {
      const out: string[] = [];
      const queue = [...hrefs];
      const worker = async () => {
        for (;;) {
          const href = queue.shift();
          if (href === undefined) return;
          try {
            // HEAD first (cheap); some routes only answer GET, so fall back
            // rather than report a 405 as a dead link.
            let resp = await fetch(href, { method: 'HEAD', redirect: 'follow' });
            if (resp.status === 405 || resp.status === 501) {
              resp = await fetch(href, { method: 'GET', redirect: 'follow' });
            }
            if (resp.status >= 400) out.push(`${href} -> HTTP ${resp.status}`);
          } catch (e) {
            // A request that cannot complete is a defect worth seeing, not a
            // silent pass.
            out.push(`${href} -> ${(e as Error).message}`);
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, queue.length) }, worker),
      );
      return out.sort();
    },
    { hrefs: toCheck, concurrency },
  );

  expect(dead, `Dead links on ${page.url()}:\n${dead.join('\n')}`).toEqual([]);
}

/**
 * Run every page-level integrity check in order. Composes the smaller
 * checks so a consumer only needs to wire one call.
 */
export async function verifyPageIntegrity(
  page: Page,
  options: PageIntegrityOptions & { alreadyChecked?: Set<string> } = {},
): Promise<void> {
  await verifyNoBrokenImages(page);
  await verifyNoBackendLinks(page, options);
  await verifyNoDeadLinks(page, options);
}
