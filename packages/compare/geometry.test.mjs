/**
 * Why a region differs, not only that it does.
 *
 *   node --test packages/compare/geometry.test.mjs
 *
 * The region verdicts stopped at the deepest NAMED region — "filters 530 vs
 * 560", "listing item 85 vs 77", "column 48 vs 95" — and each cause was then
 * found by hand, one element below where the named regions end. These are
 * those three, as the skeletons the comparison now records.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { firstDivergence, describeDivergence, regionSkeletons } from "./geometry.mjs";

const node = (t, c, w, h, k = [], s = {}) => ({
  t,
  c,
  w,
  h,
  s: { pt: "0px", pb: "0px", mt: "0px", mb: "0px", lh: "24px", fs: "16px", ...s },
  k,
});

test("a filter row: the chevron is taller, so the button is", () => {
  const live = node("div", ["ui-filters__item"], 336, 73, [
    node("button", ["ui-filters__item-button"], 288, 24, [
      node("span", ["ui-filters__item-name"], 100, 24),
      node("span", ["ui-material-icons"], 30, 16, [], { lh: "30px", fs: "30px" }),
    ]),
  ]);
  const ours = node("div", ["ui-filters__item"], 336, 79, [
    node("button", ["ui-filters__item-button"], 288, 30, [
      node("span", ["ui-filters__item-name"], 100, 24),
      node("span", ["ui-material-icons"], 30, 30, [], { lh: "45px", fs: "30px" }),
    ]),
  ]);
  const d = firstDivergence(live, ours);
  assert.equal(d.kind, "size");
  assert.deepEqual(d.path, ["div.ui-filters__item", "button.ui-filters__item-button", "span.ui-material-icons"]);
  assert.deepEqual(d.a, { w: 30, h: 16 });
  assert.deepEqual(d.b, { w: 30, h: 30 });
  assert.deepEqual(d.styles, { lh: ["30px", "45px"] });
  assert.match(describeDivergence(d), /span\.ui-material-icons 30x16 vs 30x30 \(lh 30px→45px\)/);
});

test("a listing item: an element only the source draws", () => {
  const live = node("div", ["ui-list-item"], 1168, 85, [
    node("div", ["ui-list-item__content"], 1120, 36, [
      node("div", ["ui-list-item__title"], 1120, 28),
      node("div", ["ui-list-item__copy"], 1120, 0, [], { mt: "8px" }),
    ]),
  ]);
  const ours = node("div", ["ui-list-item"], 1168, 77, [
    node("div", ["ui-list-item__content"], 1120, 28, [node("div", ["ui-list-item__title"], 1120, 28)]),
  ]);
  const d = firstDivergence(live, ours);
  assert.equal(d.kind, "only-source");
  assert.deepEqual(d.path, ["div.ui-list-item", "div.ui-list-item__content", "div.ui-list-item__copy"]);
  assert.match(describeDivergence(d), /only on the source: .*div\.ui-list-item__copy 1120x0 \(mt 8px\)/);
});

test("a column: an element only ours draws", () => {
  const live = node("div", ["ui-col"], 400, 48, [node("p", [], 368, 0)]);
  const ours = node("div", ["ui-col"], 400, 95, [
    node("p", [], 368, 24, [node("a", [], 20, 20, [node("span", ["ui-material-icons"], 20, 20)])]),
  ]);
  const d = firstDivergence(live, ours);
  assert.equal(d.kind, "only-ours");
  assert.deepEqual(d.path, ["div.ui-col", "p", "a"]);
});

test("the same tree is no divergence, and 1px is rounding", () => {
  const a = node("div", ["x"], 100, 50, [node("span", [], 10, 24)]);
  const b = node("div", ["x"], 100, 51, [node("span", [], 10, 24)]);
  assert.equal(firstDivergence(a, b), null);
});

test("a size difference no child explains stops at that element", () => {
  // Children match, the parent is taller: its own padding is the cause.
  const a = node("div", ["box"], 200, 50, [node("p", [], 200, 24)], { pt: "13px" });
  const b = node("div", ["box"], 200, 66, [node("p", [], 200, 24)], { pt: "21px" });
  const d = firstDivergence(a, b);
  assert.deepEqual(d.path, ["div.box"]);
  assert.deepEqual(d.styles, { pt: ["13px", "21px"] });
});

test("a modifier class on one side still pairs the element", () => {
  // Ours marks the filter item with a state modifier the source does not; it
  // is the same item, and the difference inside it is the finding.
  const live = node("form", ["ui-filters"], 336, 530, [
    node("div", ["ui-filters__item"], 336, 73, [
      node("button", ["ui-filters__item-button"], 288, 24, [node("span", ["ui-material-icons"], 30, 16)]),
    ]),
  ]);
  const ours = node("form", ["ui-filters"], 336, 560, [
    node("div", ["ui-filters__item", "ui-filters__item--closed"], 336, 79, [
      node("button", ["ui-filters__item-button"], 288, 30, [node("span", ["ui-material-icons"], 30, 30)]),
    ]),
  ]);
  const d = firstDivergence(live, ours);
  assert.equal(d.kind, "size");
  assert.equal(d.path[d.path.length - 1], "span.ui-material-icons");
});

test("a plain wrapper on one side is looked through", () => {
  // Ours wraps each filter item in a class-less div (a block's own element);
  // the source does not. The items still pair, one level down.
  const live = node("div", ["ui-filters__wrapper"], 336, 500, [
    node("div", ["ui-filters__item"], 336, 73, [node("span", ["ui-material-icons"], 30, 16)]),
  ]);
  const ours = node("div", ["ui-filters__wrapper"], 336, 530, [
    node("div", [], 336, 79, [
      node("div", ["ui-filters__item"], 336, 79, [node("span", ["ui-material-icons"], 30, 30)]),
    ]),
  ]);
  const d = firstDivergence(live, ours);
  assert.equal(d.kind, "size");
  assert.equal(d.path[d.path.length - 1], "span.ui-material-icons");
});

test("a design system wrapper only one side has is looked through too", () => {
  // The design system's filters put items in `ui-filters__list`; the source's older
  // theme puts them straight in the wrapper. Same items, one level apart.
  const live = node("div", ["ui-filters__wrapper"], 336, 500, [
    node("div", ["ui-filters__title"], 336, 30),
    node("div", ["ui-filters__item"], 336, 73, [node("span", ["ui-material-icons"], 30, 16)]),
  ]);
  const ours = node("div", ["ui-filters__wrapper"], 336, 530, [
    node("div", ["ui-filters__title"], 336, 30),
    node("div", ["ui-filters__list"], 336, 79, [
      node("div", ["ui-filters__item"], 336, 79, [node("span", ["ui-material-icons"], 30, 30)]),
    ]),
  ]);
  const d = firstDivergence(live, ours);
  assert.equal(d.kind, "size");
  assert.equal(d.path[d.path.length - 1], "span.ui-material-icons");
});

test("everyBox: a same-sized parent no longer hides a child that differs", () => {
  // The design system parity's case: a filter list whose height is content (five options
  // vs eight) is not compared, and the button inside it still must be.
  const ds = node("div", ["ui-filters__item"], 315, 0, [
    node("button", ["ui-filters__item-button"], 315, 24),
  ]);
  const ours = node("div", ["ui-filters__item"], 315, 0, [
    node("button", ["ui-filters__item-button"], 315, 30),
  ]);
  assert.equal(firstDivergence(ds, ours), null, "the comparison prunes by size");
  const d = firstDivergence(ds, ours, { everyBox: true });
  assert.equal(
    describeDivergence(d),
    "div.ui-filters__item > button.ui-filters__item-button: button.ui-filters__item-button 315x24 vs 315x30",
  );
});

test("a wrapper on one side is opened without opening the bare element on the other", () => {
  // Ours puts the menu toggle and the search in one plain div; the design system has the
  // search bare, and the search has children of its own. Opening both sides
  // at once opened the design system's search too, and nothing paired.
  const search = (h) =>
    node("div", ["ui-header__search"], 48, h, [node("button", [], 48, h)]);
  const ds = node("div", ["ui-header__inner"], 1104, 116, [
    node("div", ["ui-header__main"], 250, 76),
    search(48),
  ]);
  const ours = node("div", ["ui-header__inner"], 1104, 116, [
    node("div", ["ui-header__main"], 250, 76),
    node("div", [], 48, 48, [search(40)]),
  ]);
  assert.equal(
    describeDivergence(firstDivergence(ds, ours, { everyBox: true })),
    "div.ui-header__inner > div.ui-header__search > button: button 48x48 vs 48x40",
  );
});

test("the skeletons keep the classes of the prefix given, which is never assumed", () => {
  // Checked before the page is touched, so this runs without a browser.
  assert.throws(() => regionSkeletons({ sels: [], masked: [] }), /classPrefix/);
});
