/**
 * A site's own catalog column has no declared type: the catalog fills it from
 * the object attribute of the same name. So the content types say what it
 * holds: a field of that exact name on the edited page's type, else on the
 * site's other types (a column can be filled by a few types only).
 */
import { describe, expect, test } from 'vitest';

import { columnKind, kindOfContentField } from './mappingConversions.js';

// As plone.restapi's @types/<type> serves them.
const list = { title: 'Topic', type: 'array', items: { type: 'string' } };
const date = { title: 'Start', type: 'string', widget: 'datetime' };
const text = { title: 'Note', type: 'string' };
const contentTypes = {
  Document: { properties: { title: text, Topic: list } },
  Event: { properties: { title: text, start: date, Topic: list } },
  Link: { properties: { title: text, remoteUrl: text } },
};

describe('kindOfContentField', () => {
  test.each([
    ['a list of strings', list, 'list'],
    ['a date', { type: 'string', widget: 'date' }, 'date'],
    ['a datetime', date, 'date'],
    ['a yes/no', { type: 'boolean' }, 'boolean'],
    ['a text line', text, 'text'],
    ['a choice', { type: 'string', choices: [['a', 'A']] }, 'text'],
    ['rich text', { type: 'string', widget: 'richtext' }, null],
    ['a number', { type: 'integer' }, null],
    ['an image', { type: 'object', factory: 'Image' }, null],
    ['a list of objects', { type: 'array', items: { type: 'object' } }, null],
  ])('%s', (_label, def, kind) => {
    expect(kindOfContentField(def)).toBe(kind);
  });
});

describe('columnKind', () => {
  test("a field on the edited page's type says what its column holds", () => {
    expect(columnKind('Topic', { contentTypes, pageType: 'Document' })).toEqual({ kind: 'list' });
  });

  test('a field only another type has is found there', () => {
    expect(columnKind('start', { contentTypes, pageType: 'Document' })).toEqual({ kind: 'date' });
  });

  test('a column no type has a field for (an indexer fills it) is text', () => {
    expect(columnKind('getObjSize', { contentTypes, pageType: 'Document' })).toEqual({ kind: 'text' });
  });

  test('types that hold it differently are refused, naming them', () => {
    const mixed = { ...contentTypes, Link: { properties: { Topic: text } } };
    const { kind, problem } = columnKind('Topic', { contentTypes: mixed, pageType: 'Folder' });
    expect(kind).toBeNull();
    expect(problem).toMatch(/Document.*list/);
    expect(problem).toMatch(/Link.*text/);
  });

  test("the edited page's own type decides, whatever the others hold", () => {
    const mixed = { ...contentTypes, Link: { properties: { Topic: text } } };
    expect(columnKind('Topic', { contentTypes: mixed, pageType: 'Document' })).toEqual({ kind: 'list' });
  });

  test('a field Inka has no conversion for is refused', () => {
    const { kind, problem } = columnKind('text', {
      contentTypes: { Document: { properties: { text: { type: 'string', widget: 'richtext' } } } },
      pageType: 'Document',
    });
    expect(kind).toBeNull();
    expect(problem).toMatch(/text/);
  });

  test('without the content types there is no telling, and it says so', () => {
    expect(() => columnKind('Topic', { pageType: 'Document' })).toThrow(/content types/);
  });
});
