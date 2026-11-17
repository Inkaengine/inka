/**
 * Regions: where on a page a difference is, named.
 *
 * A comparison names the parts of a page it compares — the page, its main
 * content, its header and footer, and each kind of block and the parts of one
 * (a card, its image, title and copy) — as selectors on each side. Measured
 * separately, a difference is reported at the DEEPEST named region that
 * differs: "the card's image is 8px taller" rather than "17% of the page".
 *
 * The names and selectors are a comparison's own, handed in as a MAPPING (they
 * belong to a design system and a site, not to this module):
 *
 *   regions          [{ name, old, new }] the page's regions, in reading order
 *   blockRegions     { blockType: { sel } | { old, new }, parts?, sameAs?,
 *                      partOnly?, optional?, createdByConversion? }
 *   rules            { rule: { why, precludes: [region], excuses?(finding,
 *                      times, context), counts?: { blockType: (times) =>
 *                      [least, most] }, blocksAreOurs?, blocksMade? } }:
 *                      what each conversion rule makes incomparable
 *   reviewRules      { reviewKind: rule } settled review-list kinds
 *   decidedPages     { path: [rule] } pages settled by name
 *   blockExceptions  [{ node, when, why, checked, decided, sizeOnly?,
 *                      pixelsOnly?, matches?(finding), precludesSubtree? }]
 *   unmappedTypes    block types that need no selector of their own
 *
 * `findings` is what the conversion recorded per page: { pages: { [path]:
 * { rules, review, blocks } } }.
 */

/** The mapping, or a loud refusal: a comparison of unnamed regions is none. */
function need(mapping, fn) {
  if (!mapping || !Array.isArray(mapping.regions) || !mapping.rules || !mapping.blockRegions || !Array.isArray(mapping.blockExceptions) || !Array.isArray(mapping.unmappedTypes) || !mapping.reviewRules || !mapping.decidedPages) {
    throw new TypeError(`${fn}: the comparison's region mapping (regions, blockRegions, rules, reviewRules, decidedPages, blockExceptions, unmappedTypes)`);
  }
  return mapping;
}

/**
 * The regions to compare for one page, and the rules that removed the rest.
 *
 * Throws on a rule this file does not know. That is the point of naming rules
 * instead of shipping selectors from the conversion: a new rule arrives as a
 * question, loudly, instead of being compared as if it had not happened.
 */
export function regionsFor(path, findings, mapping) {
  const { regions: REGIONS, rules: RULES, reviewRules: REVIEW_RULES, decidedPages: DECIDED_PAGES } = need(mapping, "regionsFor");
  const entry = findings?.pages?.[path];
  if (!entry) {
    throw new Error(
      `No conversion findings for ${path}. The comparison cannot tell whether ` +
        `this page was restructured, and guessing is how a reflow gets reported ` +
        `as a defect. Re-run the conversion, or drop the page from the worklist.`,
    );
  }
  const applied = [
    ...(entry.rules ?? []),
    ...new Set((entry.review ?? []).map((r) => REVIEW_RULES[r.kind]).filter(Boolean)),
    ...(DECIDED_PAGES[path] ?? []),
  ];
  const unknown = applied.filter((rule) => !RULES[rule]);
  if (unknown.length) {
    throw new Error(
      `${path}: the conversion applied ${unknown.map((r) => `"${r}"`).join(", ")} ` +
        `and the comparison's region mapping does not say what that means. ` +
        `Add it to its rules — with what it makes incomparable, and why.`,
    );
  }
  const precluded = new Map();
  for (const rule of applied) {
    for (const name of RULES[rule].precludes) {
      if (!REGIONS.some((r) => r.name === name)) {
        throw new Error(
          `Rule "${rule}" precludes a region called "${name}", which is not one ` +
            `of the mapping's regions. A preclusion that matches no region silently does nothing.`,
        );
      }
      precluded.set(name, rule);
    }
  }
  return {
    regions: REGIONS.filter((r) => !precluded.has(r.name)),
    precluded: [...precluded].map(([name, rule]) => ({ name, rule })),
    rules: applied,
    blocks: entry.blocks ?? [],
  };
}

