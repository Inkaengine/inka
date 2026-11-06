import { jest } from '@jest/globals';
import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * Selecting a block starts watchers that report where it is: a position
 * tracker that runs each frame for 500ms, and stops only if the block is still
 * the selected one. A Ctrl+click clears the selected block, so one inside that
 * 500ms left the tracker running for good, and from then on any move of the
 * first block (a scroll) announced it as THE selection, every frame. The admin
 * took that as a selection: the multi-selection went, and one outline stayed
 * up through the scroll (block-selection.spec.ts, CI, 1 in many: only a fast
 * machine reaches the Ctrl+click in time).
 */
describe('a multi-selection takes over from the selected block', () => {
  let frames;
  let bridge;
  let block;
  let rect;
  let restore;

  const runFrames = (count) => {
    for (let i = 0; i < count; i++) {
      const due = [...frames.entries()];
      frames.clear();
      for (const [, callback] of due) callback();
    }
  };
  const reported = (src) => bridge.sent.filter((message) => message.src === src);

  beforeEach(() => {
    jest.useFakeTimers();
    frames = new Map();
    let nextFrame = 1;
    const { window } = new JSDOM('<!DOCTYPE html><body><div data-block-uid="a"></div><div data-block-uid="b"></div></body>');
    const globals = {
      document: window.document,
      window,
      MutationObserver: window.MutationObserver,
      requestAnimationFrame: (callback) => {
        frames.set(nextFrame, callback);
        return nextFrame++;
      },
      cancelAnimationFrame: (id) => frames.delete(id),
    };
    const before = Object.fromEntries(Object.keys(globals).map((name) => [name, globalThis[name]]));
    Object.assign(globalThis, globals);
    restore = () => Object.assign(globalThis, before);

    block = document.querySelector('[data-block-uid="a"]');
    rect = { top: 100, left: 10, width: 100, height: 50 };

    bridge = Object.create(Bridge.prototype);
    Object.assign(bridge, {
      sent: [],
      selectedBlockUid: 'a',
      multiSelectedBlockUids: [],
      _lastBlockRect: { ...rect },
      sendBlockSelected(src, element, options) { this.sent.push({ src, ...options }); },
      getBoundingBoxForElements: () => ({ ...rect }),
      queryBlockElement: (uid) => document.querySelector(`[data-block-uid="${uid}"]`),
    });
    bridge.observeBlockTransition([block], 'a');
  });

  afterEach(() => {
    jest.useRealTimers();
    restore();
  });

  it('the tracker reports a selected block as it moves', () => {
    rect.top = 50;
    runFrames(2);
    expect(reported('transitionTracker')).toHaveLength(1);
  });

  it('a Ctrl+click inside the 500ms stops it: the block moving later says nothing', () => {
    bridge._handleMultiSelectClick('b', { ctrlKey: true });
    expect(bridge.sent.map((message) => message.src)).toEqual(['multiSelect']);

    jest.advanceTimersByTime(600);
    rect.top = 50;
    runFrames(2);

    expect(reported('transitionTracker')).toEqual([]);
  });

  it('every way into a multi-selection stops it', () => {
    bridge.multiSelectedBlockUids = ['a', 'b'];
    bridge._sendMultiBlockSelected();

    rect.top = 50;
    runFrames(2);

    expect(reported('transitionTracker')).toEqual([]);
  });

  it('a block resizing later says nothing either', () => {
    let disconnected = false;
    bridge.blockResizeObserver = { disconnect: () => { disconnected = true; } };
    bridge._handleMultiSelectClick('b', { ctrlKey: true });
    expect(disconnected).toBe(true);
    expect(bridge.blockResizeObserver).toBeNull();
  });
});
