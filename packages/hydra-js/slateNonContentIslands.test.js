import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * Reading a field back out of the DOM skips what is not content.
 *
 * A frontend may draw things beside the author's text that are not part of it:
 * a decorative icon (aria-hidden), or words the frontend writes itself, such as
 * a file's type and size after a link to it (contenteditable=false, so the caret
 * steps over them). The reader skipped those only as DIRECT children of a node.
 * A frontend that wraps a link's text in a span of its own (to style the text
 * apart from an icon) and draws its words inside that span had them read in
 * with the author's text, and saved on the next edit.
 */
describe('domNodeToSlate skips non-content islands at any depth', () => {
  const read = (inner) => {
    const { window } = new JSDOM(`<!DOCTYPE html><body><p data-node-id="0">${inner}</p></body>`);
    const prev = { document: globalThis.document, window: globalThis.window, Node: globalThis.Node };
    globalThis.document = window.document;
    globalThis.window = window;
    globalThis.Node = window.Node;
    try {
      const bridge = Object.create(Bridge.prototype);
      const el = window.document.querySelector('p');
      return bridge.domNodeToSlate(el, { 0: { type: 'p' }, '0.1': { type: 'link', data: { url: '/report' } } })
        .children;
    } finally {
      globalThis.document = prev.document;
      globalThis.window = prev.window;
      globalThis.Node = prev.Node;
    }
  };
  const linkText = (children) => children.find((c) => c.type === 'link').children.map((c) => c.text).join('');

  it('skips a non-editable island as a direct child of the link (as before)', () => {
    const children = read(
      'Read the <a data-node-id="0.1"><span>report</span><span contenteditable="false"> (PDF, 1 MB)</span></a>.',
    );
    expect(linkText(children)).toBe('report');
  });

  it('skips a non-editable island inside the wrapper around the link text', () => {
    const children = read(
      'Read the <a data-node-id="0.1"><span>report<span contenteditable="false"> (PDF, 1 MB)</span></span></a>.',
    );
    expect(linkText(children)).toBe('report');
  });

  it('skips a decorative icon inside the wrapper', () => {
    const children = read(
      'Read the <a data-node-id="0.1"><span><svg aria-hidden="true"><text>icon</text></svg>report</span></a>.',
    );
    expect(linkText(children)).toBe('report');
  });

  it('still reads the text and line breaks of a plain wrapper', () => {
    const children = read('Read the <a data-node-id="0.1"><span>annual<br>report</span></a>.');
    expect(linkText(children)).toBe('annual\nreport');
  });
});
