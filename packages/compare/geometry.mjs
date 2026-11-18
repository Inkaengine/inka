/**
 * Why a region differs: the first element inside it that does.
 *
 * The region verdicts end at the deepest NAMED region (a block, a card part).
 * Below that the comparison records a skeleton of each instance — every
 * element's tag, its design system's classes, box and the few styles that
 * size it — and walks
 * the two sides' skeletons together to the element that explains the
 * difference: one whose own size differs while its children's do not, or one
 * that only one side draws.
 *
 * The skeletons are taken in the page (`regionSkeletons`, self-contained so it
 * can be handed to page.evaluate); everything else here is pure and
 * unit-tested.
 */

/** The styles that size a box, recorded per element. */
const STYLE_KEYS = ["pt", "pb", "mt", "mb", "lh", "fs"];

/**
 * In the page: each region's rendered, unmasked instances as skeletons —
 * every element's tag, the classes starting `classPrefix` (the design
 * system's own, which both sides share), box and the styles that size it, in
 * document order, depth- and count-capped (a region is a block, not a page,
 * and the cause is near its top). SELF-CONTAINED: page.evaluate sends its
 * source, so it may not use anything from this module.
 */
export function regionSkeletons({ sels, masked, classPrefix, maxDepth = 8, maxNodes = 400 }) {
  if (typeof classPrefix !== "string") throw new TypeError("regionSkeletons: classPrefix, the design system's class prefix");
  const inMasked = (el) => masked.some((m) => el.closest(m));
  const skeletonOf = (root) => {
    let count = 0;
    const walk = (el, depth) => {
      count += 1;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const node = {
        t: el.tagName.toLowerCase(),
        c: [...el.classList].filter((x) => x.startsWith(classPrefix)).sort(),
        w: Math.round(r.width),
        h: Math.round(r.height),
        s: {
          pt: cs.paddingTop,
          pb: cs.paddingBottom,
          mt: cs.marginTop,
          mb: cs.marginBottom,
          lh: cs.lineHeight,
          fs: cs.fontSize,
        },
        k: [],
      };
      if (depth < maxDepth) {
        for (const child of el.children) {
          if (count >= maxNodes) break;
          if (getComputedStyle(child).display === "none" || inMasked(child)) continue;
          node.k.push(walk(child, depth + 1));
        }
      }
      return node;
    };
    return walk(root, 0);
  };
  const out = {};
  for (const { name, sel } of sels) {
    // The SAME instances the box measurement counts: rendered and unmasked.
    out[name] = [...document.querySelectorAll(sel)]
      .filter(
        (el) =>
          !inMasked(el) &&
          (el.getBoundingClientRect().width > 0 || el.getBoundingClientRect().height > 0),
      )
      .map(skeletonOf);
  }
  return out;
}

const keyOf = (n) => [n.t, ...n.c].join(".");
const sizeDiffers = (a, b) => Math.abs(a.w - b.w) > 1 || Math.abs(a.h - b.h) > 1;

/** Children paired in order by tag + classes; the rest are one side's. */
function pairChildren(ak, bk) {
  const pairs = [];
  const onlyA = [];
  let cursor = 0;
  const usedB = new Set();
  for (const a of ak) {
    let j = cursor;
    while (j < bk.length && keyOf(bk[j]) !== keyOf(a)) j += 1;
    if (j < bk.length) {
      pairs.push([a, bk[j]]);
      usedB.add(j);
      cursor = j + 1;
    } else {
      onlyA.push(a);
    }
  }
  // Second pass, for what an exact key left over: the same tag sharing a
  // class (or neither having one). A state modifier on one side —
  // `filters__item--closed` — is the same element, and what differs
  // INSIDE it is the finding, not that it exists on one side only.
  const close = (x, y) =>
    x.t === y.t && (x.c.length === 0 ? y.c.length === 0 : x.c.some((cls) => y.c.includes(cls)));
  const stillOnlyA = [];
  for (const a of onlyA) {
    const j = bk.findIndex((b, idx) => !usedB.has(idx) && close(a, b));
    if (j === -1) {
      stillOnlyA.push(a);
      continue;
    }
    pairs.push([a, bk[j]]);
    usedB.add(j);
  }
  const onlyB = bk.filter((_, j) => !usedB.has(j));
  return { pairs, onlyA: stillOnlyA, onlyB };
}

