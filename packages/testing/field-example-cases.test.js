/**
 * Every link and media field an example sets gets drawn by the sanity suite.
 *
 * Block discovery takes a few examples per block type. A field edited on the
 * canvas (a picture, a link) that none of them sets is never drawn, so its edit
 * annotation is never seen, and the coverage reporter calls it uneditable
 * everywhere, while an example that sets it sits on a page no test opens.
 */
import { describe, test, expect } from 'vitest';
import { canvasFieldKind, canvasFieldsSet } from './canvas-fields.js';
import { fieldExampleCases } from './discover-blocks.js';

const schema = {
  properties: {
    title: { title: 'Title', type: 'string' },
    image: { widget: 'image' },
    picked: { widget: 'object_browser', mode: 'image' },
    href: { widget: 'object_browser', mode: 'link' },
    body: { widget: 'slate' },
  },
};

describe('canvasFieldKind', () => {
  test('a picture field is media, a link field is a link, anything else is neither', () => {
    expect(canvasFieldKind(schema.properties.image)).toEqual({ kind: 'media', attr: 'data-edit-media' });
    expect(canvasFieldKind(schema.properties.picked)).toEqual({ kind: 'media', attr: 'data-edit-media' });
    expect(canvasFieldKind(schema.properties.href)).toEqual({ kind: 'link', attr: 'data-edit-link' });
    expect(canvasFieldKind(schema.properties.title)).toBeNull();
    expect(canvasFieldKind(schema.properties.body)).toBeNull();
  });
});

describe('canvasFieldsSet', () => {
  test('the link and media fields a block gives a value', () => {
    expect(canvasFieldsSet(schema, { image: '/a.png', href: [{ '@id': '/x' }], title: 'T' })).toEqual(['image', 'href']);
  });

  test('an empty value is no value', () => {
    expect(canvasFieldsSet(schema, { image: '', href: [], picked: null })).toEqual([]);
  });

  test('no schema, no fields', () => {
    expect(canvasFieldsSet(null, { image: '/a.png' })).toEqual([]);
  });
});

const block = (blockId, pagePath = '/page') => ({ blockType: 'callout', variation: 'default', blockId, pagePath, blockData: { '@type': 'callout' } });

describe('fieldExampleCases', () => {
  test('a field no block case sets gets a case of its own, drawn like any other', () => {
    const fields = { a: [], b: ['image'] };
    const cases = [{ ...block('a'), kind: 'simple', isListing: false }];
    const candidates = new Map([['callout image', block('b', '/pictogram')]]);
    expect(fieldExampleCases(cases, candidates, (c) => fields[c.blockId])).toEqual([
      { ...block('b', '/pictogram'), kind: 'field:image', isListing: false },
    ]);
  });

  test('a field a block case of the same type already sets needs nothing more', () => {
    const fields = { a: ['image'], b: ['image'] };
    const cases = [{ ...block('a'), kind: 'simple', isListing: false }];
    const candidates = new Map([['callout image', block('b')]]);
    expect(fieldExampleCases(cases, candidates, (c) => fields[c.blockId])).toEqual([]);
  });

  test("another type's case setting a field of the same name doesn't count", () => {
    const fields = { a: ['image'], b: ['image'] };
    const cases = [{ ...block('a'), blockType: 'teaser', kind: 'simple', isListing: false }];
    const candidates = new Map([['callout image', block('b')]]);
    expect(fieldExampleCases(cases, candidates, (c) => fields[c.blockId])).toHaveLength(1);
  });

  test('one added example covers every field it sets', () => {
    const fields = { a: [], b: ['image', 'href'] };
    const cases = [{ ...block('a'), kind: 'simple', isListing: false }];
    const candidates = new Map([
      ['callout image', block('b')],
      ['callout href', block('b')],
    ]);
    expect(fieldExampleCases(cases, candidates, (c) => fields[c.blockId])).toEqual([
      { ...block('b'), kind: 'field:image', isListing: false },
    ]);
  });
});
