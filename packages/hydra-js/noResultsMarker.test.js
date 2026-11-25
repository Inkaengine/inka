import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * A block that expands into repeats of another (a listing) can find nothing.
 * While editing, the expansion then gives back one `empty` item with the
 * block's own uid, so the author has something to click. That item is not a
 * slot: nothing can be added there, the block just found nothing. So the
 * bridge marks it apart from an empty slot (`data-hydra-no-results`, not
 * `data-hydra-empty`), and its styles draw a different marker on it.
 */
describe('markEmptyBlocks: a block that found nothing', () => {
  const marked = (html, types, noResults) => {
    const { window } = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
    const prev = { document: globalThis.document, window: globalThis.window };
    globalThis.document = window.document;
    globalThis.window = window;
    try {
      const bridge = Object.create(Bridge.prototype);
      bridge.getBlockType = (uid) => types[uid];
      bridge._noResultsBlocks = new Set(noResults);
      bridge.markEmptyBlocks();
      return [...window.document.querySelectorAll('[data-block-uid]')].map((el) => ({
        uid: el.getAttribute('data-block-uid'),
        empty: el.hasAttribute('data-hydra-empty'),
        noResults: el.hasAttribute('data-hydra-no-results'),
        title: el.getAttribute('title'),
      }));
    } finally {
      globalThis.document = prev.document;
      globalThis.window = prev.window;
    }
  };

  it('marks a block reported as having no results, not as an empty slot', () => {
    expect(marked('<div data-block-uid="list"></div>', { list: 'listing' }, ['list'])).toEqual([
      { uid: 'list', empty: false, noResults: true, title: 'Nothing to show' },
    ]);
  });

  it('leaves an empty slot marked as one', () => {
    expect(marked('<div data-block-uid="slot"></div>', { slot: 'empty' }, [])).toEqual([
      { uid: 'slot', empty: true, noResults: false, title: null },
    ]);
  });

  it('takes the mark off once the block has results again', () => {
    const { window } = new JSDOM(
      '<!DOCTYPE html><body><div data-block-uid="list" data-hydra-no-results="true" title="Nothing to show"></div></body>',
    );
    const prev = { document: globalThis.document, window: globalThis.window };
    globalThis.document = window.document;
    globalThis.window = window;
    try {
      const bridge = Object.create(Bridge.prototype);
      bridge.getBlockType = () => 'listing';
      bridge._noResultsBlocks = new Set();
      bridge.markEmptyBlocks();
      const el = window.document.querySelector('[data-block-uid="list"]');
      expect(el.hasAttribute('data-hydra-no-results')).toBe(false);
      expect(el.hasAttribute('title')).toBe(false);
    } finally {
      globalThis.document = prev.document;
      globalThis.window = prev.window;
    }
  });

  it('is recorded per block by setBlockNoResults', () => {
    const bridge = Object.create(Bridge.prototype);
    bridge._noResultsBlocks = new Set();
    bridge.setBlockNoResults('list', true);
    expect(bridge._noResultsBlocks.has('list')).toBe(true);
    bridge.setBlockNoResults('list', false);
    expect(bridge._noResultsBlocks.has('list')).toBe(false);
  });
});