/**
 * pairChildren, looking through wrappers when both sides still have something
 * unmatched: a wrapper one side puts around the same element the other side
 * has bare. Up to `levels` wrappers deep.
 */
function pairDeep(ak, bk, levels = 3) {
  const res = pairChildren(ak, bk);
  if (!levels || !res.onlyA.length || !res.onlyB.length) return res;
  // Any wrapper with children: a class-less one (a block's element, a React
  // div), or a classed one only one side has (a design system's
  // `filters__list`, which an older theme leaves out). The close() pairing
  // still needs the same tag and a shared class, so opening does not invent
  // matches.
  const open = (list) => list.flatMap((n) => (n.k?.length ? n.k : [n]));
  const flatA = open(res.onlyA);
  const flatB = open(res.onlyB);
  // Nothing opened (no class-less wrapper on either side): stop. Compared by
  // element, not count — a wrapper with one child opens to one element.
  const same = (x, y) => x.length === y.length && x.every((n, i) => n === y[i]);
  if (same(flatA, res.onlyA) && same(flatB, res.onlyB)) return res;
  // One side's wrapper first: the other side's element stays whole when it
  // is what the wrapper holds (ours wraps a bare `header__search`,
  // which has children of its own — opening both sides at once opened it too).
  const tries = [
    [res.onlyA, flatB],
    [flatA, res.onlyB],
    [flatA, flatB],
  ].filter(([x, y]) => !(same(x, res.onlyA) && same(y, res.onlyB)));
  for (const [x, y] of tries) {
    const inner = pairDeep(x, y, levels - 1);
    if (inner.pairs.length || x === flatA && y === flatB)
      return { pairs: [...res.pairs, ...inner.pairs], onlyA: inner.onlyA, onlyB: inner.onlyB };
  }
  return res;
}

function styleDiff(a, b) {
  const out = {};
  for (const k of STYLE_KEYS) if (a.s?.[k] !== b.s?.[k]) out[k] = [a.s?.[k], b.s?.[k]];
  return out;
}

/**
 * The element that explains why `a` (the source) and `b` (ours) differ in
 * size, or null when they do not (1px is rounding). Descends only through
 * elements whose size differs, so the answer is the deepest one whose own
 * size differs with no differing child, or the first child only one side has.
 *
 * `everyBox` descends through same-sized elements too: a parity check that
 * compares every box blanks the sizes that are content (a list of five
 * options vs eight) — which would otherwise stop the walk at the top.
 */
export function firstDivergence(a, b, { everyBox = false } = {}, path = []) {
  if (!everyBox && !sizeDiffers(a, b)) return null;
  const here = [...path, keyOf(a)];
  const { pairs, onlyA, onlyB } = pairDeep(a.k ?? [], b.k ?? []);
  for (const [ca, cb] of pairs) {
    const deeper = firstDivergence(ca, cb, { everyBox }, here);
    if (deeper) return deeper;
  }
  if (onlyA.length) {
    const n = onlyA[0];
    return { kind: "only-source", path: [...here, keyOf(n)], node: n };
  }
  if (onlyB.length) {
    const n = onlyB[0];
    return { kind: "only-ours", path: [...here, keyOf(n)], node: n };
  }
  if (!sizeDiffers(a, b)) return null;
  return {
    kind: "size",
    path: here,
    a: { w: a.w, h: a.h },
    b: { w: b.w, h: b.h },
    styles: styleDiff(a, b),
  };
}

/** One line for the report. */
export function describeDivergence(d) {
  if (!d) return "";
  const where = d.path.join(" > ");
  if (d.kind === "size") {
    const styles = Object.entries(d.styles)
      .map(([k, [x, y]]) => `${k} ${x}→${y}`)
      .join(", ");
    const last = d.path[d.path.length - 1];
    return (
      `${where}: ${last} ${d.a.w}x${d.a.h} vs ${d.b.w}x${d.b.h}` +
      (styles ? ` (${styles})` : "")
    );
  }
  const n = d.node;
  const spacing = ["pt", "pb", "mt", "mb"]
    .filter((k) => n.s?.[k] && n.s[k] !== "0px")
    .map((k) => `${k} ${n.s[k]}`)
    .join(", ");
  const side = d.kind === "only-source" ? "only on the source" : "only on ours";
  return `${side}: ${where} ${n.w}x${n.h}${spacing ? ` (${spacing})` : ""}`;
}
