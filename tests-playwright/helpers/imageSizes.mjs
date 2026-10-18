/**
 * Does a rendered image USE the sizes its data offers, or ignore them?
 *
 * Pure decision logic, deliberately separated from the Playwright helper that
 * calls it, so the contract can be tested without a browser.
 *
 * THE CONTRACT. Inka says nothing about how a frontend builds its URLs — that
 * is the frontend's business. It says only this: when the block data advertises
 * several scales for an image field, the rendered element must offer the
 * browser a genuine choice between them. A frontend that ships one size when
 * the data offered six has ignored the data, however it chose to implement.
 *
 * WHY IT IS NEEDED. The existing image rules are element-shaped — "for each
 * <img>, assert it loads" — and check the `src` only. Both of these pass them:
 *
 *   - an <img> whose every srcset candidate 404s. Browsers fall back to `src`,
 *     which resolves, so naturalWidth > 0 and the check is satisfied. The
 *     failure is invisible to anything that looks at `src`.
 *   - an <img> whose srcset lists the same URL nine times at nine different
 *     width descriptors. Nine candidates, one size. That is the pretagov
 *     homepage hero on 2026-10-15, shipping a 1920px 497KB original to phones.
 *
 * Both are "the data offered sizes and the render ignored them", which is why
 * that is the question this asks rather than "is there a srcset".
 *
 * CONDITIONAL ON THE DATA, on purpose. A single-scale image legitimately
 * renders one candidate, and a frontend serving such images must not fail. The
 * rule only bites when the data offered a choice that the render threw away.
 */

/**
 * Distinct widths a block's image reference advertises for `field`.
 *
 * Plone serialises `image_scales[field] = [{ width, download, scales: {...} }]`,
 * where `scales` holds the named variants and the entry itself is the primary.
 * Counts DISTINCT widths: Plone caps every scale at the source, so a 200px
 * image reports `large`, `huge` and `great` all at 200 — three names, one size,
 * and no real choice for the browser.
 */
/**
 * Find the object carrying an image field's scales, whichever shape it is in.
 *
 * Plone serialises image references two ways, and a check that knows only one
 * silently skips the other:
 *
 *   NESTED   field: [{ '@id', image_field, image_scales }]      (teasers, hero
 *                                                                references)
 *   SIBLING  field: '/path/to.jpg'                              (image blocks)
 *            image_field: 'image'
 *            image_scales: { image: [...] }
 *
 * The sibling shape is what real image blocks use — the field holds a plain
 * path string and the scales sit beside it on the block. An earlier version of
 * this rule read only `blockData[field]` and bailed on `typeof !== 'object'`,
 * so it skipped every image block in the suite and judged nothing at all while
 * reporting success. Returns null when no scales can be found, which is not an
 * error: a reference without scale data is simply not judged.
 */
export function resolveImageEntry(blockData, field) {
  if (!blockData || typeof blockData !== 'object') return null;

  const value = blockData[field];
  const nested = Array.isArray(value) ? value[0] : value;
  if (nested && typeof nested === 'object' && nested.image_scales) return nested;

  // Sibling shape: scales live on the BLOCK, keyed by its own image_field.
  if (blockData.image_scales && blockData.image_field) {
    return { image_field: blockData.image_field, image_scales: blockData.image_scales };
  }
  return null;
}

export function scalesAvailable(entry, field) {
  if (!entry || typeof entry !== 'object') return 0;
  // The scales are keyed by the IMAGE field, which is not always the schema
  // field asked about: an image block's schema field is `url` while its scales
  // sit under `image`. Try the requested name, then the entry's own.
  const scales = entry.image_scales ?? {};
  const metas = scales[field] ?? scales[entry.image_field];
  const meta = Array.isArray(metas) ? metas[0] : metas;
  if (!meta) return 0;

  const widths = new Set();
  if (Number(meta.width)) widths.add(Number(meta.width));
  for (const s of Object.values(meta.scales ?? {})) {
    if (Number(s?.width)) widths.add(Number(s.width));
  }
  return widths.size;
}

/**
 * Distinct images a srcset actually offers.
 *
 * Keyed on the URL, NOT the width descriptor. A srcset may advertise nine
 * widths that all point at the same file; the browser has one image to choose
 * from and will download the full-size one. Descriptors are a claim, the URL is
 * the thing.
 */
export function sizesOffered(srcset) {
  if (typeof srcset !== 'string' || !srcset.trim()) return 0;
  const urls = new Set();
  for (const part of srcset.split(',')) {
    const [url, descriptor] = part.trim().split(/\s+/);
    if (!url) continue;
    // A candidate the browser will DROP is not a size on offer. The descriptor
    // is NUMBER then unit (`400w`, `2x`); reversed or malformed (`w400`) is
    // invalid and silently discarded, leaving the browser on `src` — the
    // full-size file. Inka's own nuxt example emitted `w400` for every scale it
    // read from real metadata, so counting URLs alone would have called that
    // responsive. A bare URL with no descriptor is valid (implicitly 1x).
    if (descriptor !== undefined && !/^\d+(\.\d+)?[wx]$/.test(descriptor)) continue;
    urls.add(url);
  }
  return urls.size;
}

/**
 * Coverage, so the rule cannot go vacuous.
 *
 * This rule only bites when the data offers a choice. If no fixture ever
 * carries multi-scale data, it passes everywhere by never applying — the exact
 * blind spot it was written to close, turned on itself. The consuming spec
 * drains this at the end of a run and asserts the rule actually fired.
 */
