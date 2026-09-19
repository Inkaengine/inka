import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * Reading a line break back out of the DOM.
 *
 * A slate line break is a "\n" inside a text leaf — Volto's own form: its editor
 * does editor.insertText('\n') on Shift+Enter and renders it as <br/>. Shift+Enter
 * in a frontend's contenteditable makes the browser insert a <br>, and the
 * full-field reader must turn that back into the same "\n".
 *
 * It used to read the <br> as its textContent, which is "", so the break
 * vanished and the lines ran together — while the single-node reader, which uses
 * innerText, kept it. The two readers disagreed about the same DOM.
 *
 * The one <br> that is NOT a line break is the browser's placeholder at the end
 * of a line (an empty paragraph is `<p><br></p>`, and a break at the very end
 * needs `<br><br>` to show). The single-node reader drops it by stripping one
 * trailing "\n"; this reader must agree.
 */
describe('domNodeToSlate reads <br> as a line break', () => {
  const read = (inner) => {
    const { window } = new JSDOM(`<!DOCTYPE html><body><p data-node-id="0">${inner}</p></body>`);
    const prev = { document: globalThis.document, window: globalThis.window, Node: globalThis.Node };
    globalThis.document = window.document;
    globalThis.window = window;
    globalThis.Node = window.Node;
    try {
      const bridge = Object.create(Bridge.prototype);
      const el = window.document.querySelector('p');
      return bridge.domNodeToSlate(el, { 0: { type: 'p' } }).children;
    } finally {
      globalThis.document = prev.document;
      globalThis.window = prev.window;
      globalThis.Node = prev.Node;
    }
  };

  it('keeps a line break between two lines', () => {
    expect(read('line one<br>line two')).toEqual([{ text: 'line one\nline two' }]);
  });

  it('keeps several line breaks', () => {
    expect(read('Street<br>Town<br>Postcode')).toEqual([{ text: 'Street\nTown\nPostcode' }]);
  });

  it("ignores the browser's placeholder <br> at the end of a line", () => {
    expect(read('line one<br>')).toEqual([{ text: 'line one' }]);
  });

  it('keeps a break at the very end, which the browser shows with two <br>s', () => {
    expect(read('line one<br><br>')).toEqual([{ text: 'line one\n' }]);
  });

  it('keeps a break inside bold text when more text follows it', () => {
    const json = JSON.stringify(read('<strong data-node-id="0.1">bold<br></strong>more'));
    expect(json).toContain('"bold\\n"');
    expect(json).toContain('more');
  });

  it('treats a <br> ending bold text at the end of the line as the placeholder', () => {
    const json = JSON.stringify(read('<strong data-node-id="0.1">bold<br></strong>'));
    expect(json).toContain('"bold"');
    expect(json).not.toContain('\\n');
  });

  // Frontends wrap each leaf in an element with no data-node-id — the fixture and
  // Next.js a <span>, Vue a wrapper span — and hydra reads that wrapper through a
  // separate branch. It must see the same breaks.
  describe('inside a leaf wrapper with no data-node-id', () => {
    it('keeps a line break', () => {
      expect(read('<span>line one<br>line two</span>')).toEqual([{ text: 'line one\nline two' }]);
    });

    it('keeps a break at the very end, drawn with two <br>s', () => {
      expect(read('<span>line one<br><br></span>')).toEqual([{ text: 'line one\n' }]);
    });

    it("ignores the placeholder <br> ending the wrapper and the line", () => {
      expect(read('<span>line one<br></span>')).toEqual([{ text: 'line one' }]);
    });

    it('keeps a break ending one wrapper when the next wrapper continues the line', () => {
      expect(read('<span>line one<br></span><span>line two</span>')).toEqual([
        { text: 'line one\nline two' },
      ]);
    });
  });

  it('reads an empty paragraph as empty, not as a line break', () => {
    expect(read('<br>')).toEqual([{ text: '' }]);
  });
});
