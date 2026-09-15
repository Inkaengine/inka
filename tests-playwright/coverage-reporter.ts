// Cross-worker coverage aggregation for block-sanity.
//
// Field-editability and text-style coverage are both "at least one example
// ANYWHERE proves it" findings: a field can be empty (a teaser with no target
// renders a placeholder with no link) or a style absent in some examples and
// legitimately not editable/rendered there. Only "no example anywhere" is a
// finding — over the WHOLE corpus.
//
// block-sanity runs fully parallel, one worker per process. A former
// end-of-file aggregate test saw only its own worker's records and flaked: a
// teaser with an empty href recorded `href` "missing" in one worker while a
// real teaser recorded it "seen" in another, and the split fell either way by
// scheduling. The framework-native fix is here — each test attaches what it
// measured (testInfo.attach), and this reporter runs in the MAIN process where
// it receives every worker's attachments, folds them into one list, and runs
// the aggregates ONCE. No shared files, no worker/ordering assumptions.
//
// It fails the run from onEnd (returning { status: 'failed' }) so a coverage
// gap is a red run, exactly as the old aggregate tests were.
import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
// node: prefixes so the reporter's unit test (vitest/jsdom, which shims a bare
// 'url'/'path' to browser polyfills without fileURLToPath) still gets the real
// Node builtins. Under Playwright these resolve identically.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fieldsNeverEditable,
  type FieldRecord,
} from './helpers/field-coverage';
import {
  stylesNeverRendered,
  stylesRenderingAsPlainText,
  stylesSeenInContent,
  type StyleRecord,
} from './helpers/text-style-coverage';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface CoveragePayload {
  fields: FieldRecord[];
  styles: StyleRecord[];
}

/**
 * Options in .discovered-blocks.json that no example sets — identical in every
 * worker, so read straight from the file rather than attached per test.
 *
 * An option proves itself by being SET in some example, so this half measures
 * the CONTENT as much as the schema — and a run that sees only PART of the
 * corpus cannot answer it. A component library is exactly that: its fixtures
 * hold one example per block by convention while the options are demonstrated
 * by the consuming SITE, whose pages this run never loads. So a partial corpus
 * says so — SANITY_OPTION_EXAMPLES=false — and only the run that sees the whole
 * corpus keeps the check.
 */
function unexercisedOptions(): Array<{ blockType: string; field: string; frontend: string }> {
  const discoveredPath = path.resolve(__dirname, '../.discovered-blocks.json');
  if (!fs.existsSync(discoveredPath)) return [];
  const blocks: Array<{
    blockType: string;
    field?: string;
    frontend?: string;
    unexercisedOption?: boolean;
  }> = JSON.parse(fs.readFileSync(discoveredPath, 'utf-8'));
  // Match the spec's own filtering: synthetic conversion blocks and the
  // non-contract listing blocks are dropped before the loop that skips options.
  const NON_CONTRACT = new Set(['relatedItemsListing', 'searchShortcuts', 'rssFeed']);
  return blocks
    .filter(
      (b) =>
        b.unexercisedOption &&
        !(b.blockType ?? '').startsWith('conv') &&
        !NON_CONTRACT.has(b.blockType),
    )
    .map((b) => ({
      blockType: b.blockType,
      field: b.field ?? '(unknown)',
      frontend: b.frontend || '(unknown)',
    }));
}

export default class CoverageReporter implements Reporter {
  private fields: FieldRecord[] = [];
  private styles: StyleRecord[] = [];
  private sawCoverage = false;

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const att of result.attachments) {
      if (att.name !== 'coverage') continue;
      const raw = att.body
        ? att.body.toString('utf-8')
        : att.path
          ? fs.readFileSync(att.path, 'utf-8')
          : null;
      if (!raw) continue;
      const payload = JSON.parse(raw) as CoveragePayload;
      this.sawCoverage = true;
      if (payload.fields?.length) this.fields.push(...payload.fields);
      if (payload.styles?.length) this.styles.push(...payload.styles);
    }
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | void> {
    // No coverage attachments means block-sanity did not run in this invocation
    // (a different spec, or a project that skips it) — nothing to judge, and
    // asserting would fail every unrelated run. The fail-CLOSED check below
    // guards the case where block-sanity DID run but measured nothing.
    if (!this.sawCoverage) return;

    const problems: string[] = [];

    // Fail closed: block-sanity ran but recorded no styles — the aggregates
    // would pass vacuously. Any real content has paragraphs.
    if (stylesSeenInContent(this.styles).length === 0) {
      problems.push(
        'text-style coverage saw NO slate styles from any discovered block — ' +
          'the style checks would pass over an empty set. Discovery or rendering ' +
          'is broken.',
      );
    }

    const never = stylesNeverRendered(this.styles);
    if (never.length > 0) {
      problems.push(
        `Slate styles present in content whose text renders NOWHERE (an author ` +
          `can apply these and the words disappear):\n` +
          never
            .map((n) => `  - ${n.style} (in ${n.blockType} on ${n.pagePath})\n      text: ${JSON.stringify(n.text.slice(0, 60))}`)
            .join('\n'),
      );
    }

    const flat = stylesRenderingAsPlainText('p', this.styles);
    if (flat.length > 0) {
      problems.push(
        `Slate styles that render, but identically to ordinary body text ` +
          `(choosing them changes nothing an author or reader can see):\n` +
          flat
            .map((n) => `  - ${n.style} (in ${n.blockType} on ${n.pagePath})\n      text: ${JSON.stringify(n.text.slice(0, 60))}`)
            .join('\n'),
      );
    }

    // Fields with no example anywhere: canvas-editable fields that never carried
    // their edit annotation, plus sidebar options no example sets. Same rule,
    // two surfaces.
    const neverEditable = fieldsNeverEditable(this.fields);
    const options = process.env.SANITY_OPTION_EXAMPLES !== 'false' ? unexercisedOptions() : [];
    const missingFields = [
      ...neverEditable.map(
        (n) => `  - ${n.blockType}.${n.field} (${n.kind}) — no edit annotation in any example\n      e.g. ${n.example}`,
      ),
      ...options.map(
        (o) => `  - [${o.frontend}] ${o.blockType}.${o.field} (option) — no example sets it`,
      ),
    ];
    if (missingFields.length > 0) {
      problems.push(
        `Fields with no example anywhere. A canvas field with no edit annotation ` +
          `is uneditable everywhere it appears; an option no example sets is a ` +
          `setting nobody can see the effect of. Add an example, or drop the ` +
          `field:\n` +
          missingFields.join('\n'),
      );
    }

    if (problems.length > 0) {
      console.error(
        `\n${'='.repeat(72)}\n` +
          `block-sanity COVERAGE failures (aggregated across all workers):\n` +
          `${'='.repeat(72)}\n\n` +
          problems.join('\n\n') +
          `\n`,
      );
      return { status: 'failed' };
    }

    // Only announce success when there was something to judge.
    console.log(
      `[coverage] block-sanity: ${this.fields.length} field record(s), ` +
        `${this.styles.length} style record(s) across all workers — no gaps.`,
    );
    void result;
  }
}