/** The block TYPES a page carries, from the conversion's own signatures. */
export function blockTypesOn(path, findings) {
  const sigs = findings?.pages?.[path]?.blocks ?? [];
  return [...new Set(sigs.map((s) => s.split(":")[0]))];
}

/**
 * Block regions to compare on a page — every type it carries, or just the ones
 * asked for. Each is measured as a COUNT and a size per instance: a page has
 * many cards, and "8 cards on the source, 6 on ours" is the finding.
 */
export function blockRegionsFor(path, findings, mapping, only = null) {
  const { rules: RULES, blockRegions: BLOCK_REGIONS } = need(mapping, "blockRegionsFor");
  const wanted = only ? new Set(only) : null;
  // A page a rule rebuilt (`blocksAreOurs`): its blocks are the conversion's,
  // and the source has none of them to wait for (a listing the source never
  // draws). A rule that only REFLOWS a page keeps waiting:
  // its blocks are on the source, and the wait is what makes them measured
  // once loaded.
  const rules = findings?.pages?.[path]?.rules ?? [];
  const restructured = rules.some((rule) => RULES[rule]?.blocksAreOurs);
  // Block types a rule made from something else (`blocksMade`): the source
  // has none of them to wait for, while the rest of the page's blocks it has.
  const made = new Set(rules.flatMap((rule) => RULES[rule]?.blocksMade ?? []));
  // A type that is another's region (`sameAs`) is that region, once.
  const regionOf = (type) => BLOCK_REGIONS[type]?.sameAs ?? type;
  return [...new Set(blockTypesOn(path, findings).filter((type) => (wanted ? wanted.has(type) : true)).map(regionOf))]
    .filter((type) => BLOCK_REGIONS[type] && !BLOCK_REGIONS[type].partOnly)
    .map((type) => ({
      name: `block:${type}`,
      old: BLOCK_REGIONS[type].old ?? BLOCK_REGIONS[type].sel ?? null,
      new: BLOCK_REGIONS[type].new ?? BLOCK_REGIONS[type].sel,
      blockType: type,
      createdByConversion: restructured || made.has(type) || Boolean(BLOCK_REGIONS[type].createdByConversion),
      optional: Boolean(BLOCK_REGIONS[type].optional),
    }));
}

/**
 * Types the findings place on a page that the mapping has no selector for,
 * leaving out the ones it says need none (`unmappedTypes`: a title, or a
 * block that is only a wrapper).
 */
export function unmappedBlockTypes(path, findings, mapping) {
  const { blockRegions: BLOCK_REGIONS, unmappedTypes } = need(mapping, "unmappedBlockTypes");
  return blockTypesOn(path, findings).filter((type) => !BLOCK_REGIONS[type] && !unmappedTypes.includes(type));
}

// A region's name without the `block:` prefix, which is how a block exception
// spells its `node`. Block regions are named `block:card`; a PART is named
// `card copy`, with no prefix, so both reduce correctly.
//
// Shared, because the two lookups over the block exceptions used to disagree
// about it — see exceptionFor.
export const bare = (name) => name.replace(/^block:/, "");

/**
 * The differing regions, reduced to the ones that explain the rest: each
 * difference is reported at the DEEPEST region that differs (a card's image,
 * not the card, not the page), unless an approved block exception explains it.
 * `parentOf` is the containment the page reported (Map name → containing name).
 */
