/**
 * Per-block example-page screenshot capture.
 *
 * For each docs/examples/<slug>.md page, opens /docs/examples/<slug>/edit,
 * selects the block instance that the page is showcasing, and writes a
 * full-page screenshot straight into docs/images/<slug>-edit.png — the
 * committed blob the example page embeds (`![...](/docs/images/<slug>-edit.png)`).
 * Re-running this regenerates those images in place; the markdown is the
 * single source, so there is no separate staging/materialise step (the old
 * sync.mjs Phase 5/5b that copied a staging dir into Plone content is gone).
 *
 * Which block to select is read from the SERVED page over the mock API
 * (/docs/examples/<slug>), never from a content tree on disk — the served
 * block uids are what the iframe actually renders, so the selector matches.
 *
 * Run with:
 *   pnpm exec playwright test --project=screenshots-nuxt \
 *     tests-playwright/screenshots/example-blocks.spec.ts
 *
 * Manual / on-demand. Same project as the editor-guide screenshots so we
 * get the 1440x900 viewport + Nuxt iframe for a polished render.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'images');

fs.mkdirSync(OUT_DIR, { recursive: true });

/**
 * Each entry: docs/examples/<slug>.md gets a screenshot of the first
 * block whose @type matches `blockType` on /docs/examples/<slug>. Pages
 * whose data.json contains no live instance of their headline block
 * (columns, contextNavigation, hero, slider, …) are omitted; those
 * pages document the block via codeExample fences only.
 */
const EXAMPLES: Array<{ slug: string; blockType: string }> = [
  { slug: 'accordion', blockType: 'accordion' },
  { slug: 'button', blockType: 'button' },
  { slug: 'form', blockType: 'form' },
  { slug: 'highlight', blockType: 'highlight' },
  { slug: 'image-block', blockType: 'image' },
  { slug: 'introduction', blockType: 'introduction' },
  { slug: 'listing', blockType: 'listing' },
  { slug: 'maps', blockType: 'maps' },
  { slug: 'search', blockType: 'search' },
  { slug: 'separator', blockType: 'separator' },
  { slug: 'slate', blockType: 'slate' },
  { slug: 'table', blockType: 'slateTable' },
  { slug: 'teaser', blockType: 'teaser' },
  { slug: 'toc', blockType: 'toc' },
  { slug: 'video', blockType: 'video' },
];

/**
 * Find the first block UID on the page whose @type matches `blockType`, read
 * from the SERVED page over the mock API — never a content tree on disk. The
 * served block uids are exactly what the iframe renders (the markdown mount
 * auto-mints them on decode), so the selector matches; reading a JSON artifact
 * off disk gave hex uids the markdown-served DOM no longer has.
 *
 * Skips the page's own embedded editor screenshot: each example page carries an
 * `![...](/docs/images/<slug>-edit.png)` image block, which would otherwise
 * shadow the real `image` example block when blockType==='image'.
 */
async function firstBlockUidOfType(slug: string, blockType: string): Promise<string> {
  const url = `${URLS.mockApi}/docs/examples/${slug}`;
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`fetch ${url} failed: ${resp.status} ${resp.statusText}`);
  const data = await resp.json();
  const items: string[] = data.blocks_layout?.items || [];
  for (const uid of items) {
    const block = data.blocks?.[uid];
    if (block?.['@type'] !== blockType) continue;
    // The page's own screenshot image references /docs/images/<slug>-edit.png.
    if (JSON.stringify(block).includes(`${slug}-edit`)) continue;
    return uid;
  }
  throw new Error(
    `No block of @type=${blockType} found on ${url}; ` +
      `update EXAMPLES or the example page.`,
  );
}

