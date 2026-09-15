// Aggregate slate TEXT-STYLE coverage across all discovered block examples.
//
// The content gate checks that no stored node breaks its region's rules. This is
// the other direction: every text style actually in use must have an example
// that RENDERS, and must render DIFFERENTLY from ordinary body text. A style
// that renders identically to a paragraph is a lie told to the author — they
// pick "Subtitle", nothing changes, and nothing anywhere says why.
//
// Nothing here assumes HOW a style renders. The frontend chooses its own markup
// (hydra's test frontend renders `strong` as a styled <span> on purpose), so the
// check compares a style's rendered appearance against the appearance of plain
// body text on the SAME page and only asks that they differ.
//
// Aggregated, not per-example, for the same reason field-coverage is: a style
// legitimately appears in some examples and not others. Only "no example
// anywhere" is a finding.
//
// The aggregation crosses WORKERS. Playwright gives each worker its own process,
// so module state alone makes the result depend on which worker ran the final
// assertion. Rather than a check whose answer depends on scheduling, each test
// records what it saw and the spec attaches it (testInfo.attach); the coverage
// reporter — main process, sees every worker's attachments — merges them and
// runs the aggregates ONCE in onEnd. The framework does the cross-worker
// combining; this file just produces and folds records.

/** What a style looks like once rendered. Compared for difference, never for a value. */
export type StyleSignature = string;

/** A style's appearance plus WHICH element produced it, so identity is checkable. */
export type Measured = { sig: StyleSignature; node: number };

type Seen = { blockType: string; text: string; pagePath: string };

// One record per (style, example): whether the style's text RENDERED there, and
// whether it rendered indistinguishably from body text. This module stays free
// of any Playwright dependency (the unit tests import it) — it just accumulates
// THIS test's records; the spec attaches them and the coverage reporter merges
// every worker's and aggregates once.
export interface StyleRecord extends Seen {
  style: string;
  rendered: boolean;
  flat: boolean;
}

// This test's records, drained (and cleared) by the spec's afterEach.
const pending: StyleRecord[] = [];

/** Every element `type` in a slate value, at any depth, with its text. */
export function slateStyles(value: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (node: any) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const text = plainText(node).trim();
    // A style with no text of its own cannot be located in the DOM, so we can't
    // measure it — don't claim coverage we didn't take.
    if (text) {
      if (typeof node.type === 'string' && !out.has(node.type)) {
        out.set(node.type, text);
      }
      // A design system's OWN styles, which Volto's style menu stores in TWO
      // different shapes — both have to be counted or half the menu goes
      // unmeasured:
      //   block  -> `styleName` on the element, space separated
      //   inline -> a leaf MARK named `style-<cssClass>` (StyleMenu/utils.js
      //             toggleInlineStyleInSelection → Editor.addMark)
      // Prefixed with a dot so a DS class can never collide with an element type.
      if (typeof node.styleName === 'string') {
        for (const cls of node.styleName.split(/\s+/).filter(Boolean)) {
          if (!out.has(`.${cls}`)) out.set(`.${cls}`, text);
        }
      }
      for (const key of Object.keys(node)) {
        const cls = node[key] && /^style-(.+)$/.exec(key)?.[1];
        if (cls && !out.has(`.${cls}`)) out.set(`.${cls}`, text);
      }
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  walk(value);
  return out;
}

function plainText(node: any): string {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.children)) return '';
  return node.children.map(plainText).join('');
}

/**
 * Record one example's styles: for each, whether its text RENDERED (a signature
 * was measured) and whether it rendered indistinguishably from body text.
 *
 * @param measured - style -> signature, or null when the style's text was not
 *   found in the rendered output at all
 * @param baseline - signature of ordinary body text on that page, if found
 */
export function recordTextStyles(
  blockType: string,
  pagePath: string,
  value: unknown,
  measured: Record<string, Measured | null>,
  baseline?: Measured | null,
): void {
  for (const [style, text] of slateStyles(value)) {
    const m = measured[style];
    pending.push({
      style,
      blockType,
      text,
      pagePath,
      rendered: !!m,
      // "Looks like body text" is only meaningful when the two are DIFFERENT
      // elements: a paragraph that is entirely bold is one element wearing both
      // hats, and says nothing about whether bold is visible.
      flat: !!(m && baseline && m.sig === baseline.sig && m.node !== baseline.node),
    });
  }
}

