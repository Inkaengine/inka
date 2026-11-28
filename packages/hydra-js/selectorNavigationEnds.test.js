import { describe, test, expect, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * A click on a reveal trigger starts a selector navigation, and while one is
 * running the bridge ignores block clicks (`_blockSelectorNavigating`): the
 * trigger's click must not also select the block under it. So every navigation
 * has to END — select its block, or give up and hand clicks back. One that
 * waits for a block that cannot appear, and then neither selects nor gives up,
 * leaves every later click on the page dead.
 *
 * Found by checking one page's blocks in turn (block sanity): a cookie-consent
 * block's banner trigger carries `data-block-selector="consent#message"`.
 * Clicking it waited ~2s for a block whose uid was `consent#message`, which no
 * element has, then stopped polling with the flag still set — and the next
 * block's title, clicked to edit it, was ignored.
 */
describe('the block a handle is for', () => {
  test('a field handle is for its block', () => {
    // `uid#field` says WHERE the field is edited; the block is still `uid`.
    expect(Bridge.primaryUidOf('consent#message')).toBe('consent');
  });

  test('the first token names it, as before', () => {
    expect(Bridge.primaryUidOf('panel-1 child-a child-b')).toBe('panel-1');
    expect(Bridge.primaryUidOf('panel-1#title child-a')).toBe('panel-1');
  });

  test('a direction names no block', () => {
    expect(Bridge.primaryUidOf('+1')).toBeUndefined();
    expect(Bridge.primaryUidOf('carousel-1:next')).toBeUndefined();
  });
});

describe('a selector navigation that cannot find its block', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A bridge whose target never appears, with the messages it posts. */
  const bridgeWithNoTarget = () => {
    const sent = [];
    const bridge = Object.assign(Object.create(Bridge.prototype), {
      _blockSelectorNavigating: true,
      selectedBlockUid: 'previous',
      queryBlockElement: () => null,
      isElementHidden: () => true,
      selectBlock: () => {
        throw new Error('nothing to select');
      },
      sendBlockSelected: (src, el, opts) => sent.push({ src, blockUid: opts?.blockUid }),
    });
    return { bridge, sent };
  };

  test('gives clicks back when it gives up', () => {
    const { bridge } = bridgeWithNoTarget();
    bridge.waitForBlockVisibleAndSelect('gone', 0);
    expect(bridge._blockSelectorNavigating).toBe(false);
  });

  test('puts the selection it hid back', () => {
    // The navigation hid the block UI (HIDE_BLOCK_UI) on the way in. Giving up
    // without restoring it would leave the selected block with no outline.
    const { bridge, sent } = bridgeWithNoTarget();
    bridge.waitForBlockVisibleAndSelect('gone', 0);
    expect(sent).toEqual([{ src: 'navigationSettled', blockUid: 'previous' }]);
  });

  test('a superseded chain leaves the newer one in charge', () => {
    // Not this chain's flag to clear: a newer trigger click owns it now.
    const { bridge, sent } = bridgeWithNoTarget();
    bridge._selectorNavSeq = 2;
    bridge.waitForBlockVisibleAndSelect('gone', 0, 0, null, 1);
    expect(bridge._blockSelectorNavigating).toBe(true);
    expect(sent).toEqual([]);
  });
});

/**
 * The in-page navigation marker.
 *
 * A click on a `data-linkable-allow` element is let through to the frontend,
 * and when it is about to load another page (a facet, a paging link) the
 * bridge notes it in sessionStorage, so the load that follows is read as
 * in-page (PATH_CHANGE with inPage) instead of a fresh start. That note is
 * read by ANY load in the next few seconds — so a click that loads nothing must
 * not write one. A same-page fragment link is that: the design system's
 * "Cookie settings" link is `<a href="#cookie-consent">`, which opens a dialog.
 * It wrote the note anyway, and the next load of the editor within 5s was taken
 * for paging: it sent PATH_CHANGE, never INIT, and the editor never connected.
 */
describe('which allowed clicks can load another page', () => {
  const on = (html, url = 'http://site.test/news/page?x=1') => {
    const { window } = new JSDOM(`<!DOCTYPE html><body>${html}</body>`, { url });
    return window.document.body.firstElementChild;
  };

  test('a link to this page\'s own fragment loads nothing', () => {
    expect(Bridge.clickMayLoadPage(on('<a href="#cookie-consent">Cookie settings</a>'))).toBe(false);
    expect(
      Bridge.clickMayLoadPage(on('<a href="/news/page?x=1#top">Top</a>')),
    ).toBe(false);
  });

  test('a link to another path or query loads a page', () => {
    expect(Bridge.clickMayLoadPage(on('<a href="/news/page/@pg_b1_2">2</a>'))).toBe(true);
    expect(Bridge.clickMayLoadPage(on('<a href="?x=2">2</a>'))).toBe(true);
  });

  test('anything else may, as before', () => {
    // A facet's checkbox or select submits its form, or the frontend navigates
    // on change: nothing on the element says it will not.
    expect(Bridge.clickMayLoadPage(on('<input type="checkbox" name="f">'))).toBe(true);
    expect(Bridge.clickMayLoadPage(on('<button>Apply</button>'))).toBe(true);
    // A link with no href is a script's to act on, not knowable here.
    expect(Bridge.clickMayLoadPage(on('<a>Load more</a>'))).toBe(true);
  });
});