export function localise(differing, parentOf, mapping) {
  need(mapping, "localise");
  const differs = new Set(differing.map((f) => f.name));
  const byName = new Map(differing.map((f) => [f.name, f]));
  // The SAME test exceptionFor applies — node, and the verdict/box shape the
  // exception is about. Matching the node alone excused anything reported on
  // it: a pictogram filling the column would have been "explained" by an
  // exception that is only about 48px ones.
  const excused = (name) => {
    const hit = exceptionFor(byName.get(name), mapping);
    return hit ? [hit] : [];
  };

  // Build the tree on NEAREST DIFFERING ANCESTOR, not immediate parent. A
  // difference can skip a level — a card whose box matches but whose image does
  // not — and walking only direct children breaks the chain there, which left
  // the container reported and the actual leaf unmentioned.
  const nearestDifferingAncestor = (name) => {
    for (let p = parentOf.get(name); p; p = parentOf.get(p))
      if (differs.has(p)) return p;
    return null;
  };
  const kidsOf = new Map();
  for (const name of differs) {
    const parent = nearestDifferingAncestor(name);
    if (parent) kidsOf.set(parent, [...(kidsOf.get(parent) ?? []), name]);
  }
  // Something measured below this node, whether or not it differed — the
  // difference between "nothing inside disagrees" and "nothing inside was
  // looked at", which is the difference between a finding and LOOK HARDER.
  const hasDescendants = (name) =>
    [...parentOf.values()].includes(name) ||
    [...parentOf].some(([child]) => nearestDifferingAncestor(child) === name);

  const seen = new Set();
  const report = [];
  const visit = (name) => {
    if (seen.has(name)) return { explained: true };
    seen.add(name);
    const known = excused(name);
    // A known difference in the BOX makes the subtree unmeasurable: there is
    // nothing below to descend into and nothing to report from it.
    if (known.some((e) => e.precludesSubtree)) return { explained: true };
    const kids = kidsOf.get(name) ?? [];
    if (kids.length === 0) {
      if (known.length) return { explained: true };
      report.push({ ...byName.get(name), lookHarder: hasDescendants(name) });
      return { explained: false };
    }
    let allExplained = true;
    for (const k of kids) if (!visit(k).explained) allExplained = false;
    return { explained: allExplained };
  };

  for (const name of differs) if (!nearestDifferingAncestor(name)) visit(name);
  return report;
}
/**
 * Drop findings that sit under a node an approved exception says precludes its
 * subtree ("an empty list has nothing inside it to compare against ours").
 * `precluding` are the names of the excused findings that carry
 * `precludesSubtree`; `parentOf` is the containment the page reported.
 */
export function dropPrecludedSubtrees(findings, precluding, parentOf) {
  const blocked = new Set(precluding);
  const underBlocked = (name) => {
    for (let p = parentOf.get(name); p; p = parentOf.get(p)) if (blocked.has(p)) return true;
    return false;
  };
  return findings.filter((f) => !underBlocked(f.name));
}

/**
 * Does a conversion rule applied to this page account for this finding?
 * Returns the rule, or null. `rules` is the page's applied rules, a rule once
 * per time it applied.
 */
export function reflowExcuse(finding, rules, context, mapping) {
  const { rules: RULES } = need(mapping, "reflowExcuse");
  // A COUNT several rules explain together: their allowances add up
  // (9 columns vs 6 on one page: one rule's 2 and another's 1).
  const isCount =
    finding.a && finding.b && typeof finding.a.n === "number" && typeof finding.b.n === "number" &&
    !finding.visual && !(Array.isArray(finding.instances) && finding.instances.length > 0);
  if (isCount) {
    const fewer = finding.a.n - finding.b.n;
    let least = 0;
    let most = 0;
    const by = [];
    for (const rule of new Set(rules)) {
      const allowance = RULES[rule]?.counts?.[bare(finding.name)];
      if (!allowance) continue;
      const [lo, hi] = allowance(rules.filter((r) => r === rule).length);
      least += lo;
      most += hi;
      by.push(rule);
    }
    if (by.length && fewer !== 0 && fewer >= least && fewer <= most) return by.join(" + ");
  }
  for (const rule of new Set(rules)) {
    const times = rules.filter((r) => r === rule).length;
    if (RULES[rule]?.excuses?.(finding, times, context)) return rule;
  }
  return null;
}

/** Does an approved exception cover this finding? Returns the label, or null. */
export function exceptionFor(finding, mapping) {
  const { blockExceptions: BLOCK_EXCEPTIONS } = need(mapping, "exceptionFor");
  // `node`, the key localise() matches on. (This once matched `e.region`,
  // which no entry defined, so the exceptions applied through localise but
  // SILENTLY, and `sizeOnly` constrained nothing.)
  const hit = BLOCK_EXCEPTIONS.find(
    (e) =>
      e.node === bare(finding.name) &&
      (!e.sizeOnly || /^\d+\/\d+ \d+x\d+ vs |^\d+x\d+ vs /.test(finding.verdict)) &&
      // Or a statement about PIXELS: excuses a pixel verdict and nothing else.
      (!e.pixelsOnly || /^[\d.]+% of its own pixels differ/.test(finding.verdict)) &&
      // An exception about particular sizes checks them on the measured boxes.
      (!e.matches || e.matches(finding)),
  );
  return hit ?? null;
}

