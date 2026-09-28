/**
 * Unit tests for demo pacing — how long a recorded demo lets the viewer look.
 *
 * A demo's pauses are not fixed: a caption is held for as long as its words take
 * to read, and a gesture with nothing to read gets a glance. DEMO_PACING turns
 * that on (and sets how slow a glance is); without it every hold is 0, so the
 * same spec runs as a functional test with no waits at all.
 */
import { test, expect } from '@playwright/test';
import { showCaption } from '../helpers/caption';
import { glance, holdOn, pacingUnitMs, readFor } from '../helpers/demoPacing';

test.describe('demo pacing', () => {
  let saved: string | undefined;
  test.beforeEach(() => {
    saved = process.env.DEMO_PACING;
  });
  test.afterEach(() => {
    if (saved === undefined) delete process.env.DEMO_PACING;
    else process.env.DEMO_PACING = saved;
  });

  test('off without DEMO_PACING: nothing is held', () => {
    delete process.env.DEMO_PACING;
    expect(pacingUnitMs()).toBe(0);
    expect(glance()).toBe(0);
    expect(readFor('Pick the page it goes to')).toBe(0);
  });

  test('a glance is one DEMO_PACING unit', () => {
    process.env.DEMO_PACING = '700';
    expect(glance()).toBe(700);
  });

  test('reading time grows with the words, not a fixed beat', () => {
    process.env.DEMO_PACING = '700';
    const short = readFor('Pick a style');
    const long = readFor(
      'Leave it empty and you write the options yourself, which is the better answer when they belong to that question alone',
    );
    expect(short).toBeGreaterThan(glance());
    expect(long).toBeGreaterThan(short * 3);
    // 3 words at the reference pace: a glance to notice it + 240ms a word.
    expect(short).toBe(700 + 3 * 240);
  });

  test('a slower DEMO_PACING slows reading in proportion', () => {
    process.env.DEMO_PACING = '700';
    const normal = readFor('Pick a style');
    process.env.DEMO_PACING = '1400';
    expect(readFor('Pick a style')).toBe(normal * 2);
  });

  test('nothing to read is a glance', () => {
    process.env.DEMO_PACING = '700';
    expect(readFor('   ')).toBe(glance());
  });

  test('a DEMO_PACING that is not a number fails loudly', () => {
    process.env.DEMO_PACING = 'slow';
    expect(() => pacingUnitMs()).toThrow(/DEMO_PACING/);
    process.env.DEMO_PACING = '-5';
    expect(() => pacingUnitMs()).toThrow(/DEMO_PACING/);
  });

  test('holdOn refuses a hold that is not a duration', async () => {
    const page = {} as never;
    await expect(holdOn(page, Number.NaN)).rejects.toThrow(/hold/);
    await expect(holdOn(page, -1)).rejects.toThrow(/hold/);
  });

  /** A page that draws captions in the DOM path and records what was waited. */
  const recordingPage = () => {
    const waits: number[] = [];
    const page = {
      evaluate: async () => undefined,
      waitForTimeout: async (ms: number) => {
        waits.push(ms);
      },
    } as never;
    return { page, waits };
  };

  test('a caption holds for its own words while pacing is on', async () => {
    process.env.DEMO_PACING = '700';
    const { page, waits } = recordingPage();
    await showCaption(page, 'Pick the page it goes to');
    expect(waits).toEqual([readFor('Pick the page it goes to')]);
  });

  test('a caption given a hold uses it instead', async () => {
    process.env.DEMO_PACING = '700';
    const { page, waits } = recordingPage();
    await showCaption(page, 'Pick a style', { hold: glance() });
    expect(waits).toEqual([700]);
  });

  test('a caption does not wait in a functional run', async () => {
    delete process.env.DEMO_PACING;
    const { page, waits } = recordingPage();
    await showCaption(page, 'Pick the page it goes to');
    expect(waits).toEqual([]);
  });

  test('a screencast caption is not a hidden wait', async () => {
    // Playwright 1.61's showOverlay(html, { duration }) waits out the whole
    // duration before it returns — so a caption given a lifetime blocked the demo
    // for 15s. It must stay up until the next caption replaces it instead.
    delete process.env.DEMO_PACING;
    const calls: unknown[] = [];
    const page = {
      evaluate: async () => undefined,
      screencast: {
        showOverlay: async (_html: string, options?: unknown) => {
          calls.push(options);
          return { dispose: async () => undefined };
        },
      },
    } as never;
    await showCaption(page, 'Edit any text inline');
    expect(calls).toEqual([undefined]);
  });

  test('hiding the caption does not wait', async () => {
    process.env.DEMO_PACING = '700';
    const { page, waits } = recordingPage();
    await showCaption(page, '');
    expect(waits).toEqual([]);
  });

  test('holdOn(0) returns without touching the page', async () => {
    // A functional run: readFor/glance give 0, and nothing may wait.
    const page = {
      waitForTimeout: () => {
        throw new Error('waited');
      },
    } as never;
    await holdOn(page, 0);
  });
});
