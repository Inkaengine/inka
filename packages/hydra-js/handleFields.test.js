import { JSDOM } from 'jsdom';
import { Bridge } from './hydra.src.js';

/**
 * A field drawn where the block ISN'T — and not only a text field.
 *
 * A block can be drawn in several places: a tab's label (and its icon) sit on
 * the button that reveals its panel, while the panel carries the uid; a cookie
 * banner is built into `<body>` by the design system. Those elements say which
 * block they belong to with `data-block-selector="uid#field"`.
 *
 * Everything that asks what a block is made of has to see them — the editor's
 * own field list (`getEditableFieldsByBlock`, which the admin reads to decide
 * how blocks merge and transform), the per-attribute walk every kind goes
 * through (`collectBlockFields`), and by extension block sanity. Text was
 * covered first; a picture or a link in the same place is the same question.
 */
const page = () => {
  const { window } = new JSDOM(`<!DOCTYPE html>
    <div data-block-container>
      <button data-block-selector="tab-1 tab-1#code">
        <img data-edit-media="icon" src="i.svg" alt="">
        <span data-edit-text="label">Astro</span>
        <a data-edit-link="docs" href="/docs">Docs</a>
      </button>
      <div data-block-uid="tab-1">
        <pre data-edit-text="code">console.log(1)</pre>
      </div>
      <button data-block-selector="tab-2">
        <span data-block-uid="other-1"><i data-edit-text="label">Other</i></span>
      </button>
      <div data-block-uid="tab-2"></div>
    </div>`);
  return window.document;
};

const bridgeOn = (document) =>
  Object.assign(Object.create(Bridge.prototype), {
    getAllBlockElements: (uid) => document.querySelectorAll(`[data-block-uid="${uid}"]`),
    isElementHidden: () => false,
    getBlockData: () => ({}),
    _readonlyBlocks: new Set(),
    blockPathMap: { 'tab-1': {}, 'tab-2': {} },
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

describe('fields drawn on a handle count as the block\'s — every kind', () => {
  test('the per-attribute walk finds text, media and link alike', () => {
    const document = page();
    withDocument(document, () => {
      const bridge = bridgeOn(document);
      const block = document.querySelector('[data-block-uid="tab-1"]');
      const namesFor = (attr) => {
        const found = [];
        bridge.collectBlockFields(block, attr, (el, name) => found.push(name));
        return found;
      };
      expect(namesFor('data-edit-text').sort()).toEqual(['code', 'label']);
      expect(namesFor('data-edit-media')).toEqual(['icon']);
      expect(namesFor('data-edit-link')).toEqual(['docs']);
    });
  });

  test('the editor\'s own field list carries them too', () => {
    const document = page();
    withDocument(document, () => {
      const fields = bridgeOn(document).getEditableFieldsByBlock()['tab-1'] ?? [];
      expect(fields).toEqual(
        expect.arrayContaining([
          { fieldName: 'code', type: 'slate' },
          { fieldName: 'label', type: 'slate' },
          { fieldName: 'icon', type: 'media' },
          { fieldName: 'docs', type: 'link' },
        ]),
      );
    });
  });

  test('a field that resolves to another block is not borrowed', () => {
    // The handle for tab-2 contains an element carrying its OWN uid. What is
    // inside that belongs to that block, not to the one the handle names.
    const document = page();
    withDocument(document, () => {
      const bridge = bridgeOn(document);
      const block = document.querySelector('[data-block-uid="tab-2"]');
      const found = [];
      bridge.collectBlockFields(block, 'data-edit-text', (el, name) => found.push(name));
      expect(found).toEqual([]);
    });
  });

  test('where a field is EDITED answers for any kind, not just text', () => {
    // What `revealFieldPlace` asks before deciding whether to open anything.
    const document = page();
    withDocument(document, () => {
      const bridge = bridgeOn(document);
      const block = document.querySelector('[data-block-uid="tab-1"]');
      expect(bridge.editableElementFor(block, 'label')?.tagName).toBe('SPAN');
      expect(bridge.editableElementFor(block, 'icon')?.tagName).toBe('IMG');
      expect(bridge.editableElementFor(block, 'docs')?.tagName).toBe('A');
      expect(bridge.editableElementFor(block, 'nope')).toBeNull();
    });
  });
});