/** Return this test's records and clear them, for the spec to attach. */
export function drainStyleCoverage(): StyleRecord[] {
  const out = pending.slice();
  pending.length = 0;
  return out;
}

// First-seen metadata for a style, so a finding names WHERE it was seen. The
// first record wins so the message is stable regardless of worker scheduling.
function firstSeen(records: StyleRecord[]): Map<string, Seen> {
  const seen = new Map<string, Seen>();
  for (const r of records) {
    if (!seen.has(r.style)) {
      seen.set(r.style, { blockType: r.blockType, text: r.text, pagePath: r.pagePath });
    }
  }
  return seen;
}

/**
 * Styles present in content that never rendered in ANY example. Pure over the
 * merged records: the reporter folds every worker's, the unit tests pass their
 * own.
 */
export function stylesNeverRendered(
  records: StyleRecord[] = pending,
): Array<{ style: string } & Seen> {
  const rendered = new Set(records.filter((r) => r.rendered).map((r) => r.style));
  return [...firstSeen(records).entries()]
    .filter(([style]) => !rendered.has(style))
    .map(([style, s]) => ({ style, ...s }));
}

/**
 * Styles that rendered, but indistinguishably from plain body text in EVERY
 * example that rendered them. A style distinct in even one example is fine.
 *
 * The default block type is exempt: it IS body text.
 */
export function stylesRenderingAsPlainText(
  defaultBlockType = 'p',
  records: StyleRecord[] = pending,
): Array<{ style: string } & Seen> {
  const distinct = new Set(
    records.filter((r) => r.rendered && !r.flat).map((r) => r.style),
  );
  const flat = new Set(records.filter((r) => r.flat).map((r) => r.style));
  const seen = firstSeen(records);
  return [...flat]
    .filter((style) => style !== defaultBlockType && !distinct.has(style) && seen.has(style))
    .map((style) => ({ style, ...(seen.get(style) as Seen) }));
}

/** Every style seen in the discovered content — used to fail closed. */
export function stylesSeenInContent(records: StyleRecord[] = pending): string[] {
  return [...new Set(records.map((r) => r.style))].sort();
}

/** Test-only: clear this module's pending records so cases stay isolated. */
export function resetTextStyleCoverage(): void {
  pending.length = 0;
}

/**
 * Measure, in the page, how each style actually looks — and how body text looks
 * next to it.
 *
 * Deliberately knows nothing about markup. It finds the innermost element whose
 * whole text is the style's text and takes a signature of its COMPUTED style, so
 * a frontend rendering a heading as a `<div>` or bold as a styled `<span>`
 * passes on its merits. Shared by every block-sanity suite so "how do we measure
 * a style" has one answer.
 *
 * `blockLocator` is a Playwright Locator for the rendered block; typed loosely so
 * this module stays importable by the unit tests (no playwright dependency).
 *
 * @returns { out: style -> signature|null, baseline: signature|null }
 */
/**
 * Measure, in the page, how each style actually looks — and how body text looks
 * next to it.
 *
 * SELF-CONTAINED on purpose: Playwright serialises this to run it in the page,
 * so it can close over nothing. That also makes it directly testable, which it
 * needs to be — every rule in here cost a wrong finding first:
 *
 *   - the baseline was "the longest leaf run", so in a mostly-bold block BOLD
 *     became the baseline and bold was then reported as looking like body text;
 *   - `p` and `strong` resolve to the SAME element in a fully-bold paragraph,
 *     which read as "bold is invisible" until identity was checked;
 *   - `querySelectorAll` returns descendants only, so a slate block rendering AS
 *     the styled element (`<h3 data-block-uid=…>`) was reported as rendering
 *     nowhere.
 *
 * Knows nothing about markup: it finds the innermost element whose whole text is
 * the style's text and takes a signature of its COMPUTED style, so a frontend
 * rendering a heading as a `<div>`, or bold as a styled `<span>`, passes on its
 * merits.
 */