const judged = [];

/** Everything judged since the last drain, then clear. */
export function drainImageSizeCoverage() {
  return judged.splice(0, judged.length);
}

/** How many judged fields actually offered a choice to test. */
export function multiScaleSeen(records = judged) {
  return records.filter((r) => r.available >= 2).length;
}

/**
 * The verdict for one image field.
 *
 * `{ ok: true }` when the render used what it was given, or when there was
 * nothing to use. `{ ok: false, reason }` names what the data offered and what
 * the render did with it, because "srcset assertion failed" tells a reader
 * nothing they can act on.
 */
export function usesAvailableSizes({ field, entry, srcset, rendered = true, record = true }) {
  const available = scalesAvailable(entry, field);
  if (record) judged.push({ field, available, offered: sizesOffered(srcset) });

  if (!rendered) {
    return {
      ok: false,
      available,
      offered: 0,
      reason: `field "${field}" has a value but no media element was rendered `
        + `for it (nothing carries data-edit-media="${field}")`,
    };
  }

  // Nothing to ignore. A single-scale image rendering one candidate is correct,
  // and a frontend is free to render no srcset at all in that case.
  if (available < 2) return { ok: true, available, offered: sizesOffered(srcset) };

  const offered = sizesOffered(srcset);
  if (offered < 2) {
    return {
      ok: false,
      available,
      offered,
      reason: `field "${field}" offers ${available} distinct sizes but the `
        + `rendered image gives the browser ${offered === 0 ? 'no srcset' : `only ${offered} distinct URL`}`
        + `, so every viewport downloads the same file`,
    };
  }
  return { ok: true, available, offered };
}

/**
 * Every distinct width the data offers, ascending.
 *
 * The primary entry is the SOURCE; `scales` are the variants. Distinct, because
 * Plone caps every scale at the source: on a 200px image `large`, `huge` and
 * `great` all return 200, which is one size wearing three names.
 */
export function availableWidths(entry, field) {
  if (!entry || typeof entry !== 'object') return [];
  const scales = entry.image_scales ?? {};
  const metas = scales[field] ?? scales[entry.image_field];
  const meta = Array.isArray(metas) ? metas[0] : metas;
  if (!meta) return [];
  const widths = new Set();
  if (Number(meta.width)) widths.add(Number(meta.width));
  for (const s of Object.values(meta.scales ?? {})) {
    if (Number(s?.width)) widths.add(Number(s.width));
  }
  return [...widths].sort((a, b) => a - b);
}

/**
 * The smallest offered width that still covers `boxWidth`, or the largest
 * offered width when none does.
 *
 * This is the yardstick, NOT the box itself. Plone caps scales at the source,
 * so a 266px logo painted into a 266px box is already optimal and must not be
 * failed for it. The only defect this can describe is "a smaller scale existed
 * and the browser downloaded a bigger one".
 */
export function neededWidth(widths, boxWidth) {
  if (!widths.length) return null;
  return widths.find((w) => w >= boxWidth) ?? widths[widths.length - 1];
}

/**
 * Did the browser download bytes proportionate to the box it painted them into?
 *
 * `actualWidth` must be the TRUE decoded width, from createImageBitmap on the
 * fetched bytes — never `naturalWidth`. With `srcset`/`sizes` the browser
 * divides naturalWidth by the candidate's density, so a 480px file reports 316
 * and any arithmetic on it is confident nonsense.
 *
 * `tolerance` is generous on purpose: a 2x DPR screen legitimately wants twice
 * the CSS width, and the ladder is coarse, so the next scale up is often the
 * right answer. This is for gross over-fetching — a 1920px original behind a
 * 266px logo — not for shaving the last few percent.
 */
export function isProportionate({ actualWidth, widths, boxWidth, tolerance = 2, coarse = 3 }) {
  if (!actualWidth || !boxWidth || !widths.length) {
    return { ok: true, skipped: true };          // nothing measurable to judge
  }

  const ratio = (actualWidth / boxWidth).toFixed(1);
  const common = `downloaded a ${actualWidth}px image for a ${Math.round(boxWidth)}px box `
    + `(${ratio}x wider than it is painted)`;

  // Q1: was a MEANINGFULLY smaller scale available that still covered the box?
  // `tolerance` guards the next rung up: a ladder is coarse, and taking 800 for
  // a 400px box is a normal rounding, not a defect. Only a scale the download
  // beats by more than `tolerance` counts as one that should have been used.
  const better = widths.find((w) => w >= boxWidth && actualWidth > w * tolerance);
  if (better) {
    return {
      ok: false, actualWidth, boxWidth,
      reason: `${common} — a ${better}px scale was offered and not used `
        + `(offered: ${widths.join(', ')})`,
    };
  }

  // Q2: the download IS the best rung available — but is the ladder itself too
  // coarse for where this image is used? `plone.allowed_sizes` is a
  // CONFIGURATION choice, so "nothing finer exists" is a defect of its own
  // rather than an excuse. Judged loosely (`coarse`), because demanding a rung
  // per layout would fail every site.
  if (actualWidth > boxWidth * coarse) {
    return {
      ok: false, actualWidth, boxWidth,
      reason: `${common} — and no offered scale is finer: the smallest is `
        + `${widths[0]}px (offered: ${widths.join(', ')}). The ladder is a `
        + `configuration choice; add a finer size to plone.allowed_sizes`,
    };
  }

  return { ok: true, actualWidth, boxWidth };
}
