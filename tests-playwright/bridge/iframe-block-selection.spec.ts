/**
 * Selecting a block whose body is an IFRAME.
 *
 * Hydra selects blocks with a capture-phase click listener on the PAGE's
 * document. A click inside a nested browsing context never reaches that
 * document — no bubbling, no capture — so a block whose body is an iframe
 * cannot be selected by clicking the thing itself: the author's click
 * disappears into the embed.
 *
 * That is not a rare shape. An embedded video is an iframe, so is a map, so is
 * the PDF preview (pdfjs-viewer-element is PDF.js in an iframe), so is anything
 * from the embed block. On the NSW frontend none of them can be selected on the
 * canvas. It surfaced as a doc-video recording that clicked a PDF block five
 * different ways and got either an outline with no toolbar or no selection at
 * all.
 *
 * The fixture uses two real blocks rather than hand-made markup: the VIDEO
 * block, which the test frontend renders as a bare iframe, and the MAPS block,
 * which it renders through a custom element holding the iframe in a shadow root
 * (see `defineMapEmbedElement` in the test frontend's renderer, and
 * docs/examples/maps.md). Nothing here needs an embed to LOAD: the iframe
 * element swallows the click whether or not the provider answers, so the tests
 * carry no network dependency.
 */
import type { Page } from '@playwright/test';
import { test, expect, getFrontendUrl } from './fixtures';
import { URLS } from '../ports';

// Which frontend the mock parent frames.
//
// mock-parent.html resolves its frontend as `?frontend=` → `window._frontendOrigin`
// → its own origin. A beforeEach that re-navigates without the parameter
// therefore tests whatever the JOB happens to have injected: the mock renderer
// locally (nothing injected) and the job's own frontend in CI. That is not a
// choice, it is a coin toss, and it read as a bridge failure in the nextjs/f7
// job while passing everywhere else. Say which frontend the test means.
const parentUrl = (frontend: string, path: string) =>
  `${URLS.testFrontend}/mock-parent.html?frontend=${encodeURIComponent(frontend)}` +
  `&api_path=${encodeURIComponent(`${URLS.mockApi}${path}`)}`;

// A video block's url is a YouTube one, because that is what the frontends
// render a video embed FROM — the mock renderer and both example frontends
// rewrite it to youtube.com/embed/<id>. The request is answered here instead of
// by YouTube: the markup under test is production's, the document that lands in
// the frame is ours, and the test needs no network.
const stubYouTube = (page: Page) =>
  page.route(/youtube\.com\/embed\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body:
        '<!doctype html><meta charset="utf-8"><title>Video</title>' +
        '<style>html,body{margin:0;height:100%}main{height:100%;background:#223;' +
        'color:#fff;display:grid;place-items:center;font:14px system-ui}</style>' +
        '<main tabindex="0">A video</main>',
    }),
  );

/**
 * Wait until the embed is REALLY loaded — its document is in the page's frame
 * tree, not merely an <iframe> element in the DOM.
 *
 * This is the difference between testing embed selection and testing nothing.
 * An embed that never loads does not swallow the click: it falls through to the
 * page, the ordinary click path selects the block, and the test goes green
 * without an embed ever being involved. That is exactly what this spec did —
 * it passed on the test frontend, where the click never entered the frame, and
 * failed on the nextjs example, where it did.
 */
/**
 * Wait for the admin's OWN initial selection to land before clicking anything.
 *
 * The mock parent auto-selects the first block once the page is in. On a slower
 * frontend that can arrive AFTER a click, which then reads as the click having
 * failed: the block really was selected, and the auto-selection replaced it a
 * moment later. Let the page settle on its own choice, then change it.
 */
const waitForInitialSelection = async (helper: any) => {
  await expect
    .poll(() => selectedUid(helper), { timeout: 15000 })
    .toBeTruthy();
};

const waitForEmbedLoaded = async (page: Page, urlPart: string, text: string) => {
  // The frame's own CONTENT, not just its url: a frame that 404s or is refused
  // still reports the url it tried, so a url check calls a failed embed loaded.
  await expect
    .poll(
      async () => {
        const frame = page.frames().find((f) => f.url().includes(urlPart));
        if (!frame) return '';
        return (await frame.locator('body').textContent().catch(() => '')) || '';
      },
      { timeout: 15000 },
    )
    .toContain(text);
};

const PAGE = '/_test_data/iframe-block-page';
const BLOCK = 'video-embed-1';
// A MAPS block: the test frontend renders it as an iframe inside a custom
// element's shadow root, which is a real PDF preview's shape.
const SHADOW_BLOCK = 'maps-embed-1';

const selectedUid = (helper: any) =>
  helper
    .getIframe()
    .locator('body')
    .evaluate(
      (node: HTMLElement) =>
        (node.ownerDocument.defaultView as any).__hydraBridge?.selectedBlockUid,
    );

