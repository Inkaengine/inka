import { describe, test, expect, beforeEach } from 'vitest';
import { selectablePoint } from './selectablePoint';

/**
 * Where to click to SELECT a block — not merely "the centre of its first
 * element".
 *
 * A block can be several elements sharing one data-block-uid, and its first
 * element in the DOM is not necessarily the one an author would click. The
 * NSW consent block is its editing bar plus the cookie banner the design
 * system builds; the banner comes first, and its centre is the message's
 * "manage your cookie settings" link. Clicking there follows the link and the
 * editor leaves the page — which is not selecting the block.
 *
 * So the click goes where a click selects: on one of the block's elements, and
 * not on something inside it that acts when clicked — a link the editor lets
 * navigate (`data-linkable-allow`), a reveal handle (`data-block-selector`), a
 * button or a form control. The centre is tried first, so a block whose centre
 * is fine is clicked exactly where it always was. Ordinary links need no
 * skipping: the editor stops them navigating.
 */
type Box = { left: number; top: number; width: number; height: number };

/** Lay out `el` at `box`, and make `elementFromPoint` answer from `hits`. */
function place(el: Element, box: Box) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => box }) as DOMRect;
}

let hits: Array<{ box: Box; el: Element }> = [];
beforeEach(() => {
  hits = [];
  document.body.innerHTML = '';
  // Topmost last: the last matching region wins, as painting order would.
  document.elementFromPoint = (x: number, y: number) => {
    const hit = [...hits].reverse().find(
      ({ box }) => x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height,
    );
    return hit ? hit.el : null;
  };
  Element.prototype.scrollIntoView = () => {};
});

function region(el: Element, box: Box) {
  place(el, box);
  hits.push({ box, el });
}

describe('selectablePoint', () => {
  test("skips a link the editor lets navigate, at the centre of the block's first element", () => {
    document.body.innerHTML = `
      <div class="banner" data-block-uid="consent"><p>We use cookies. <a href="#cookie-consent" data-linkable-allow>manage</a></p></div>
      <div class="bar" data-block-uid="consent"><strong>Cookie consent</strong></div>`;
    const banner = document.querySelector('.banner')!;
    const text = banner.querySelector('p')!;
    const link = banner.querySelector('a')!;
    region(banner, { left: 0, top: 0, width: 100, height: 100 });
    region(text, { left: 0, top: 0, width: 100, height: 100 });
    region(link, { left: 40, top: 40, width: 20, height: 20 });
    region(document.querySelector('.bar')!, { left: 0, top: 200, width: 100, height: 50 });

    const point = selectablePoint(document.body, 'consent');
    expect(point).not.toBeNull();
    const hit = document.elementFromPoint(point!.clientX, point!.clientY)!;
    expect(hit.closest('a')).toBeNull();
    expect(hit.closest('[data-block-uid]')?.getAttribute('data-block-uid')).toBe('consent');
  });

  test('skips buttons, form controls and reveal handles', () => {
    document.body.innerHTML = `
      <div class="bar" data-block-uid="consent">
        <a class="handle" href="#" data-block-selector="consent#message">Show</a>
        <button>Accept</button>
        <span class="label">Cookie consent</span>
      </div>`;
    const bar = document.querySelector('.bar')!;
    region(bar, { left: 0, top: 0, width: 300, height: 30 });
    region(bar.querySelector('.handle')!, { left: 0, top: 0, width: 100, height: 30 });
    region(bar.querySelector('button')!, { left: 100, top: 0, width: 100, height: 30 });
    region(bar.querySelector('.label')!, { left: 200, top: 0, width: 100, height: 30 });

    const point = selectablePoint(document.body, 'consent');
    expect(document.elementFromPoint(point!.clientX, point!.clientY)).toBe(
      bar.querySelector('.label'),
    );
  });

  test('the centre is used whenever it is fine — as before', () => {
    document.body.innerHTML = `
      <div class="grid" data-block-uid="grid"><div class="card" data-block-uid="card-1">Card</div></div>`;
    const grid = document.querySelector('.grid')!;
    region(grid, { left: 0, top: 0, width: 100, height: 100 });
    // A nested block at the centre is fine: the helper selects the parent from it.
    region(grid.querySelector('.card')!, { left: 20, top: 20, width: 60, height: 60 });
    expect(selectablePoint(document.body, 'grid')).toMatchObject({ index: 0, clientX: 50, clientY: 50 });
  });

  test('a block that IS a link is clicked, not skipped', () => {
    document.body.innerHTML = `<a class="cta" href="/apply" data-block-uid="cta">Apply</a>`;
    region(document.querySelector('.cta')!, { left: 0, top: 0, width: 100, height: 40 });
    expect(selectablePoint(document.body, 'cta')).toMatchObject({ index: 0, clientX: 50, clientY: 20 });
  });

  test('says which element and where on it, for the click', () => {
    document.body.innerHTML = `<div class="only" data-block-uid="b"></div>`;
    region(document.querySelector('.only')!, { left: 10, top: 20, width: 100, height: 40 });
    expect(selectablePoint(document.body, 'b')).toEqual({ index: 0, x: 50, y: 20, clientX: 60, clientY: 40 });
  });

  test("with nowhere better, the first element's centre is still clicked", () => {
    // A block made entirely of links (a listing whose items are its elements)
    // is selected by clicking one of them — as it always has been.
    document.body.innerHTML = `
      <a class="item1" href="/a" data-linkable-allow data-block-uid="listing">A</a>
      <a class="item2" href="/b" data-linkable-allow data-block-uid="listing">B</a>`;
    region(document.querySelector('.item1')!, { left: 0, top: 0, width: 100, height: 40 });
    region(document.querySelector('.item2')!, { left: 0, top: 50, width: 100, height: 40 });
    expect(selectablePoint(document.body, 'listing')).toMatchObject({ index: 0, clientX: 50, clientY: 20 });
  });

  test('with nowhere better inside the block, its centre is still clicked', () => {
    document.body.innerHTML = `<div class="b" data-block-uid="b"><button>all button</button></div>`;
    const b = document.querySelector('.b')!;
    region(b, { left: 0, top: 0, width: 100, height: 100 });
    region(b.querySelector('button')!, { left: 0, top: 0, width: 100, height: 100 });
    expect(selectablePoint(document.body, 'b')).toMatchObject({ index: 0, clientX: 50, clientY: 50 });
  });
});
