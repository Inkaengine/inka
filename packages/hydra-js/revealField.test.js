import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * Revealing a FIELD, not just a block.
 *
 * A block can be drawn in several places at once, with a different field in
 * each. The design system's cookie consent is the clearest case: its message
 * lives in a banner and its category wording in a preferences dialog, both built
 * by design system JavaScript into `<body>`, both hidden until their own trigger
 * is pressed — while the block's own element (its editing bar) sits on screen
 * the whole time.
 *
 * A block-level handle cannot serve that. `data-block-selector="uid"` is one
 * handle and one click, so whichever half it opened, the other half's wording
 * stayed unreachable from the sidebar. The field is what says which half the
 * author means, so a handle can now name one:
 *
 *     data-block-selector="uid#message"
 *
 * `#` rather than `:`, which the grammar already spends on navigation
 * (`uid:direction`, alongside `+1` / `-1`).
 */
describe('selector tokens — a handle may name a field', () => {
  test('a plain uid names that block', () => {
    expect(Bridge.uidFromSelectorToken('block-1')).toBe('block-1');
  });

  test('`uid#field` names the same block', () => {
    // Everything except WHICH handle to click treats the two forms alike: a
    // `data-edit-text` inside either belongs to `block-1`.
    expect(Bridge.uidFromSelectorToken('block-1#message')).toBe('block-1');
  });

  test('navigation tokens name no block', () => {
    expect(Bridge.uidFromSelectorToken('+1')).toBeUndefined();
    expect(Bridge.uidFromSelectorToken('-1')).toBeUndefined();
    expect(Bridge.uidFromSelectorToken('block-1:next')).toBeUndefined();
  });

  test('nothing is not a token', () => {
    expect(Bridge.uidFromSelectorToken('')).toBeUndefined();
    expect(Bridge.uidFromSelectorToken(undefined)).toBeUndefined();
  });
});

describe('revealFieldPlace — asks about the FIELD', () => {
  /** A bridge with only the parts this decision touches. */
  const bridgeWith = ({ fieldElement, hidden, handle = {} }) => {
    const calls = [];
    return {
      calls,
      bridge: Object.assign(Object.create(Bridge.prototype), {
        // The handle is what opts a frontend in. Without one, nothing happens —
        // which is the ordinary case for a sidebar field with no canvas element
        // (a setting, an alignment, a link).
        fieldHandleFor: () => handle,
        queryBlockElement: () => ({}),
        getEditableFieldByName: () => fieldElement,
        isElementHidden: () => hidden,
        tryMakeBlockVisible: (uid, depth, field) => {
          calls.push({ uid, depth, field });
          return true;
        },
      }),
    };
  };

  test('a field already on screen reveals nothing', () => {
    const { bridge, calls } = bridgeWith({ fieldElement: {}, hidden: false });
    expect(bridge.revealFieldPlace('block-1', 'message')).toBe(false);
    expect(calls).toEqual([]);
  });

  test('a hidden field is revealed BY NAME', () => {
    const { bridge, calls } = bridgeWith({ fieldElement: {}, hidden: true });
    expect(bridge.revealFieldPlace('block-1', 'message')).toBe(true);
    // The field travels with the request: that is what picks the `uid#message`
    // handle over the block's own.
    expect(calls).toEqual([{ uid: 'block-1', depth: 0, field: 'message' }]);
  });

  test('a field with no element at all is revealed too', () => {
    // The banner before its first build, or a dialog not yet in the DOM: absent
    // is the same as hidden for this purpose.
    const { bridge, calls } = bridgeWith({ fieldElement: null, hidden: false });
    expect(bridge.revealFieldPlace('block-1', 'about_analytics')).toBe(true);
    expect(calls[0].field).toBe('about_analytics');
  });

  test('a field nothing advertises is left alone', () => {
    // The rule that keeps this feature from reaching past itself: most sidebar
    // fields have no canvas element AND no handle, and focusing one must not go
    // clicking whatever handle the block or its ancestors happen to publish.
    const { bridge, calls } = bridgeWith({
      fieldElement: null,
      hidden: true,
      handle: null,
    });
    expect(bridge.revealFieldPlace('block-1', 'align')).toBe(false);
    expect(calls).toEqual([]);
  });

  test('without a field name there is nothing to reveal', () => {
    // FOCUS_FIELD carries one; a caller that does not is asking about the
    // block, which is `tryMakeBlockVisible`'s own job.
    const { bridge, calls } = bridgeWith({ fieldElement: null, hidden: true });
    expect(bridge.revealFieldPlace('block-1', undefined)).toBe(false);
    expect(bridge.revealFieldPlace(undefined, 'message')).toBe(false);
    expect(calls).toEqual([]);
  });
});

/**
 * Which handle gets clicked when SEVERAL name the same field.
 *
 * The place a field is edited may advertise itself as well as being opened by a
 * trigger somewhere else. The cookie-consent banner has to: it sits outside the
 * block's element, so without `data-block-selector="uid#message"` on the banner
 * the wording inside it belongs to no block and cannot be edited at all.
 *
 * That leaves two elements carrying the same token — and the one in the DOM
 * first is the hidden half, which is exactly the thing that needs opening.
 * Clicking it would do nothing, so the bridge takes the first handle that is
 * ON SCREEN and only falls through to the ancestor walk if none is.
 */
describe('tryMakeBlockVisible — the handle that can actually be clicked', () => {
  /** A page where the hidden half advertises the field before its trigger does. */
  const page = () => {
    const { window } = new JSDOM(`<!DOCTYPE html>
      <div class="cookie-banner" data-block-selector="cc-1#message" data-name="half"></div>
      <div data-block-uid="cc-1">
        <button data-block-selector="cc-1#message" data-name="trigger"></button>
      </div>`);
    return window.document;
  };

  /** A bridge with only the parts this decision touches. */
  const bridgeOn = (document) => {
    const clicked = [];
    const bridge = Object.assign(Object.create(Bridge.prototype), {
      blockPathMap: {},
      isElementHidden: (el) => el.getAttribute('data-name') === 'half',
      queryBlockElement: (uid) => document.querySelector(`[data-block-uid="${uid}"]`),
      elementIsVisibleInViewport: () => true,
      scrollBlockIntoView: () => {},
    });
    for (const el of document.querySelectorAll('[data-block-selector]')) {
      el.click = () => clicked.push(el.getAttribute('data-name'));
    }
    return { bridge, clicked };
  };

  test('the visible trigger is clicked, not the hidden half it opens', () => {
    const document = page();
    const previous = globalThis.document;
    const previousRaf = globalThis.requestAnimationFrame;
    globalThis.document = document;
    // The bridge polls for the target appearing on the next frame; this test is
    // about WHICH handle it clicked, so the poll is a no-op here.
    globalThis.requestAnimationFrame = () => 0;
    try {
      const { bridge, clicked } = bridgeOn(document);
      bridge.tryMakeBlockVisible('cc-1', 0, 'message');
      expect(clicked).toEqual(['trigger']);
    } finally {
      globalThis.document = previous;
      globalThis.requestAnimationFrame = previousRaf;
    }
  });
});
