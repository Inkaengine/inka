import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * adoptFrontendCaretTarget — before a character goes into an empty line, the
 * caret leaves the bridge's own caret node (U+FEFF) for the frontend's caret
 * target (U+200B), and the bridge's node goes: text typed where the frontend
 * doesn't draw is drawn again by its next render ("FreshFresh").
 *
 * A line can hold more than one of the bridge's nodes (a clear's re-render
 * parks a caret, then another): every bare one goes, not only the one the
 * caret was in. Left behind, the browser can put the typing in it anyway
 * (f7, CI: "﻿﻿​" before typing, "FreshFresh" after).
 */
describe('adoptFrontendCaretTarget', () => {
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
      return fn(window.document, window);
    } finally {
      globalThis.document = prev.document;
      globalThis.window = prev.window;
      globalThis.Node = prev.Node;
      globalThis.NodeFilter = prev.NodeFilter;
    }
  };

  const bridge = () => Object.create(Bridge.prototype);

  /** Put the caret at the end of `node`. */
  const caretAtEnd = (window, node) => {
    const range = window.document.createRange();
    range.setStart(node, node.length);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  /** The line's text nodes, as their characters' code points. */
  const textsOf = (line) => [...line.childNodes]
    .filter((n) => n.nodeType === 3)
    .map((n) => [...n.data].map((c) => c.codePointAt(0).toString(16)).join(' '));

  it("moves the caret from the bridge's node to the frontend's, and removes the bridge's", () => {
    withDom('<p data-node-id="0"></p>', (document, window) => {
      const line = document.querySelector('p');
      const ours = document.createTextNode('﻿');
      const theirs = document.createTextNode('​');
      line.append(ours, theirs);
      caretAtEnd(window, ours);

      bridge().adoptFrontendCaretTarget();

      expect(textsOf(line)).toEqual(['200b']);
      expect(window.getSelection().anchorNode).toBe(theirs);
      expect(window.getSelection().anchorOffset).toBe(1);
    });
  });

  it("removes every bare caret node of the bridge's in the line, not only the caret's", () => {
    withDom('<p data-node-id="0"></p>', (document, window) => {
      const line = document.querySelector('p');
      const caretOne = document.createTextNode('﻿');
      const another = document.createTextNode('﻿');
      const theirs = document.createTextNode('​');
      line.append(caretOne, another, theirs);
      caretAtEnd(window, caretOne);

      bridge().adoptFrontendCaretTarget();

      expect(textsOf(line)).toEqual(['200b']);
      expect(window.getSelection().anchorNode).toBe(theirs);
    });
  });

  it('leaves a caret node inside a format: a format toggled on, waiting for text', () => {
    withDom('<p data-node-id="0"><strong></strong></p>', (document, window) => {
      const line = document.querySelector('p');
      const formatted = document.createTextNode('﻿');
      line.querySelector('strong').append(formatted);
      const ours = document.createTextNode('﻿');
      const theirs = document.createTextNode('​');
      line.append(ours, theirs);
      caretAtEnd(window, ours);

      bridge().adoptFrontendCaretTarget();

      expect(line.querySelector('strong').firstChild).toBe(formatted);
      expect(textsOf(line)).toEqual(['200b']);
    });
  });
});