test.describe('docs/examples/* screenshots', () => {
  // Example pages are heavy — codeExample blocks, nested listings, the
  // cnav force-rule — so allow more than the default per-test budget.
  test.setTimeout(90_000);

  for (const { slug, blockType } of EXAMPLES) {
    test(`${slug} — ${blockType} block selected`, async ({ page }) => {
      // contentPrefix='' so navigateToEdit hits /docs/examples/<slug>/edit
      // directly (not /_test_data/...).
      const helper = new AdminUIHelper(page, URLS.voltoSsr, '');
      await helper.login();
      await helper.navigateToEdit(`/docs/examples/${slug}`);

      const uid = await firstBlockUidOfType(slug, blockType);
      const iframe = helper.getIframe();
      const blockEl = iframe.locator(`[data-block-uid="${uid}"]`).first();
      await blockEl.waitFor({ state: 'attached', timeout: 15000 });
      // Lay the block out on screen before the hit-test below: getBoundingClientRect
      // and elementFromPoint only mean anything once it is visible and in view.
      await blockEl.scrollIntoViewIfNeeded();
      await blockEl.waitFor({ state: 'visible', timeout: 15000 });

      // Pick which editable element to click. `.locator` descends to any
      // depth. When the container holds *restricted* child blocks — form
      // fields, search facets: block types that only exist inside their
      // parent — prefer the first editable that belongs to one of those
      // children. Editing the restricted child is the point of the
      // example (a bare form/search block has little to show), and the
      // container's own editable (a form's `data-edit-text="title"`) sits
      // first in DOM order and would otherwise win. The renderer marks
      // each restricted typed child with `data-block-type`; regular
      // blocks carry only `data-block-uid`. Otherwise click the first
      // editable; with no editable at all (e.g. separator) select the
      // block itself via the bridge.
      //
      // The fallback prefers the first editable that is actually HIT-TESTABLE
      // (the topmost element at its own centre). Overlay-layout blocks like
      // `highlight` render a full-bleed background-image editable first in DOM
      // order but paint their text content on top of it, so clicking the
      // background is intercepted by the overlay. Skipping to the first
      // clickable editable (the title) selects the block without fighting the
      // overlay; blocks whose first editable is already on top are unaffected.
      const editSel = '[data-edit-text], [data-edit-link], [data-edit-media]';
      const pick = await blockEl.evaluate((root, sel) => {
        const hittable = (el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const top = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          return !!top && (top === el || el.contains(top));
        };
        const all = Array.from(root.querySelectorAll(sel));
        let fallback = -1;
        let hittableFallback = -1;
        for (let i = 0; i < all.length; i++) {
          const owner = all[i].closest('[data-block-uid]');
          if (!owner) continue;
          if (fallback === -1) fallback = i;
          if (hittableFallback === -1 && hittable(all[i])) hittableFallback = i;
          if (owner !== root && owner.hasAttribute('data-block-type')) {
            return {
              index: i,
              uid: owner.getAttribute('data-block-uid'),
              restricted: true,
            };
          }
        }
        const index = hittableFallback !== -1 ? hittableFallback : fallback;
        if (index === -1) return null;
        return {
          index,
          uid: all[index]
            .closest('[data-block-uid]')
            ?.getAttribute('data-block-uid'),
          restricted: false,
        };
      }, editSel);

      let selectedUid = uid;
      if (pick) {
        if (pick.restricted && !pick.uid) {
          throw new Error(
            `${slug}: restricted child block is missing a data-block-uid`,
          );
        }
        selectedUid = pick.uid || uid;
        const editable = blockEl.locator(editSel).nth(pick.index);
        await editable.scrollIntoViewIfNeeded();
        await editable.click();
      } else {
        await blockEl.evaluate((el) => {
          (window as any).bridge?.selectBlock(el);
        });
      }
      await helper.waitForBlockSelectedInAdmin(selectedUid);

      // Give the block's form a chance to portal into #sidebar-properties
      // before we snap. Some block types render their UI via
      // ChildBlocksWidget rather than flat fields, so accept any populated
      // child element; a few (separator) have no sidebar form at all.
      const blockForm = page.locator('#sidebar-properties');
      for (let i = 0; i < 25; i++) {
        if ((await blockForm.locator('*').count()) > 0) break;
        await page.waitForTimeout(100);
      }

      // Scroll the block form into view inside the sidebar — page metadata
      // sits above it and on tall content pushes it below the fold.
      if (await blockForm.count()) {
        await blockForm.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      }

      // Allow selection chrome + any final layout shifts to settle.
      await page.waitForTimeout(300);

      // hydra.js paints red diagnostic overlays in the iframe when
      // something is wrong: #hydra-bridge-diagnostic (bridge couldn't
      // reach the admin) and #hydra-dev-warning (e.g. a Slate field with
      // no data-node-id — selection sync broken). Either means the
      // screenshot would ship a broken-looking editor, so fail loudly
      // rather than capture it.
      const diagnostic = helper
        .getIframe()
        .locator('#hydra-bridge-diagnostic, #hydra-dev-warning');
      await expect(
        diagnostic,
        'hydra.js diagnostic overlay present (bridge-not-connected or ' +
          'missing data-node-id) — fix the underlying issue, do not ship ' +
          'this screenshot.',
      ).toHaveCount(0);

      // The Quanta toolbar starts every block selection faded to
      // opacity:0 and only un-fades on pointer activity over the iframe
      // (SyncedSlateToolbar `isFaded`); selecting a block leaves none —
      // bridge.selectBlock fires no pointer events, and a programmatic
      // click's MOUSE_ACTIVITY is overridden by the block-change reset.
      //
      // Re-emit hydra's MOUSE_ACTIVITY by dispatching a `mousemove` on
      // the frontend document — the exact event hydra's reporter listens
      // for. A real Playwright mouse move is no good: blocks like `video`
      // fill themselves with a cross-origin embed <iframe> that swallows
      // the pointer event before hydra's document-level listener sees it.
      // hydra throttles MOUSE_ACTIVITY to 1/sec (hydra.js
      // setupMouseActivityReporter), so dispatch on every poll iteration
      // until one clears the throttle and the toolbar is fully painted.
      // isVisible()/toBeVisible() do NOT detect opacity, so without this
      // assertion a faded toolbar would silently ship a screenshot with
      // no toolbar.
      const toolbar = page.locator('.quanta-toolbar').first();
      await expect(toolbar).toBeAttached();
      const selectedBlockLoc = iframe
        .locator(`[data-block-uid="${selectedUid}"]`)
        .first();
      await expect
        .poll(
          async () => {
            await selectedBlockLoc.evaluate((blockEl) => {
              const r = blockEl.getBoundingClientRect();
              blockEl.ownerDocument.dispatchEvent(
                new MouseEvent('mousemove', {
                  bubbles: true,
                  clientX: r.x + r.width / 2,
                  clientY: r.y + Math.min(60, r.height / 2),
                }),
              );
            });
            return toolbar.evaluate((el) => getComputedStyle(el).opacity);
          },
          {
            message:
              'Quanta toolbar stayed faded — the docs screenshot would ' +
              'have no toolbar.',
            timeout: 8000,
            intervals: [500],
          },
        )
        .toBe('1');

      const file = path.join(OUT_DIR, `${slug}-edit.png`);
      await page.screenshot({ path: file, fullPage: false });
      expect(fs.existsSync(file)).toBe(true);
      console.log(
        `[screenshot] ${slug} -> ${path.relative(process.cwd(), file)}`,
      );
    });
  }
});