/**
 * Which named region owns each patch of differing pixels.
 *
 * The comparison already clusters differing pixels into page-absolute boxes,
 * and already measures every region's page-absolute box and who contains whom.
 * It did not join the two, so a run reported "51.6% of pixels differ in 5
 * region(s)" and left the reader to work out which block that was — while the
 * STRUCTURAL findings localised to the deepest differing node. The pixels get
 * the same treatment here.
 *
 * DEEPEST wins, by the containment the page itself reported: a difference
 * inside a card's image is the image's, not the card's and certainly not the
 * page's. Overlap AREA decides which region a straddling cluster belongs to —
 * a cluster can cross a boundary, and blaming the region under its centre put
 * differences in the wrong block when the centre landed in the gap between
 * two.
 *
 * A cluster nothing contains is returned with `name: null` rather than
 * dropped. "Differing pixels nobody claims" is a finding in its own right —
 * usually a region the mapping has no selector for yet.
 *
 * @param clusters    [{x, y, width, height, pixels}] in page coordinates
 * @param regionBoxes {name: {x, y, w, h} | null} from the side being blamed
 * @param parentOf    Map(name -> containing name), as observed on that side
 * @returns [{name, pixels, share}] biggest share first
 */
export function attributeClusters(clusters, regionBoxes, parentOf) {
  const total = clusters.reduce((sum, c) => sum + c.pixels, 0);
  if (!total) return [];

  const depth = (name) => {
    const seen = [name];
    for (let p = parentOf.get(name); p; p = parentOf.get(p)) {
      // A page is a tree, so containment cannot loop; when it did, this spun
      // forever and froze a whole run. Say so.
      if (seen.includes(p)) {
        throw new Error(`region containment loops: ${[...seen, p].join(" -> ")}`);
      }
      seen.push(p);
    }
    return seen.length - 1;
  };
  const boxes = Object.entries(regionBoxes ?? {})
    .filter(([name, b]) => name !== "__parent" && b && typeof b.x === "number")
    .map(([name, b]) => ({ name, b, depth: depth(name) }));

  // CONTAINMENT FIRST, then depth. Depth alone let a deep region win on any
  // overlap at all: a 400px band of differing pixels starting at y=480 was
  // blamed on a `block:table` 75px strip ending at y=485 — five pixels, and
  // 68% of that page's difference reported against a table that converted
  // perfectly. A region has to hold MOST of a cluster before its depth counts.
  const MOSTLY = 0.5;

  const owner = (c) => {
    const area = Math.max(1, c.width * c.height);
    let best = null;
    for (const { name, b, depth: d } of boxes) {
      const overlap =
        Math.max(0, Math.min(c.x + c.width, b.x + b.w) - Math.max(c.x, b.x)) *
        Math.max(0, Math.min(c.y + c.height, b.y + b.h) - Math.max(c.y, b.y));
      if (overlap <= 0) continue;
      const holds = overlap / area >= MOSTLY;
      // A region that holds the cluster always beats one that merely clips it;
      // among those, deeper wins (a card's image over the card); among equals,
      // more overlap.
      const better =
        !best ||
        (holds && !best.holds) ||
        (holds === best.holds &&
          (d > best.depth || (d === best.depth && overlap > best.overlap)));
      if (better) best = { name, depth: d, overlap, holds };
    }
    return best?.name ?? null;
  };

  const byName = new Map();
  for (const c of clusters) {
    const name = owner(c);
    byName.set(name, (byName.get(name) ?? 0) + c.pixels);
  }
  return [...byName]
    .map(([name, pixels]) => ({ name, pixels, share: pixels / total }))
    .sort((a, b) => b.pixels - a.pixels);
}

/**
 * Images served far bigger than they are drawn — on OUR render, the side we
 * can fix. Neither the pixel nor the text comparison can see this: one home
 * page drew a 284x268 card image from a 6585x4390 original (the source served
 * a 600x400 scale) and looked right. 2x covers a high-DPI screen, the
 * most a srcset should ever pick. An image with no drawn width (hidden) is
 * not measured. `block` names where the image sits (a card, the footer), or null.
 */
