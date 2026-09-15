import { describe, it, expect } from 'vitest';
import { normalizeSlateValue } from './slate-normalize.mjs';

const strong = (t) => ({ type: 'strong', children: [{ text: t }] });
const em = (t) => ({ type: 'em', children: [{ text: t }] });
const p = (...children) => ({ type: 'p', children });
const h = (n, t) => ({ type: `h${n}`, children: [{ text: t }] });

describe('normalizeSlateValue', () => {
  it('leaves a valid single-node value untouched', () => {
    const v = [p({ text: 'hello world' })];
    expect(normalizeSlateValue(v)).toEqual(v);
  });

  it('merges [h2, p] into one p with the heading as a bold lead', () => {
    // grid/text + typography grid cells
    const v = [h(2, 'Text Title H2'), p({ text: 'Lorem ipsum.' })];
    expect(normalizeSlateValue(v)).toEqual([
      p(strong('Text Title H2'), { text: ' Lorem ipsum.' }),
    ]);
  });

  it('merges [p(strong), p] without double-wrapping the already-bold lead', () => {
    // homepage feature boxes
    const v = [p(strong('Visual Editing')), p({ text: 'True WYSIWYG editing.' })];
    expect(normalizeSlateValue(v)).toEqual([
      p(strong('Visual Editing'), { text: ' True WYSIWYG editing.' }),
    ]);
  });

  it('merges [h2, h3, p(rich)] preserving inline marks and links', () => {
    // slateTable cell
    const link = { type: 'link', data: { url: '/' }, children: [{ text: 'Link' }] };
    const v = [
      h(2, 'Heading H3'),
      h(3, 'Heading H2'),
      p({ text: 'Text can be ' }, strong('bold'), { text: ' or ' }, em('italic'), { text: ' or a ' }, link, { text: ' ' }),
    ];
    expect(normalizeSlateValue(v)).toEqual([
      p(
        strong('Heading H3'),
        { text: ' ' },
        strong('Heading H2'),
        { text: ' Text can be ' },
        strong('bold'),
        { text: ' or ' },
        em('italic'),
        { text: ' or a ' },
        link,
      ),
    ]);
  });

  it('inlines a merged list [p, ul] as space-separated items', () => {
    const v = [
      p({ text: 'Intro' }),
      { type: 'ul', children: [
        { type: 'li', children: [{ text: 'one' }] },
        { type: 'li', children: [{ text: 'two' }] },
      ] },
    ];
    expect(normalizeSlateValue(v)).toEqual([p({ text: 'Intro one two' })]);
  });

  it('replaces newlines in text leaves with a single space (single node stays one node)', () => {
    // d78b666f — one p, but text leaves carry hard newlines
    const v = [p(
      { text: 'You can ' }, strong('log in'), { text: ' using these credentials:\n\nusername: ' }, strong('admin'), { text: '\npassword: ' }, strong('admin'),
    )];
    expect(normalizeSlateValue(v)).toEqual([p(
      { text: 'You can ' }, strong('log in'), { text: ' using these credentials: username: ' }, strong('admin'), { text: ' password: ' }, strong('admin'),
    )]);
  });

  it('drops an empty trailing node instead of leaving a hollow bold wrapper', () => {
    // grid/text had [h2, p, h2("")] — the empty heading must not survive as strong("")
    const v = [h(2, 'Title'), p({ text: 'Body.' }), h(2, '')];
    expect(normalizeSlateValue(v)).toEqual([p(strong('Title'), { text: ' Body.' })]);
  });

  it('is idempotent', () => {
    const v = [h(2, 'Title'), p({ text: 'Body.' })];
    const once = normalizeSlateValue(v);
    expect(normalizeSlateValue(once)).toEqual(once);
  });
});
