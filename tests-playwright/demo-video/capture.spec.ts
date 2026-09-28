/**
 * Homepage demo video capture.
 *
 * Records a single deterministic edit session against /demo-video-page that
 * shows off slate editing + DnD + container ops + frontend switching, in a
 * tight ~12-second loop suitable for the docs homepage hero (à la plate.js).
 *
 * The fixture is DEDICATED to this capture — nothing else reads it. It used to
 * record /showcase-page, which is shared with screenshots/capture.spec.ts and
 * inline-editing-placeholders.spec.ts, so a change made for either of those
 * would silently alter the published homepage video. Keep it exclusive.
 *
 * Block ids in that fixture are load-bearing: the beats below drive 'intro',
 * 'columns-1' and 'after-columns' by name.
 *
 * Run with:
 *   pnpm demo:capture
 *
 * Output: tests-playwright/demo-video/.recordings/<timestamp>.webm
 *   then `pnpm demo:encode` re-muxes that into docs/_static/hydra-demo.mp4
 *   for embedding in docs/index.md.
 *
 * Pacing comes from DEMO_PACING (set by `pnpm demo:capture`), never from a
 * fixed pause: each caption holds for as long as its words take to read, and a
 * beat with nothing to read ends on `holdOn(page, glance())`. Resist the urge to
 * make individual actions fast — the storytelling cadence matters more than
 * realism here.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { glance, holdOn, readFor } from '../helpers/demoPacing';
import { PORTS, URLS } from '../ports';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEMO_PATH = '/demo-video-page';
const TRIM_MARKER_FILE = path.join(SCRIPT_DIR, '.recordings', 'trim-ms.txt');

test.describe.configure({ mode: 'serial' });

// Required local servers for the demo capture. Missing any of these
// produces a recording with broken iframes / blank frames, so we fail
// fast instead. Update this list (and start:test / RAZZLE_DEFAULT_IFRAME_URL)
// together if the demo flow gets new beats.
const REQUIRED_SERVERS = [
  { url: `${URLS.mockApi}/@search?path=/`, label: `mock-api on :${PORTS.mockApi}    (pnpm start:mock-api)` },
  // Check the admin's SSR server, not the webpack-dev-server /health. record-doc-assets
  // runs `pnpm start:prod` (SSR only, no :${PORTS.voltoWebpack}); local dev's `pnpm start:test`
  // serves the admin on :${PORTS.voltoSsr} too, so this check passes in both. A missing
  // admin fetch-fails; one mid-compile returns 503 and is caught below.
  { url: `${URLS.voltoSsr}/`,              label: `Volto admin on :${PORTS.voltoSsr} (pnpm start:test or start:prod)` },
  { url: `${URLS.nuxt}/`,                  label: `Nuxt on :${PORTS.nuxt}          (pnpm start:nuxt:test)` },
  { url: `${URLS.f7}/`,                    label: `F7 Mobile on :${PORTS.f7}     (cd examples/hydra-vue-f7 && pnpm dev:test)` },
];

test.beforeAll(async () => {
  const failures: string[] = [];
  for (const { url, label } of REQUIRED_SERVERS) {
    try {
      // Generous timeout: the mock /@search can take ~3.5s cold, and an admin
      // still warming can be slow — a tight 2s aborts a healthy-but-cold server.
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (r.status >= 500) failures.push(`${label} — HTTP ${r.status}`);
    } catch (e) {
      failures.push(`${label} — ${(e as Error).message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Demo video capture requires these servers to be running:\n  ` +
      failures.join('\n  ') +
      `\nStart them and retry. The expected frontend list (with names) is set in the start:test script.`,
    );
  }
});

test('hydra-demo — homepage hero loop', async ({ page }) => {
  test.setTimeout(240_000);
  const helper = new AdminUIHelper(page);
  await helper.login();
  await helper.navigateToEdit(DEMO_PATH);

  // A settled editor before any beats — the recording includes login + iframe
  // load, which are visually noisy and are trimmed off the published clip.
  const iframe = page.frameLocator('iframe');
  await page.waitForLoadState('networkidle');
  await expect(iframe.locator('[data-block-uid="intro"]')).toBeVisible();
  await expect(iframe.locator('[data-block-uid="columns-1"]')).toBeVisible();

  // Stamp the timestamp where beats begin so encode can -ss-trim the
  // loading prefix off the .webm. Playwright videos start at t=0 when
  // the page is created; this performance.now() is "ms since page
  // create" → "seconds to skip in ffmpeg".
  const trimMs = await page.evaluate(() => performance.now());
  fs.mkdirSync(path.dirname(TRIM_MARKER_FILE), { recursive: true });
  fs.writeFileSync(TRIM_MARKER_FILE, String(trimMs));
  console.log(`[demo-video] trim point: ${trimMs.toFixed(0)} ms`);

  // Playwright 1.61 screencast: an animated pointer that tracks between action points,
  // over the iframe too. Per-action labels are suppressed — caption() narrates each beat.
  await helper.enableDemoCursor();

  // Beat 1 — type into a slate paragraph. Shows live preview updating.
  // Assert: the typed text actually lands in the iframe.
  await helper.caption('Edit any text inline');
  await helper.clickBlockInIframe('intro');
  await helper.waitForBlockSelectedInAdmin('intro');
  await page.keyboard.press('End');
  await page.keyboard.type(' Edit anywhere.', { delay: 40 });
  await expect(iframe.locator('[data-block-uid="intro"]'))
    .toContainText('Edit anywhere.', { timeout: 5_000 });
  await holdOn(page, readFor('Edit anywhere.'));

  await helper.caption('Format with the toolbar');
  // Beat 2 — bold the phrase we just typed (Quanta toolbar).
  // No DOM-level assertion — Slate's bold rendering varies by frontend
  // (could be <strong>, <b>, or a styled span); the visual recording
  // captures the formatting toolbar interaction either way.
  await page.keyboard.press('Shift+Home');
  await expect
    .poll(() => iframe.locator('body').evaluate(() => document.getSelection()?.toString() ?? ''))
    .toContain('Edit anywhere.');
  await page.keyboard.press('Meta+B');
  await holdOn(page, glance());

  // Beat 3 — drop into block mode, drag the intro paragraph past the
  // adjacent column block to show DnD reflow. The dragBlockAfter helper
  // asserts the drop completed; the post-drop DOM order is implicit.
  await helper.caption('Switch to block mode');
  await helper.escapeFromEditing();
  await holdOn(page, glance());
  await helper.caption('Drag blocks to reorder');
  await helper.dragBlockAfter('intro', 'after-columns');
  await holdOn(page, glance());

  await helper.caption('Blocks nest in containers');
  // Beat 4 — click into the columns container. waitForBlockSelectedInAdmin
  // is the assertion; the helper fails if the selection state doesn't land.
  await helper.clickBlockInIframe('columns-1');
  await helper.waitForBlockSelectedInAdmin('columns-1');
  await holdOn(page, glance());

  // Beat 5 — open the frontend switcher panel, switch to mobile
  // viewport, then click F7 Mobile. The iframe swaps to the F7
  // frontend at mobile width showing the same content through a
  // different design system — the omni-channel feature in action.
  // Requires the F7 dev frontend on its dedicated port (pnpm --filter hydra-vue-f7
  // run dev:test) and the start:test env var to map "F7 Mobile" to
  // that URL.
  // The panel is held long enough to read its entry names (each frontend has
  // a label like "Nuxt blog" or "F7 Mobile") before anything is picked.
  await helper.caption('Preview in any frontend');
  await page.locator('#toolbar-frontend-switcher').click();
  const panel = page.locator('.frontend-switcher-panel');
  await panel.waitFor({ state: 'visible' });
  await holdOn(page, readFor(await panel.innerText()));

  // Switch to mobile viewport first so the F7 frontend lands at the
  // intended phone width rather than full-bleed desktop.
  await helper.caption('Switch to a mobile view');
  await panel.getByLabel('Mobile').click();
  await expect(panel.getByLabel('Mobile')).toHaveClass(/\bactive\b/);
  await holdOn(page, glance());

  const f7Item = panel.locator('.frontend-switcher-url-item', { hasText: 'F7 Mobile' });
  await f7Item.waitFor({ state: 'visible', timeout: 5_000 });
  await holdOn(page, readFor('F7 Mobile'));
  await f7Item.click();
  await expect(async () => {
    const src = await page.locator('#previewIframe').getAttribute('src');
    expect(src).toContain(`localhost:${PORTS.f7}`);
  }).toPass({ timeout: 5_000 });
  // The F7 frontend has drawn the same content, so the swap is captured and not
  // just the URL change — then the closing caption holds for its words.
  await expect(page.frameLocator('#previewIframe').locator('[data-block-uid="intro"]')).toBeVisible();
  await helper.caption('Same content, another design system');
  await holdOn(page, glance());
});
