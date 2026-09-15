import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * getValidPositionForWhitespace — where a whitespace/empty caret lands.
 *
 * This function is used both to PARK a ZWS caret target inside an empty
 * node-id'd element (so a native keystroke can't leak out to the
 * contenteditable wrapper) and to serialise a DOM whitespace endpoint back to
 * a Slate path (the offset===0 → isRangeEnd=false caller in getSlateSelection).
 *
 * The empty-slate fix (insert the ZWS even when the node-id is present) added a
 * branch that routes a node CONTAINED in the node-id element to the "start"
 * position — because compareDocumentPosition reads a contained node as "after
 * content" and would otherwise route to the end branch, which never creates a
 * ZWS. That branch MUST be gated on the element being empty of visible text:
 * for a NON-empty element (e.g. a trailing-space whitespace node inside
 * "some text bold"), a contained node at offset 0 must still be positioned by
 * real DOM order (the end branch), or select-all/format on that content breaks
 * (regressed markdown-shortcuts:140 and inline-editing-formatting:993).
 */
describe('getValidPositionForWhitespace — contained-node routing is gated on emptiness', () => {
  const withDom = (html, fn) => {
    const { window } = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
    const prev = {
      document: globalThis.document,
      window: globalThis.window,
      Node: globalThis.Node,
      NodeFilter: globalThis.NodeFilter,
    };
    globalThis.document = window.document;
    globalThis.window = window;
    globalThis.Node = window.Node;
    globalThis.NodeFilter = window.NodeFilter;
    try {
      return fn(window.document);
    } finally {
      globalThis.document = prev.document;
      globalThis.window = prev.window;
      globalThis.Node = prev.Node;
      globalThis.NodeFilter = prev.NodeFilter;
    }
  };

  const bridge = () => Object.create(Bridge.prototype);

  test('an EMPTY node-id element gets a ZWS parked inside it (start branch)', () => {
    withDom(
      '<div data-edit-text="value"><p data-node-id="0"></p></div>',
      (document) => {
        const p = document.querySelector('[data-node-id="0"]');
        // Caret sits on the empty <p> itself — the contained-empty case hunk-2
        // exists for. isRangeEnd defaults to false (offset === 0 caller).
        const pos = bridge().getValidPositionForWhitespace(p);
        expect(pos).not.toBeNull();
        // A ZWS caret target was created INSIDE the node-id element, caret after it.
        expect(pos.textNode.textContent).toBe('﻿');
        expect(pos.offset).toBe(1);
        expect(pos.textNode.parentNode).toBe(p);
      },
    );
  });

  test('a NON-empty node-id element keeps DOM-order routing (end branch, no ZWS prepended)', () => {
    withDom(
      // A trailing-space whitespace text node inside a non-empty <p>, exactly
      // the shape produced after a markdown format ("some text **bold**" + space
      // → "some text bold" + " "). getNodePath is null for the bare space, so
      // getSlateSelection calls getValidPositionForWhitespace(spaceNode, false).
      '<div data-edit-text="value"><p data-node-id="0">some text bold<span> </span></p></div>',
      (document) => {
        const p = document.querySelector('[data-node-id="0"]');
        // The trailing-space text node (contained in the non-empty <p>).
        const spaceTextNode = p.querySelector('span').firstChild;
        const pos = bridge().getValidPositionForWhitespace(spaceTextNode, false);
        expect(pos).not.toBeNull();
        // MUST route to the end of content, NOT prepend/return a ZWS at the start.
        // The broad (ungated) branch returned offset 0 of "some text bold",
        // mis-serialising the selection so select-all grabbed nothing.
        expect(pos.textNode.textContent.replace(/﻿/g, '')).toBe(' ');
        expect(pos.offset).toBe(1);
        // No ZWS was prepended to the visible content.
        expect(p.textContent.startsWith('﻿')).toBe(false);
      },
    );
  });
});
