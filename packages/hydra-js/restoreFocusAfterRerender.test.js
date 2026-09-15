import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * Putting the caret back after the frontend re-renders the block under it.
 *
 * The watcher that calls this fires when the focused field's element is
 * DETACHED, so by definition the element carrying the field now is a new one —
 * and nothing has made it editable yet. focus() on an element without
 * `contenteditable` is a silent no-op: it is connected, it is on screen, and
 * document.activeElement simply stays on the body, so the author's next
 * keystroke goes nowhere.
 *
 * That is what left a collapsed filter facet uneditable after its disclosure
 * opened: the reveal re-rendered the panel, the restore focused a field that
 * was not editable yet, and the pass that would have made it editable ran
 * afterwards. Block sanity caught it as "should put the caret in it:
 * activeElement=BODY", intermittently — it only fails when the re-render lands
 * inside the window the restore is watching.
 */
describe('restoreFocusIfFieldLost', () => {
  const page = () => {
    const { window } = new JSDOM(`<!DOCTYPE html>
      <div data-block-uid="facet-1">
        <button><span data-edit-text="title">Published</span></button>
      </div>`);
    return window.document;
  };

  /** A bridge mid-edit, whose field element was just replaced by a re-render. */
  const bridgeOn = (document, calls) =>
    Object.assign(Object.create(Bridge.prototype), {
      editMode: 'text',
      focusedFieldName: 'title',
      savedClickPosition: { relativeX: 4, relativeY: 4, editableField: 'title' },
      selectedBlockUid: 'facet-1',
      getAllBlockElements: (uid) =>
        document.querySelectorAll(`[data-block-uid="${uid}"]`),
      queryBlockElement: (uid) =>
        document.querySelector(`[data-block-uid="${uid}"]`),
      isElementHidden: () => false,
      getBlockData: () => ({}),
      _readonlyBlocks: new Set(),
      isBlockReadonly: () => false,
      getFieldType: () => 'string',
      getFieldPlaceholder: () => null,
      updateEmptyState: () => {},
      getBlockSchema: () => ({ properties: { title: { type: 'string' } } }),
      caretRangeFromPoint: () => null,
      // Record what the restore did, in order.
      ...calls,
    });

  const withDocument = (document, fn) => {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    globalThis.document = document;
    globalThis.window = document.defaultView;
    try {
      return fn();
    } finally {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    }
  };

  test('the field is editable by the time it is focused', () => {
    const document = page();
    withDocument(document, () => {
      const bridge = bridgeOn(document);
      const block = document.querySelector('[data-block-uid="facet-1"]');
      const field = document.querySelector('[data-edit-text="title"]');
      // A field fresh from a re-render carries no contenteditable.
      expect(field.getAttribute('contenteditable')).toBe(null);

      let editableWhenFocused = 'focus() never called';
      field.focus = () => {
        editableWhenFocused = field.getAttribute('contenteditable');
      };

      bridge.restoreFocusIfFieldLost(block);

      expect(editableWhenFocused).toBe('true');
    });
  });

  test('a re-render that left the field alone restores nothing', () => {
    const document = page();
    withDocument(document, () => {
      const bridge = bridgeOn(document);
      const block = document.querySelector('[data-block-uid="facet-1"]');
      const field = document.querySelector('[data-edit-text="title"]');
      // Still focused: the saved click position is spent on first use, so a
      // benign re-render must not consume it.
      Object.defineProperty(document, 'activeElement', {
        value: field,
        configurable: true,
      });

      bridge.restoreFocusIfFieldLost(block);

      expect(bridge.savedClickPosition).not.toBe(null);
    });
  });
});
