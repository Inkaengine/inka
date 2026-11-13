/**
 * Which result fields can be mapped onto which block fields, and with which
 * conversion: one rule for the mapping widget (what it offers, what it
 * stores), the load check and the content check. A mapping the rule refuses
 * would make items the editor can't hold: a list in a text field, an image
 * object in a title, a date wrapped as a link.
 */
import { describe, expect, test } from 'vitest';

import { conversionFor, isAccepted, sourceKind, targetKind, widgetToTargetType } from './mappingConversions.js';

const f = {
  text: { title: 'T', type: 'string' },
  textarea: { title: 'T', type: 'string', widget: 'textarea' },
  slate: { title: 'T', type: 'array', widget: 'slate' },
  link: { title: 'T', widget: 'object_browser', mode: 'link' },
  url: { title: 'T', widget: 'url' },
  imageLink: { title: 'T', widget: 'object_browser', mode: 'image' },
  image: { title: 'T', widget: 'image' },
  date: { title: 'T', type: 'string', widget: 'date' },
  list: { title: 'T', type: 'array' },
  bool: { title: 'T', type: 'boolean' },
  choice: { title: 'T', type: 'string', choices: [['a', 'A']] },
  region: { title: 'T', widget: 'object_list', idField: 'key' },
};

describe('sourceKind', () => {
  test.each([
    ['getURL', { type: 'string' }, 'address'],
    ['title', { type: 'string' }, 'text'],
    ['image', { type: 'image' }, 'image'],
    ['created', { type: 'date' }, 'date'],
    ['Subject', { type: 'array' }, 'list'],
    ['hasPreviewImage', { type: 'boolean' }, 'boolean'],
  ])('%s', (source, def, kind) => expect(sourceKind(source, def)).toBe(kind));

  test('a source of a type Inka has no conversion for throws, naming it', () => {
    expect(() => sourceKind('size', { type: 'number' })).toThrow(/size.*number/);
  });
});

describe('targetKind', () => {
  test.each([
    ['text', 'string'],
    ['textarea', 'textarea'],
    ['slate', 'slate'],
    ['link', 'link'],
    ['url', 'link'],
    ['imageLink', 'image_link'],
    ['image', 'image'],
    ['date', 'date'],
    ['list', 'list'],
    ['bool', 'boolean'],
  ])('%s', (field, kind) => expect(targetKind(f[field])).toBe(kind));

  test("Volto's list widgets hold a list", () => {
    expect(targetKind({ title: 'T', widget: 'array' })).toBe('list');
    expect(targetKind({ title: 'T', widget: 'token' })).toBe('list');
  });

  test('a field copy-from-target wraps is the field it wraps', () => {
    expect(targetKind({ title: 'T', widget: 'copyFromTargetField', baseWidget: f.textarea })).toBe('textarea');
  });

  test('a choice or a region is no target', () => {
    expect(targetKind(f.choice)).toBeNull();
    expect(targetKind(f.region)).toBeNull();
  });
});

// The conversion a field takes is derived from its widget (the one derivation
// converting a block and pulling from a linked page use too). A source kind
// that needs another (a list into text: joined) gets that instead.
describe('widgetToTargetType', () => {
  test.each([
    ['link', 'link'],
    ['url', 'link'],
    ['imageLink', 'image_link'],
    ['image', 'image'],
    ['slate', 'slate'],
    ['textarea', 'textarea'],
    ['text', null],
    ['date', null],
  ])('%s → %s', (field, type) => expect(widgetToTargetType(f[field].widget, f[field])).toBe(type));
});

// Every stored entry carries its conversion: the listing renderer has no
// schema, so a stored entry with none is refused, not guessed at.
describe('conversionFor: the conversion the widget offers with and stores', () => {
  test.each([
    ['address', 'link', 'link'],
    ['address', 'url', 'link'],
    ['address', 'text', 'string'],
    ['address', 'textarea', 'textarea'],
    ['text', 'text', 'string'],
    ['text', 'textarea', 'textarea'],
    ['text', 'slate', 'slate'],
    ['image', 'imageLink', 'image_link'],
    ['image', 'image', 'image_link'],
    ['image', 'url', 'image_link'],
    ['date', 'date', 'string'],
    ['date', 'text', 'string'],
    ['list', 'list', 'array'],
    ['list', 'text', 'string'],
    ['list', 'textarea', 'textarea'],
    ['boolean', 'bool', 'boolean'],
  ])('%s onto a %s field', (kind, field, expected) => {
    expect(conversionFor(kind, f[field])).toBe(expected);
  });

  test.each([
    ['text', 'link'],
    ['text', 'image'],
    ['text', 'list'],
    ['image', 'text'],
    ['date', 'link'],
    ['list', 'link'],
    ['boolean', 'text'],
    ['address', 'image'],
    ['text', 'choice'],
  ])('%s onto a %s field: not offered', (kind, field) => {
    expect(conversionFor(kind, f[field])).toBeUndefined();
  });

  // An image keeps its scales: `image` would reduce the result's image object
  // to its `@id`, the page's address.
  test('an image is never converted as image, nor as a plain link', () => {
    expect(isAccepted('image', f.image, 'image')).toBe(false);
    expect(isAccepted('image', f.url, 'link')).toBe(false);
  });

  test('no conversion is no answer', () => {
    expect(isAccepted('text', f.text, null)).toBe(false);
    expect(isAccepted('text', f.text, undefined)).toBe(false);
  });
});