test.describe('a block whose body is an iframe', () => {
  // Runs against each project's OWN frontend: the mock renderer, nextjs and f7
  // all render a video block as an iframe, so the shape under test is real in
  // every one of them.
  test.beforeEach(async ({ page, helper }, testInfo) => {
    await stubYouTube(page);
    await page.goto(
      parentUrl(getFrontendUrl(testInfo.project.name) || URLS.testFrontend, PAGE),
    );
    await helper
      .getIframe()
      .locator(`[data-block-uid="${BLOCK}"] iframe`)
      .waitFor({ state: 'attached', timeout: 10000 });
    await waitForEmbedLoaded(page, 'youtube.com/embed/', 'A video');
    await waitForInitialSelection(helper);
  });

  test('is selected by clicking it', async ({ helper }) => {
    // The middle of the block is the middle of the iframe — exactly where an
    // author clicks a video, a map or a PDF preview.
    await helper.getIframe().locator(`[data-block-uid="${BLOCK}"]`).click();

    await expect.poll(() => selectedUid(helper), { timeout: 5000 }).toBe(BLOCK);
  });

  test('tells the admin its content is an embed, so the toolbar can stay put', async ({
    helper,
    page,
  }) => {
    // The toolbar starts faded and un-fades on MOUSE_ACTIVITY — mousedown and
    // mousemove in the frontend's document. A block whose content is an embed
    // reports neither while the author uses it: the events belong to the embed.
    // Fading is right for ordinary blocks (the toolbar sits over content the
    // author is reading); for an embed it hides the controls seconds into the
    // interaction and nothing brings them back.
    //
    // The bridge is the only side that can see an embed, so it says so.
    await helper.getIframe().locator(`[data-block-uid="${BLOCK}"]`).click();

    await expect
      .poll(
        () =>
          page.evaluate(
            (uid) => (window as any).mockParent.blockSelectedByUid?.[uid]?.hasEmbed,
            BLOCK,
          ),
        { timeout: 5000 },
      )
      .toBe(true);
  });

  test('is still selectable by its own box, as it always was', async ({ helper }) => {
    // The half that works today: a click landing on the block's box rather than
    // the embed. Pinned so a fix for the case above cannot take it away.
    await helper
      .getIframe()
      .locator(`[data-block-uid="${BLOCK}"]`)
      .click({ position: { x: 2, y: 2 } });

    await expect.poll(() => selectedUid(helper), { timeout: 5000 }).toBe(BLOCK);
  });
});

test.describe('a block whose embed is inside a shadow root', () => {
  // The maps block. The test frontend renders it through `<map-embed>`, a
  // custom element that builds its iframe in a shadow root — the shape of
  // `<pdfjs-viewer-element>` and of every consent-gated third-party embed, and
  // the reason the PDF preview could not be selected on the NSW frontend.
  //
  // It is a real, registered block type carrying real content, so every other
  // frontend's block sanity is happy with the fixture page. An invented @type
  // was not: shared content is served to all of them.
  // Pinned to the test frontend, which is the one that renders maps through
  // <map-embed> (see its renderer, and docs/examples/maps.md). The example
  // frontends render maps as a bare iframe — a legitimate way to write the
  // block, and already covered by the video case above. Pinning runs this
  // everywhere rather than skipping it somewhere.
  test.beforeEach(async ({ page, helper }) => {
    await page.goto(parentUrl(URLS.testFrontend, PAGE));
    await helper
      .getIframe()
      .locator(`[data-block-uid="${SHADOW_BLOCK}"] map-embed`)
      .waitFor({ state: 'attached', timeout: 10000 });
    await waitForEmbedLoaded(page, 'embedded-document.html', 'An embedded document');
    await waitForInitialSelection(helper);
  });

  test('is selected by clicking it', async ({ helper }) => {
    // The shadow boundary is why this needs its own case: document.activeElement
    // reports the HOST, not the iframe inside it, and the iframe's closest()
    // cannot reach back out to the block. Focus landing on the host is both the
    // signal and the only way back to the block.
    await helper.getIframe().locator(`[data-block-uid="${SHADOW_BLOCK}"]`).click();

    await expect.poll(() => selectedUid(helper), { timeout: 5000 }).toBe(SHADOW_BLOCK);
  });

  test('reports its embed to the admin, through the shadow root', async ({
    helper,
    page,
  }) => {
    await helper.getIframe().locator(`[data-block-uid="${SHADOW_BLOCK}"]`).click();

    await expect
      .poll(
        () =>
          page.evaluate(
            (uid) => (window as any).mockParent.blockSelectedByUid?.[uid]?.hasEmbed,
            SHADOW_BLOCK,
          ),
        { timeout: 5000 },
      )
      .toBe(true);
  });
});
