/**
 * Block formats declared as DATA (`settings.slate.blockFormats`).
 *
 * The format dropdown named its entries and drew their icons from volto-slate's
 * button components — "Title", "Subtitle", "Heading 4" — and a format with no
 * component (h5, h6) could not be offered at all. A frontend's config reaches
 * the admin as data over postMessage, so it could choose WHICH formats a region
 * allows (`allowedStyles`) but never what they are called.
 *
 * Each entry is { type, label, icon? }. The icon is data too — { viewBox,
 * paths: ['M…'] } — drawn by the admin, never markup from the frontend.
 */
import { describe, test, expect } from 'vitest';

import { createEditor, Transforms } from 'slate';

import {
  applyParagraphStyle,
  blockFormatButtons,
  clearParagraphStyles,
  paragraphStyleItems,
} from './blockFormats.js';

const H = { viewBox: '0 0 24 24', paths: ['M5 4v16h2v-7h6v7h2V4h-2v7H7V4z'] };
const formats = [
  { type: 'h2', label: 'Heading 2', icon: H },
  { type: 'h3', label: 'Heading 3', icon: H },
  { type: 'blockquote', label: 'Quote' },
];
const headline = ['strong', 'em'];

describe('blockFormatButtons', () => {
  test('one entry per declared format, in the declared order, with its label', () => {
    const buttons = blockFormatButtons(formats, {
      slateRules: null,
      allowedHeadlineElements: headline,
    });
    expect(buttons.map((b) => [b.name, b.format, b.title])).toEqual([
      ['format-h2', 'h2', 'Heading 2'],
      ['format-h3', 'h3', 'Heading 3'],
      ['format-blockquote', 'blockquote', 'Quote'],
    ]);
  });

  test('a format the region does not allow is not offered', () => {
    const slateRules = { allowedStyles: ['p', 'h2'], disallowedStyles: [] };
    const buttons = blockFormatButtons(formats, {
      slateRules,
      allowedHeadlineElements: headline,
    });
    expect(buttons.map((b) => b.format)).toEqual(['h2']);
  });

  test('the icon is drawn from data, in the shape the admin icon component takes', () => {
    const [h2] = blockFormatButtons(formats, {
      slateRules: null,
      allowedHeadlineElements: headline,
    });
    expect(h2.icon.attributes).toEqual({
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: '0 0 24 24',
    });
    expect(h2.icon.content).toBe('<path d="M5 4v16h2v-7h6v7h2V4h-2v7H7V4z"/>');
  });

  test('icon data cannot carry markup', () => {
    const evil = [
      {
        type: 'h2',
        label: 'x',
        icon: {
          viewBox: '0 0 1 1',
          paths: ['M0 0"/><script>alert(1)</script><path d="'],
        },
      },
    ];
    const [btn] = blockFormatButtons(evil, {
      slateRules: null,
      allowedHeadlineElements: headline,
    });
    expect(btn.icon.content).not.toContain('<script');
    expect(btn.icon.content).toContain('&lt;script&gt;');
  });

  test('a heading keeps to the headline children; other formats are unrestricted', () => {
    const [h2, , quote] = blockFormatButtons(formats, {
      slateRules: null,
      allowedHeadlineElements: headline,
    });
    expect(h2.allowedChildren).toEqual(headline);
    expect(quote.allowedChildren).toBeUndefined();
  });

  test('no icon is allowed; a malformed entry fails loudly', () => {
    const [quote] = blockFormatButtons(
      [{ type: 'blockquote', label: 'Quote' }],
      { slateRules: null },
    );
    expect(quote.icon).toBeUndefined();
    expect(() =>
      blockFormatButtons([{ label: 'No type' }], { slateRules: null }),
    ).toThrow(/type/);
    expect(() =>
      blockFormatButtons([{ type: 'h2' }], { slateRules: null }),
    ).toThrow(/label/);
    expect(() =>
      blockFormatButtons(
        [{ type: 'h2', label: 'H', icon: { viewBox: '0 0 1 1' } }],
        { slateRules: null },
      ),
    ).toThrow(/paths/);
  });
});

// ── paragraph styles in the format dropdown ─────────────────────────────────
//
// A paragraph style ("Lead") is a KIND of paragraph, chosen the way a heading
// is: one per block, applied to the block the cursor is in. It sits in the
// format dropdown beside the headings; the style menu keeps text (inline)
// styles only. Stored as before: the block's `styleName`.

const styleMenu = {
  blockStyles: [
    { cssClass: 'lead', label: 'Lead', icon: H },
    { cssClass: 'aside', label: 'Aside', type: 'div' },
  ],
  inlineStyles: [{ cssClass: 'dropcap', label: 'Drop cap' }],
};

const editorWith = (nodes) => {
  const editor = createEditor();
  editor.children = nodes;
  Transforms.select(editor, { path: [0, 0], offset: 0 });
  return editor;
};

describe('paragraphStyleItems', () => {
  test('the paragraph styles, as dropdown entries: label, icon, the type they make', () => {
    const items = paragraphStyleItems(styleMenu, { slateRules: null });
    expect(items.map((i) => [i.name, i.cssClass, i.type, i.title])).toEqual([
      ['style-lead', 'lead', 'p', 'Lead'],
      ['style-aside', 'aside', 'div', 'Aside'],
    ]);
    expect(items[0].icon.content).toContain('<path d=');
    expect(items[1].icon).toBeUndefined();
  });

  test('a style the region does not allow is not offered; inline styles never are', () => {
    const slateRules = { allowedStyles: null, disallowedStyles: ['.aside'] };
    expect(
      paragraphStyleItems(styleMenu, { slateRules }).map((i) => i.cssClass),
    ).toEqual(['lead']);
  });

  test('no paragraph styles declared, no entries', () => {
    expect(paragraphStyleItems({}, { slateRules: null })).toEqual([]);
  });
});

describe('applyParagraphStyle', () => {
  const all = ['lead', 'aside'];

  test('makes the block at the cursor that type, with that style — no text selection needed', () => {
    const editor = editorWith([{ type: 'h2', children: [{ text: 'Hello' }] }]);
    applyParagraphStyle(editor, { cssClass: 'lead', type: 'p' }, all);
    expect(editor.children).toEqual([
      { type: 'p', styleName: 'lead', children: [{ text: 'Hello' }] },
    ]);
  });

  test('replaces another paragraph style, and keeps any style that is not one', () => {
    const editor = editorWith([
      { type: 'p', styleName: 'aside custom', children: [{ text: 'x' }] },
    ]);
    applyParagraphStyle(editor, { cssClass: 'lead', type: 'p' }, all);
    expect(editor.children[0].styleName).toBe('custom lead');
  });

  test('choosing a heading or Paragraph clears the paragraph style', () => {
    const editor = editorWith([
      { type: 'p', styleName: 'lead', children: [{ text: 'x' }] },
    ]);
    clearParagraphStyles(editor, all);
    expect(editor.children[0]).toEqual({
      type: 'p',
      children: [{ text: 'x' }],
    });
  });
});
