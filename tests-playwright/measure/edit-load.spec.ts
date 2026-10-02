import { test } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * How long an edit page takes to become editable — over the adapter and direct.
 *
 * Not a test: it asserts nothing and fails nothing. It exists because the cost of
 * the bridge kept being argued about rather than measured, and because this
 * branch added gates on the load path (`ensureSiteLoaded`, the adapter's own
 * frame, the content type arriving over the bridge) whose cost nobody had
 * counted. The earlier measurement was suite wall-time and CPU; that says
 * nothing about the thing an editor actually waits for.
 *
 *   RAZZLE_USE_BRIDGE_BACKEND=true  pnpm exec playwright test --project=measure
 *   RAZZLE_USE_BRIDGE_BACKEND=false pnpm exec playwright test --project=measure
 *
 * The two modes need separate runs: the switch is read by the Volto server at
 * start, so a single run cannot hold both. Locally that server is razzle in dev
 * mode, so these numbers are worth comparing with EACH OTHER and not with
 * production — the absolute figures carry webpack's dev overhead.
 *
 * Milestones are waited for CONCURRENTLY. Waiting for them in sequence would
 * make each one's number include the wait for the one before it, which is how a
 * measurement quietly becomes a cumulative total.
 */

const RUNS = Number(process.env.MEASURE_RUNS ?? 5);
const BLOCK = 'block-1-uuid';
const PREFIX = '/_test_data';

/** Median, not mean: one cold outlier should not set the number. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

test('time to editable on an edit route', async ({ page }) => {
  test.setTimeout(RUNS * 60_000 + 60_000);

  const initErrors: string[] = [];
  page.on('pageerror', (error) => {
    if (error.message.includes('content type schema has not loaded')) {
      initErrors.push(error.message);
    }
  });

  // Every CMS request, from any frame — the adapter's own requests come from the
  // proxy frame, not the main one. Recorded with the query string, which is what
  // the mock's log leaves out and what tells an expand apart from a repeat.
  const API = `http://localhost:${process.env.HYDRA_MOCK_API_PORT}`;
  let recording = false;
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!recording || !url.startsWith(API)) return;
    // Method and originating frame, because "who asked for this" is the whole
    // question: the adapter's requests come from the proxy frame, the admin's
    // from the main one, and the frontend's from the preview.
    const frame = request.frame();
    const origin = frame === page.mainFrame() ? 'admin' : new URL(frame.url()).port;
    requests.push(`${request.method()} [${origin}] ${url.slice(API.length)}`);
  });

  // BridgeApi's own audit: every routed call and every failure, in order.
  // MEASURE_AUDIT=1 turns it on — it is noisy, so it is off for timing runs.
  if (process.env.MEASURE_AUDIT) {
    await page.addInitScript(() => {
      (window as any).__HYDRA_AUDIT = true;
    });
  }

  const helper = new AdminUIHelper(page);
  await helper.login();
  const base = new URL(page.url()).origin;

  const samples: Record<string, number[]> = {
    // Named for what they are: the edit page ready, and able to type in it.
    editPageReady: [],
    editable: [],
  };

  // One discarded pass first. Locally the admin is a dev server, so the first
  // visit pays for compiling the route; counting it would measure webpack.
  await helper.navigateToEdit('/test-page');
  initErrors.length = 0;
  recording = true;

  for (let run = 0; run < RUNS; run += 1) {
    // Away, then back, both through the helper. It does what the admin does —
    // pushState once it is on a Volto page — and hand-rolling that navigation
    // is what the earlier attempts here kept getting wrong. Its internal waits
    // are identical in both modes, so the comparison stays fair even though the
    // numbers include them.
    await helper.navigateToView('/test-page');

    const started = Date.now();
    await helper.navigateToEdit('/test-page');
    samples.editPageReady.push(Date.now() - started);

    // And the thing an editor is actually waiting for: being able to type.
    await helper.enterEditMode(BLOCK);
    samples.editable.push(Date.now() - started);
  }

  const mode =
    process.env.RAZZLE_USE_BRIDGE_BACKEND === 'false' ? 'direct' : 'adapter';
  console.log(`\n[measure] ${mode}, ${RUNS} runs, milliseconds from goto()`);
  for (const [name, values] of Object.entries(samples)) {
    if (!values.length) {
      console.log(`  ${name.padEnd(14)} never appeared`);
      continue;
    }
    console.log(
      `  ${name.padEnd(14)} median ${String(median(values)).padStart(6)}   ` +
        `min ${String(Math.min(...values)).padStart(6)}   ` +
        `max ${String(Math.max(...values)).padStart(6)}`,
    );
  }
  // The load-order fault, counted rather than described.
  console.log(`  ${'INIT errors'.padEnd(14)} ${initErrors.length}`);

  // What the admin asked the CMS for, so "the adapter is slower" can be read as
  // a list of requests rather than left as a number.
  const byUrl = new Map<string, number>();
  for (const url of requests) byUrl.set(url, (byUrl.get(url) ?? 0) + 1);
  console.log(`  ${'CMS requests'.padEnd(14)} ${requests.length} total, ${byUrl.size} distinct`);
  for (const [url, count] of [...byUrl].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${String(count).padStart(4)}x ${url.slice(0, 150)}`);
  }
});
