/**
 * How long a field's text is, for a rule that says so:
 *
 *   <field>@chars — its text's length in characters
 *   <field>@words — its text's length in words
 *
 * Both are number surfaces. A text, textarea or slate field counts its own
 * text; a region counts the text of everything in it, at any depth, by the
 * same reading of "a block's text" that search uses.
 */
import { evaluateWhenCondition } from './fieldRules.js';
import { buildBlockPathMap } from './buildBlockPathMap.js';

const para = (text) => ({ '@type': 'slate', value: [{ type: 'p', children: [{ text }] }] });

const blocksConfig = {
  _page: {
    id: '_page',
    schema: () => ({ properties: { items: { widget: 'blocks_layout' } } }),
  },
  slate: {
    id: 'slate',
    blockSchema: { properties: { value: { widget: 'slate' } } },
  },
  image: {
    id: 'image',
    blockSchema: { properties: { url: { widget: 'url' }, alt: { type: 'string' } } },
  },
  group: {
    id: 'group',
    blockSchema: { properties: { items: { widget: 'blocks_layout' } } },
  },
  banner: {
    id: 'banner',
    blockSchema: {
      properties: {
        heading: { type: 'string' },
        intro: { type: 'string', widget: 'textarea' },
        body: { widget: 'slate' },
        anchor: { type: 'string', widget: 'url' },
        lead: { widget: 'blocks_layout' },
        links: {
          widget: 'object_list',
          schema: { properties: { label: { type: 'string' }, href: { widget: 'url' } } },
        },
      },
    },
  },
};

const page = {
  '@type': 'Document',
  blocks: {
    b: {
      '@type': 'banner',
      heading: 'Four',
      intro: 'One two\n\nthree',
      body: [
        { type: 'p', children: [{ text: 'Bold' }, { type: 'strong', children: [{ text: 'ly' }] }] },
        { type: 'p', children: [{ text: 'on' }] },
      ],
      anchor: 'somewhere-long',
      blocks: {
        p1: para('First paragraph'),
        g: {
          '@type': 'group',
          blocks: { p2: para('deep'), img: { '@type': 'image', url: '/a-long-url.png', alt: 'A cat' } },
          blocks_layout: { items: ['p2', 'img'] },
        },
      },
      blocks_layout: { lead: ['p1', 'g'] },
      links: [{ '@id': 'l1', label: 'Go there', href: '/x' }],
    },
    empty: { '@type': 'banner', heading: '', blocks: {}, blocks_layout: { lead: [] } },
  },
  blocks_layout: { items: ['b', 'empty'] },
};

const blockPathMap = buildBlockPathMap(page, blocksConfig, {});
const holds = (blockId, when, extra = {}) =>
  evaluateWhenCondition(when, page.blocks[blockId], {
    blockId,
    blockPathMap,
    pageFormData: page,
    schema: blocksConfig.banner.blockSchema,
    ...extra,
  });

describe('<field>@chars and <field>@words on a field', () => {
  test('a text field counts its own text', () => {
    expect(holds('b', { 'heading@chars': { is: 4 } })).toBe(true);
    expect(holds('b', { 'heading@words': { is: 1 } })).toBe(true);
  });

  test('a textarea counts its text whole, line breaks and all', () => {
    // "One two\n\nthree": 14 characters, three words.
    expect(holds('b', { 'intro@chars': { is: 14 } })).toBe(true);
    expect(holds('b', { 'intro@words': { is: 3 } })).toBe(true);
  });

  test('a slate field counts its prose: inline marks run on, paragraphs are separate words', () => {
    // "Boldly on": a bold syllable stays in its word.
    expect(holds('b', { 'body@chars': { is: 9 } })).toBe(true);
    expect(holds('b', { 'body@words': { is: 2 } })).toBe(true);
  });

  test('an empty field is nought, not unset', () => {
    expect(holds('empty', { 'heading@chars': { is: 0 } })).toBe(true);
    expect(holds('empty', { 'intro@words': { lt: 1 } })).toBe(true);
  });

  test('compares like any number', () => {
    expect(holds('b', { 'intro@chars': { gt: 13, lte: 14 } })).toBe(true);
    expect(holds('b', { 'intro@chars': { gt: 14 } })).toBe(false);
  });
});

describe('<field>@chars and <field>@words on a region', () => {
  test('a region counts the text of everything in it, at any depth', () => {
    // "First paragraph", then the group's "deep" and its image's "A cat"; the
    // image's url is not text.
    expect(holds('b', { 'lead@words': { is: 5 } })).toBe(true);
    expect(holds('b', { 'lead@chars': { is: 'First paragraph deep A cat'.length } })).toBe(true);
  });

  test('an object_list counts its items\' text', () => {
    expect(holds('b', { 'links@words': { is: 2 } })).toBe(true);
  });

  test('an empty region is nought', () => {
    expect(holds('empty', { 'lead@chars': { is: 0 } })).toBe(true);
  });

  test('a region without the path map is unknown: no comparison holds', () => {
    expect(holds('b', { 'lead@chars': { gte: 0 } }, { blockPathMap: undefined })).toBe(false);
  });
});

test('a length is a number: a string operator on it throws', () => {
  expect(() => holds('b', { 'heading@chars': { contains: '4' } })).toThrow(/not valid for a number/);
});