export function measureStylesInPage(
  root: HTMLElement,
  {
    wanted,
    uid,
    field,
  }: {
    wanted: Array<{ style: string; text: string }>;
    uid?: string;
    /** The field these styles came from, so the RIGHT handle is clicked. */
    field?: string;
  },
): {
  out: Record<string, { sig: string; node: number } | null>;
  baseline: { sig: string; node: number } | null;
} {
  // Match with ALL whitespace removed. A container style's slate text is its
  // children concatenated with no separator ("oneTwo"), while the DOM puts them
  // in separate elements and reads back "one Two".
  const norm = (t: string) => t.replace(/[\u200b\ufeff\u00a0\s]/g, '');

  // What something LOOKS like, reduced to the properties that make one style
  // visibly distinct from another. No tag name on purpose.
  const signature = (el: Element) => {
    const c = getComputedStyle(el);
    return [
      c.fontSize, c.fontWeight, c.fontStyle, c.fontFamily,
      c.textDecorationLine, c.textTransform, c.letterSpacing,
      c.verticalAlign, c.display, c.color,
    ].join('|');
  };

  // A block's own element is not the only place its text can land: design
  // system JavaScript builds some fields elsewhere in the document — a cookie
  // banner, a dialog — and that markup says whose it is,
  // `data-block-selector="uid#field"`, the same handle the bridge clicks to
  // reveal it. Measuring the block's element alone reported those styles as
  // rendering NOWHERE while the words were on screen the whole time.
  //
  // The handle is the CONTROL, not the markup: reading its subtree finds the
  // button's own label ("Show cookie consent"), never the field. So click it,
  // exactly as the bridge does when an author puts the cursor in that field,
  // and then let the whole document be searchable for this block — the block
  // claimed that markup by stamping its uid there, and `locate` matches a
  // field's WHOLE text, so the wider root cannot drift onto someone else's
  // words.
  //
  // ONE handle, the one naming THIS field. A block can be drawn in two places
  // with different fields in each (a cookie banner and its preferences dialog),
  // and revealing the second HIDES the first — clicking them all would measure
  // neither.
  // Some frontends stamp the attribute on an element that DOES hold the field —
  // an accordion header wrapping its panel — so claimed elements stay roots.
  const claimed = uid
    ? [...document.querySelectorAll(`[data-block-selector^="${uid}#"]`)]
    : [];
  // …but the design system's is a BUTTON beside the thing it opens, so the one
  // naming this field is clicked, and the document becomes searchable for this
  // block once it has been.
  const handle = uid && field
    ? document.querySelector(`[data-block-selector~="${uid}#${field}"]`)
    : null;
  const roots = [root, ...claimed];

  // A root itself counts, and the INNERMOST match wins — the element the style
  // produced, not an ancestor that merely contains it.
  const find = (target: string, where: Element[]) => {
    const all = where
      .flatMap((r) => [r, ...r.querySelectorAll('*')])
      .filter((el) => norm(el.textContent || '') === target);
    return all.length ? (all[all.length - 1] as HTMLElement) : null;
  };

  // Clicking is a LAST RESORT, and at most once.
  //
  // The handle reveals a field the design system draws elsewhere, and opening
  // it is a real interaction: it can put a dialog over the page and leave the
  // editor somewhere the next test did not expect. So look first, and only
  // reach for the handle when the words are genuinely not on screen — which is
  // the case it exists for, and no other block pays for it.
  let clicked = false;
  const locate = (text: string) => {
    const target = norm(text);
    if (!target) return null;
    const found = find(target, roots);
    if (found || !(handle instanceof HTMLElement)) return found;
    if (!clicked) {
      clicked = true;
      handle.click();
    }
    return find(target, [...roots, document.body]);
  };

  const ids = new Map<Element, number>();
  const idOf = (el: Element) => {
    if (!ids.has(el)) ids.set(el, ids.size);
    return ids.get(el) as number;
  };

  const out: Record<string, { sig: string; node: number } | null> = {};
  for (const { style, text } of wanted) {
    const el = locate(text);
    out[style] = el ? { sig: signature(el), node: idOf(el) } : null;
  }
  // Body text is how the DEFAULT BLOCK TYPE renders, which is already measured.
  return { out, baseline: out['p'] ?? null };
}

/**
 * Run {@link measureStylesInPage} against a rendered block.
 *
 * `blockLocator` is a Playwright Locator, typed loosely so this module stays
 * importable by the unit tests (no playwright dependency).
 */
export async function measureTextStyles(
  blockLocator: { evaluate: Function },
  items: Array<{ style: string; text: string }>,
  uid?: string,
  field?: string,
): Promise<{ out: Record<string, Measured | null>; baseline: Measured | null }> {
  return await blockLocator
    .evaluate(measureStylesInPage, { wanted: items, uid, field })
    .catch(() => ({ out: {}, baseline: null }));
}
