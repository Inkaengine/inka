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
export function scalesAvailable(entry, field) {
  if (!entry || typeof entry !== 'object') return 0;
  const metas = entry.image_scales?.[field ?? entry.image_field];
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
    const url = part.trim().split(/\s+/)[0];
    if (url) urls.add(url);
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