export const OVERSIZE_FACTOR = 2;

export function oversizedImages(images) {
  return images
    .filter((img) => img.drawn.w > 0 && img.natural.w > OVERSIZE_FACTOR * img.drawn.w)
    .map((img) => ({
      name: img.block ?? `image ${img.src}`,
      verdict:
        `image served ${img.natural.w}x${img.natural.h} for ${img.drawn.w}x${img.drawn.h} ` +
        `(${Math.round(img.natural.w / img.drawn.w)}x) ${img.src}`,
      oversized: true,
    }));
}

/**
 * Every image on the page (header, main and footer: the footer's artwork was
 * outside `main` and so never looked at) that loads the wrong copy:
 *
 *  - too big: served more than OVERSIZE_FACTOR times its drawn width;
 *  - too small: drawn wider than the copy served, when its srcset offered a
 *    larger one (`largest`) — a stretched, softened image. One with nothing
 *    larger to offer is the upload's own size, not a choice.
 *
 *  - broken: it did not load at all (`broken`), at whatever size it was drawn.
 *    Ours to fix even when the source's copy is broken too, which it says.
 *
 * Each says what the SOURCE loads for the same file (`key`: the path before
 * `/@@images/`), so the finding carries the other half of the comparison.
 */
export function imageFindings(ours, source) {
  const sourceByKey = new Map(source.map((s) => [s.key, s]));
  return ours
    .filter((img) => img.broken || img.drawn.w > 0)
    .flatMap((img) => {
      const theirs = sourceByKey.get(img.key);
      const beside = !theirs
        ? ""
        : theirs.broken
          ? "; the source's does not load either"
          : `; the source loads ${theirs.natural.w}x${theirs.natural.h}`;
      const name = img.block ?? `image ${img.src}`;
      if (img.broken)
        return [{ name, verdict: `image did not load: ${img.src}${beside}`, broken: true }];
      if (img.natural.w > OVERSIZE_FACTOR * img.drawn.w)
        return [{
          name,
          verdict:
            `image served ${img.natural.w}x${img.natural.h} for ${img.drawn.w}x${img.drawn.h} ` +
            `(${Math.round(img.natural.w / img.drawn.w)}x) ${img.src}${beside}`,
          oversized: true,
        }];
      if (img.natural.w < img.drawn.w - 1 && img.largest > img.natural.w)
        return [{
          name,
          verdict:
            `image stretched: ${img.natural.w}x${img.natural.h} drawn at ${img.drawn.w}x${img.drawn.h} ` +
            `(a ${img.largest}w copy was offered) ${img.src}${beside}`,
          undersized: true,
        }];
      return [];
    });
}

/**
 * Block regions whose selectors matched the SAME elements on one side. Their
 * counts and sizes then describe each other's blocks — one frontend drew
 * images, embeds and videos with one class, and a page counted three embedded
 * reports as images too (2 vs 5) — so the overlap is a finding of its own:
 * the selector needs narrowing before the numbers mean anything.
 * `shared` is what the page measurement records: [{ names, n, side }].
 */
export function selectorOverlaps(shared) {
  return shared.map(({ names, n, side }) => ({
    name: `selectors: ${names.join(" + ")}`,
    verdict:
      `${names.join(" and ")} match the same ${n} element(s) on ${side} — ` +
      `their counts and sizes are not each other's; narrow the selectors`,
    selectorOverlap: true,
  }));
}

/**
 * Why a page could not be measured, for a side (source or ours) that did not
 * settle. A page that failed to load never reached the wait for its blocks, so
 * it has no block to name: reported as a load failure, not as a missing block.
 */
export function unsettledVerdict(source, ours, timeoutMs) {
  if (source.loadError || ours.loadError) {
    const failed = [
      source.loadError && `source: ${source.loadError}`,
      ours.loadError && `ours: ${ours.loadError}`,
    ].filter(Boolean);
    return `the page did not load (${failed.join("; ")})`;
  }
  const side = (s) => (s.settled ? "ok" : `waiting for ${(s.unsettled ?? ["?"]).join(", ")}`);
  return (
    `a block the conversion expects never appeared in ${timeoutMs}ms ` +
    `(source ${side(source)}, ours ${side(ours)})`
  );
}
