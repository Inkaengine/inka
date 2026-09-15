import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * One click, one navigation — the older one stops.
 *
 * Clicking a reveal trigger does not select the block there and then: the block
 * it reveals is usually still moving (a tab panel appearing pushes the page
 * around), so the bridge polls until its position is stable and selects after.
 * That wait is patient by design, and an author clicking along a tab bar
 * routinely clicks again while an earlier chain is still counting.
 *
 * The stale chain then selected ITS block. By that point the caret intent
 * recorded for that click had already been spent, so `selectBlock` fell back to
 * the block's FIRST editable field and focused it — the author clicked a tab's
 * label and the caret jumped into the code of the tab they had clicked before.
 * It only bit when the timing lined up, which is what made the codeExample
 * sanity check flaky (4 runs in 10) rather than simply broken.
 *
 * So each navigation is numbered, and a chain that finds itself superseded
 * stops without selecting.
 */
describe('waitForBlockVisibleAndSelect — only the newest navigation selects', () => {
  const bridgeWith = (seq) => {
    const { window } = new JSDOM(
      `<!DOCTYPE html><div data-block-uid="tab-1">code</div>`,
    );
    const selected = [];
    const bridge = Object.assign(Object.create(Bridge.prototype), {
      _selectorNavSeq: seq,
      queryBlockElement: (uid) =>
        window.document.querySelector(`[data-block-uid="${uid}"]`),
      isElementHidden: () => false,
      selectBlock: (el) => selected.push(el.getAttribute('data-block-uid')),
      restoreSelectorCaret: () => {},
    });
    return { bridge, selected };
  };

  test('a superseded chain selects nothing', () => {
    const { bridge, selected } = bridgeWith(2);
    // Chain 1 reaching its stable count long after chain 2 started.
    bridge.waitForBlockVisibleAndSelect('tab-1', 40, 3, 0, 1);
    expect(selected).toEqual([]);
  });

  test('the current chain selects', () => {
    const { bridge, selected } = bridgeWith(2);
    bridge.waitForBlockVisibleAndSelect('tab-1', 40, 3, 0, 2);
    expect(selected).toEqual(['tab-1']);
  });

  test('an untracked call still selects', () => {
    // seq 0 means "no navigation number" — nothing to supersede, so the old
    // behaviour stands for any caller that does not number its chain.
    const { bridge, selected } = bridgeWith(2);
    bridge.waitForBlockVisibleAndSelect('tab-1', 40, 3, 0);
    expect(selected).toEqual(['tab-1']);
  });
});

/**
 * A handle that names a REGION names everything in it.
 *
 * `data-block-selector="uid#field"` says "this is where that field of that
 * block is edited". When the field IS a region — a `blocks_layout` or an
 * `object_list` — the blocks inside it are edited in exactly that place, so the
 * handle is the way to reveal them too. An accordion whose panels live in
 * `data/items` publishes one handle for the region rather than enumerating
 * children it cannot know in advance.
 *
 * The bridge already walks up from a hidden block to the nearest ancestor that
 * published a handle. It looked only for the bare-uid form, so a container that
 * named its region was treated as publishing nothing and its children stayed
 * unreachable.
 */
describe('tryMakeBlockVisible — a region handle reveals the blocks in that region', () => {
  const page = () => {
    const { window } = new JSDOM(`<!DOCTYPE html>
      <div data-block-uid="acc-1">
        <button data-block-selector="acc-1#items" data-name="region-handle"></button>
        <div data-block-uid="panel-1" data-name="panel" hidden></div>
      </div>`);
    return window.document;
  };

  const bridgeOn = (document) => {
    const clicked = [];
    const bridge = Object.assign(Object.create(Bridge.prototype), {
      _selectorNavSeq: 0,
      blockPathMap: {
        'panel-1': { parentId: 'acc-1', region: 'items' },
        'acc-1': { parentId: null, region: null },
      },
      isElementHidden: (el) => el.getAttribute('data-name') === 'panel',
      queryBlockElement: (uid) => document.querySelector(`[data-block-uid="${uid}"]`),
      elementIsVisibleInViewport: () => true,
      scrollBlockIntoView: () => {},
    });
    for (const el of document.querySelectorAll('[data-block-selector]')) {
      el.click = () => clicked.push(el.getAttribute('data-name'));
    }
    return { bridge, clicked };
  };

  test('the region handle is clicked to reveal a block inside it', () => {
    const document = page();
    const previous = globalThis.document;
    const previousRaf = globalThis.requestAnimationFrame;
    globalThis.document = document;
    globalThis.requestAnimationFrame = () => 0;
    try {
      const { bridge, clicked } = bridgeOn(document);
      bridge.tryMakeBlockVisible('panel-1');
      expect(clicked).toEqual(['region-handle']);
    } finally {
      globalThis.document = previous;
      globalThis.requestAnimationFrame = previousRaf;
    }
  });
});
