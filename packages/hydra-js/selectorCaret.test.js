import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * Finding a field that is drawn OUTSIDE its block's element.
 *
 * A block can be drawn in two places: a tab's `code` sits in the panel that
 * carries the uid, while its `label` sits on the button that reveals it — the
 * button stands in for the block (`data-block-selector`) rather than being it.
 * `getOwnEditableFields` has always collected both, because clicking the label
 * has to edit the label.
 *
 * Resolving one field BY NAME did not: it searched the elements carrying the
 * uid and nothing else, so `label` came back null. That is what
 * `restoreSelectorCaret` asks for after a reveal — the click on a tab label is
 * consumed by the reveal, and the caret is put back once the block is selected
 * — so the caret was never restored, and the selection that follows focused the
 * block's FIRST field (the code) instead. Whether the author's click survived
 * came down to which finished first, which is exactly what a flaky test is.
 */
describe('getEditableFieldByName — a field on the handle is still the block\'s', () => {
  const page = () => {
    const { window } = new JSDOM(`<!DOCTYPE html>
      <div data-block-container>
        <button data-block-selector="tab-1 tab-1#code">
          <span data-edit-text="label">Astro</span>
        </button>
        <div data-block-uid="tab-1">
          <pre data-edit-text="code">console.log(1)</pre>
        </div>
      </div>`);
    return window.document;
  };

  /** A bridge with nothing readonly and no content loaded — just the DOM. */
  const bridgeOn = (document) =>
    Object.assign(Object.create(Bridge.prototype), {
      getAllBlockElements: (uid) => document.querySelectorAll(`[data-block-uid="${uid}"]`),
      isElementHidden: () => false,
      getBlockData: () => ({}),
      _readonlyBlocks: new Set(),
    });

  const withDocument = (document, fn) => {
    const previous = globalThis.document;
    globalThis.document = document;
    try {
      return fn();
    } finally {
      globalThis.document = previous;
    }
  };

  test('the field inside the block is found, as before', () => {
    const document = page();
    withDocument(document, () => {
      const bridge = bridgeOn(document);
      const block = document.querySelector('[data-block-uid="tab-1"]');
      expect(bridge.getEditableFieldByName(block, 'code').tagName).toBe('PRE');
    });
  });

  test('the field on the handle is found too', () => {
    const document = page();
    withDocument(document, () => {
      const bridge = bridgeOn(document);
      const block = document.querySelector('[data-block-uid="tab-1"]');
      const field = bridge.getEditableFieldByName(block, 'label');
      expect(field && field.tagName).toBe('SPAN');
    });
  });

  test('a field belonging to another block is not', () => {
    // The handle names one block; a field inside it that resolves to a
    // different one (a carousel dot labelled with its slide's text) is that
    // block's business, not this one's.
    const { window } = new JSDOM(`<!DOCTYPE html>
      <button data-block-selector="tab-1">
        <span data-block-uid="other-1"><i data-edit-text="label">Other</i></span>
      </button>
      <div data-block-uid="tab-1"></div>`);
    const document = window.document;
    withDocument(document, () => {
      const bridge = bridgeOn(document);
      const block = document.querySelector('[data-block-uid="tab-1"]');
      expect(bridge.getEditableFieldByName(block, 'label')).toBeNull();
    });
  });
});
