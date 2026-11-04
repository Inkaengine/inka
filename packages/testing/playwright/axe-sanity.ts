import type { FrameLocator } from '@playwright/test';
import * as fs from 'fs';
import { createRequire } from 'module';

// Inject axe-core's source into the frame rather than using @axe-core/playwright:
// that wrapper pulls in its OWN @playwright/test, which breaks the single linked
// copy block-sanity relies on. axe-core is a standalone browser lib — run its
// source in the frame, then call window.axe.run().
const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

export interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: number;
  tags: string[];
  // Up to 3 offending elements — the CSS-selector target + a short HTML snippet —
  // so a finding is actionable (WHICH element), not just a rule name + count.
  targets: { selector: string; html: string }[];
}

// WCAG 2.0/2.1 A + AA plus axe's best-practice preset (heading-order, region,
// landmark, page-has-heading-one, …). best-practice findings are reported as
// advisory, never blocking. Override the whole set with SANITY_AXE_TAGS (a
// comma-separated list of axe tags, e.g. "wcag2a,wcag2aa,wcag2aaa").
const DEFAULT_AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

// Page-SHELL rules that depend on the surrounding chrome (landmarks, a single
// h1, a document title, html lang) — a block-sanity fixture page is often just
// the block + title with no full layout, so these would false-positive. Kept
// advisory. NOTE: `heading-order` is deliberately NOT here — axe now runs over
// the WHOLE fixture page (not a scoped block), so a skipped heading level is a
// real, judgeable violation of the document outline. It blocks.
const PAGE_LEVEL_RULES = new Set([
  'region',
  'landmark-one-main',
  'landmark-unique',
  'landmark-complementary-is-top-level',
  'landmark-no-duplicate-banner',
  'landmark-no-duplicate-contentinfo',
  'page-has-heading-one',
  'bypass',
  'document-title',
  'html-has-lang',
  'html-lang-valid',
]);

/**
 * Run axe-core against the WHOLE rendered fixture page inside the preview iframe
 * (not a single block — the block renders in its real page, so document-outline
 * rules like heading-order are judged in context).
 *   blocking = serious/critical WCAG 2.0/2.1 A/AA violations, incl. heading-order
 *   advisory = everything else (moderate/minor, best-practice-only, or the
 *              page-SHELL rules a minimal fixture page can't be judged on)
 */
export async function axeCheckPage(
  iframe: FrameLocator,
): Promise<{ blocking: AxeViolation[]; advisory: AxeViolation[] }> {
  const body = iframe.locator('body');

  // Inject axe-core into the iframe's own frame (idempotent across blocks).
  await body.evaluate((_el, src) => {
    if (!(window as unknown as { axe?: unknown }).axe) {
      const s = document.createElement('script');
      s.textContent = src as string;
      document.head.appendChild(s);
    }
  }, axeSource);

  const tags = process.env.SANITY_AXE_TAGS
    ? process.env.SANITY_AXE_TAGS.split(',').map((t) => t.trim()).filter(Boolean)
    : DEFAULT_AXE_TAGS;

  const raw = (await body.evaluate(
    async (_el, { tags }: { tags: string[] }) => {
      // Whole page MINUS the editor chrome. block-sanity renders in edit mode, so
      // the bridge injects its own UI (`.volto-hydra-*`: the drag handle, quanta
      // toolbar, add buttons, outlines) that a real user never sees — axe would
      // flag it (e.g. the drag button has no accessible name) as a false positive.
      // Exclude it so axe judges only the VIEW output, while keeping the whole-page
      // context so document-outline rules (heading-order) still see every heading.
      const results = await (
        window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: unknown[] }> } }
      ).axe.run(
        { exclude: [['[class*="volto-hydra"]']] },
        { runOnly: { type: 'tag', values: tags } },
      );
      return (results.violations as Array<Record<string, unknown>>).map((v) => ({
        id: v.id as string,
        impact: (v.impact as string) ?? null,
        help: v.help as string,
        nodes: (v.nodes as unknown[]).length,
        tags: v.tags as string[],
        targets: (v.nodes as Array<Record<string, unknown>>)
          .slice(0, 3)
          .map((n) => ({
            selector: Array.isArray(n.target) ? n.target.join(' ') : String(n.target ?? ''),
            html: String(n.html ?? '').slice(0, 160),
          })),
      }));
    },
    { tags },
  )) as AxeViolation[];

  const blocking: AxeViolation[] = [];
  const advisory: AxeViolation[] = [];
  for (const v of raw) {
    // heading-order is the document-outline rule this suite exists to guard — a
    // skipped heading level is a real WCAG 1.3.1 failure. axe files it as a
    // "moderate" best-practice, so force it blocking regardless of impact/tag.
    if (v.id === 'heading-order') {
      blocking.push(v);
      continue;
    }
    const severe = v.impact === 'serious' || v.impact === 'critical';
    // A best-practice-only rule (no WCAG tag) or a page-SHELL rule a minimal
    // fixture page can't be judged on — advisory, never blocking.
    const bestPracticeOnly =
      v.tags.includes('best-practice') && !v.tags.some((t) => t.startsWith('wcag'));
    if (severe && !bestPracticeOnly && !PAGE_LEVEL_RULES.has(v.id)) blocking.push(v);
    else advisory.push(v);
  }
  return { blocking, advisory };
}

export function formatViolations(vs: AxeViolation[]): string {
  return vs
    .map((v) => {
      const where = v.targets
        .map((t) => `      @ ${t.selector}\n        ${t.html}`)
        .join('\n');
      return `  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes} node(s))\n${where}`;
    })
    .join('\n');
}
