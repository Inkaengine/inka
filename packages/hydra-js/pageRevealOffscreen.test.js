import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * tryMakeBlockVisible reveals a child that is on ANOTHER PAGE of a paginated
 * container (a grid/listing that renders only a window of its children, so the
 * target isn't in the DOM at all). The container advertises its next/prev step
 * as `data-block-paging="+N"/"-N"`; the bridge clicks it, the container's own
 * handler renders the next page, and the bridge re-checks until the target
 * appears. This is the mechanism the nuxt env couldn't confirm — tested here in
 * isolation so a real logic bug can't hide behind a stale prebundle.
 */
describe('tryMakeBlockVisible — off-page child revealed via data-block-paging', () => {
  const PAGE = 6;
  const ALL = Array.from({ length: 10 }, (_, i) => `slate-${i}`); // 10 children, 2 pages
  let prev;

  const setup = () => {
    const { window } = new JSDOM(`<!DOCTYPE html><body>
      <div data-block-uid="grid">
        <div class="cells"></div>
        <a class="next" data-block-paging="+${PAGE}">Next</a>
      </div>
    </body>`);
    const { document } = window;
    const cells = document.querySelector('.cells');

    // Render a window [start, start+PAGE) of children as data-block-uid cells.
    let start = 0;
    const renderWindow = () => {
      cells.innerHTML = '';
      for (const id of ALL.slice(start, start + PAGE)) {
        const el = document.createElement('div');
        el.setAttribute('data-block-uid', id);
        cells.appendChild(el);
      }
    };
    renderWindow();
    // The pager navigates ITSELF: clicking next advances the window and re-renders.
    document.querySelector('.next').addEventListener('click', () => {
      start = Math.min(start + PAGE, ALL.length - 1);
      renderWindow();
    });

    // globals the bridge reads directly (saved/restored, not deleted — jsdom
    // itself needs the real `performance` when the next test builds a window).
    prev = {
      document: globalThis.document, window: globalThis.window, Node: globalThis.Node,
      NodeFilter: globalThis.NodeFilter, performance: globalThis.performance,
      requestAnimationFrame: globalThis.requestAnimationFrame,
    };
    globalThis.document = document;
    globalThis.window = window;
    globalThis.Node = window.Node;
    globalThis.NodeFilter = window.NodeFilter;
    globalThis.performance = { now: () => 0 };
    // synchronous rAF so checkVisibility runs right after the click
    globalThis.requestAnimationFrame = (cb) => { cb(0); return 0; };

    const blockPathMap = {
      grid: { parentId: null },
      ...Object.fromEntries(ALL.map((id) => [id, { parentId: 'grid' }])),
    };
    const bridge = Object.assign(Object.create(Bridge.prototype), {
      blockPathMap,
      queryBlockElement: (uid) => document.querySelector(`[data-block-uid="${uid}"]`),
      isElementHidden: (el) => !el || el.getAttribute('data-hidden') === 'true',
      getBlockById: (uid) => (uid === 'grid' ? { blocks_layout: { items: ALL } } : undefined),
      handlesFor: () => [],
      fillersFor: () => [],
      fillDeclaredInputs: () => [],
    });
    return { bridge, document, getStart: () => start };
  };

  afterEach(() => {
    Object.assign(globalThis, prev);
  });

  test('a child on page 2 (not in the DOM) is paged to and rendered', () => {
    const { bridge, document } = setup();
    // slate-8 is on page 2 (indices 6..9) and is NOT rendered initially.
    expect(document.querySelector('[data-block-uid="slate-8"]')).toBeNull();

    const result = bridge.tryMakeBlockVisible('slate-8');

    // The bridge clicked the +6 pager, the window advanced, and slate-8 rendered.
    expect(result).toBe(true);
    expect(document.querySelector('[data-block-uid="slate-8"]')).not.toBeNull();
  });

  test('a child already on the current page needs no paging', () => {
    const { bridge, getStart } = setup();
    bridge.tryMakeBlockVisible('slate-2'); // page 1, already rendered
    expect(getStart()).toBe(0); // never paged
  });
});
