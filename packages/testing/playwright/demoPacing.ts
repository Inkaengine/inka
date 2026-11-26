import type { Page } from '@playwright/test';

/**
 * How long a recorded demo lets the viewer look — and the ONLY place a demo
 * waits.
 *
 * A demo pause is not a fixed beat. What a viewer needs depends on what is on
 * screen: a caption needs as long as its words take to read, a result the same
 * for the words it shows, and a gesture with nothing to read needs a glance. So
 * a demo spec never passes a bare number. It passes `readFor(<the words>)` or
 * `glance()`, and reading the spec tells you what each hold is for:
 *
 *   await showCaption(page, 'Pick a style');          // holds readFor(its text)
 *   await holdOn(page, readFor('Start now'));          // the result just typed
 *   await holdOn(page, glance());                      // a gesture, nothing to read
 *
 * `DEMO_PACING` turns pacing on and sets how long a glance is, in ms (the docs
 * Makefiles use 700). Without it every hold is 0 and `holdOn` returns without
 * touching the page, so the same spec runs as a functional test with no waits.
 */

/** The glance `WORD_MS` was tuned against. A slower glance slows reading too. */
const REFERENCE_UNIT_MS = 700;

/** Time per word at the reference pace: ~250 words a minute. */
const WORD_MS = 240;

/** One glance, in ms; 0 when pacing is off. */
export function pacingUnitMs(): number {
  const raw = process.env.DEMO_PACING;
  if (raw === undefined || raw === '') return 0;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`DEMO_PACING must be a glance length in ms (e.g. 700), got "${raw}"`);
  }
  return ms;
}

/** A look at a gesture with nothing to read. */
export function glance(): number {
  return pacingUnitMs();
}

/**
 * Long enough to notice `text` and read it: a glance, plus time per word,
 * scaled by DEMO_PACING like the glance. 0 when pacing is off.
 */
export function readFor(text: string): number {
  const unit = pacingUnitMs();
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return unit + (words * WORD_MS * unit) / REFERENCE_UNIT_MS;
}

/**
 * Hold the demo for `ms` — from `readFor` or `glance`, never a literal. A 0 hold
 * (pacing off) returns at once without touching the page.
 */
export async function holdOn(page: Page, ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`hold must be a duration from readFor()/glance(), got ${ms}`);
  }
  if (ms === 0) return;
  await page.waitForTimeout(ms);
}
