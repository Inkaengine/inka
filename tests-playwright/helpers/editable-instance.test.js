/**
 * Which template blocks are subjects for the sanity checks: on its own definition a
 * readOnly block is what the author edits (after unlocking); a readOnly copy on an
 * ordinary page is not. A definition need not name itself — its blocks hold slots and
 * no templateId — and is still its own definition.
 */
import { describe, test, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { editableInstance } = require('./discover-blocks.cjs');

const footer = (label) => ({
  '@type': 'footer', fixed: true, readOnly: true, slotId: 'footer0',
  ...(label ? { templateId: label } : {}),
});
const definitionDoc = (label) => ({
  '@id': '/templates/site-footer',
  UID: 'footer-template-uid',
  blocks: { footer0: footer(label) },
  blocks_layout: { items: ['footer0'] },
});

describe('editableInstance on a template definition', () => {
  test('a labelled definition: its readOnly block is a subject that needs unlocking', () => {
    const doc = definitionDoc('/templates/site-footer');
    expect(editableInstance(doc, doc.blocks.footer0)).toEqual({ needsUnlock: true });
  });

  test('an unlabelled definition: the same', () => {
    const doc = definitionDoc(undefined);
    expect(editableInstance(doc, doc.blocks.footer0)).toEqual({ needsUnlock: true });
  });

  test('a readOnly copy on an ordinary page is not a subject', () => {
    const page = {
      '@id': '/a-page',
      blocks: { f: footer('/templates/site-footer'), p: { '@type': 'slate' } },
      blocks_layout: { items: ['f', 'p'] },
    };
    expect(editableInstance(page, page.blocks.f)).toBeNull();
  });
});
