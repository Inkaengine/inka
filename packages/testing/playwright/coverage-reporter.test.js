/**
 * The coverage reporter's aggregation-and-fail contract, tested without a live
 * Playwright run: feed it attachments exactly as onTestEnd receives them from
 * every worker, then assert onEnd fails the run precisely when a gap exists.
 *
 * This is the "does the reporter actually fail" guarantee — the aggregates
 * themselves are proven in field-coverage / text-style-coverage unit tests.
 */
import CoverageReporter from './coverage-reporter.ts';

// SANITY_OPTION_EXAMPLES=false isolates these to the ATTACHED records (field +
// style), so the reporter never reaches .discovered-blocks.json on disk.
const OLD_ENV = process.env.SANITY_OPTION_EXAMPLES;
beforeAll(() => (process.env.SANITY_OPTION_EXAMPLES = 'false'));
afterAll(() => (process.env.SANITY_OPTION_EXAMPLES = OLD_ENV));

/** A TestResult carrying one 'coverage' attachment, as onTestEnd sees it. */
const resultWith = (fields, styles) => ({
  attachments: [
    {
      name: 'coverage',
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ fields, styles })),
    },
  ],
});

const feed = (reporter, ...results) => {
  for (const r of results) reporter.onTestEnd({}, r);
};

// One paragraph that renders distinctly — enough to pass the fail-closed guard.
const okStyle = {
  style: 'p',
  blockType: 'slate',
  text: 'body',
  pagePath: '/a',
  rendered: true,
  flat: false,
};

test('passes (returns nothing) when every style renders and every field is editable', async () => {
  const reporter = new CoverageReporter();
  feed(
    reporter,
    resultWith(
      [{ kind: 'link', blockType: 'teaser', field: 'href', editable: true, example: '[t1]' }],
      [okStyle],
    ),
  );
  await expect(reporter.onEnd({ status: 'passed' })).resolves.toBeUndefined();
});

test('FAILS the run when a style renders nowhere in ANY worker', async () => {
  const reporter = new CoverageReporter();
  feed(
    reporter,
    resultWith([], [okStyle]),
    resultWith([], [{ ...okStyle, style: 'h4', text: 'Invisible', pagePath: '/b', rendered: false }]),
  );
  const outcome = await reporter.onEnd({ status: 'passed' });
  expect(outcome).toEqual({ status: 'failed' });
});

test('a field missing in one worker but editable in another is NOT a failure', async () => {
  // The whole reason for cross-worker aggregation: an empty teaser records href
  // "missing" while a real teaser records it "seen". Only the fold sees both.
  const reporter = new CoverageReporter();
  feed(
    reporter,
    resultWith(
      [{ kind: 'link', blockType: 'teaser', field: 'href', editable: false, example: '[empty]' }],
      [okStyle],
    ),
    resultWith(
      [{ kind: 'link', blockType: 'teaser', field: 'href', editable: true, example: '[real]' }],
      [],
    ),
  );
  await expect(reporter.onEnd({ status: 'passed' })).resolves.toBeUndefined();
});

test('FAILS when a field is editable in NO worker', async () => {
  const reporter = new CoverageReporter();
  feed(
    reporter,
    resultWith(
      [{ kind: 'link', blockType: 'teaser', field: 'href', editable: false, example: '[t1]' }],
      [okStyle],
    ),
  );
  expect(await reporter.onEnd({ status: 'passed' })).toEqual({ status: 'failed' });
});

test('does NOT fail an unrelated run that produced no coverage attachments', async () => {
  // Running a different spec must not turn red just because this reporter is
  // registered — it only judges when block-sanity actually attached coverage.
  const reporter = new CoverageReporter();
  reporter.onTestEnd({}, { attachments: [] });
  await expect(reporter.onEnd({ status: 'passed' })).resolves.toBeUndefined();
});

test('FAILS CLOSED when block-sanity ran but recorded zero styles', async () => {
  // A coverage attachment with empty styles is the vacuous-pass shape: the
  // style checks would pass over an empty set. Any real content has paragraphs.
  const reporter = new CoverageReporter();
  feed(reporter, resultWith([{ kind: 'text', blockType: 'slate', field: 'value', editable: true, example: '[t1]' }], []));
  expect(await reporter.onEnd({ status: 'passed' })).toEqual({ status: 'failed' });
});
