/**
 * A link the CMS can't store refuses the save in the editor, naming the field,
 * instead of reaching the server.
 *
 * Plone's block deserializer (plone.restapi `ResolveUIDDeserializerBase`)
 * walks every object in every block and turns each truthy `@id` into a uid
 * with `path2uid`, which calls `.startswith` on it. An `@id` that is anything
 * but a string ends the whole save with a 500 (`'dict' object has no attribute
 * 'startswith'`), and the author is shown that message with no idea which
 * block holds it. The same holds for a `{ '@type': 'URL', value }` whose value
 * isn't a string.
 */
import { describe, expect, test } from 'vitest';

import { badItemIdFields, unstorableLinkFields } from './blockFieldErrors.js';

describe('unstorableLinkFields', () => {
  test('a link whose @id is an object is unstorable', () => {
    const card = {
      '@type': 'card',
      title: 'Hubs',
      url: [{ '@id': { '@id': '/events/hub', title: 'Hub' } }],
    };
    expect(unstorableLinkFields(card)).toEqual(['url']);
  });

  test('a link whose @id is a list is unstorable', () => {
    expect(unstorableLinkFields({ href: [{ '@id': [{ '@id': '/x' }] }] })).toEqual(['href']);
  });

  test("a URL value that isn't a string is unstorable", () => {
    expect(unstorableLinkFields({ target: { '@type': 'URL', value: { '@id': '/x' } } })).toEqual(['target']);
  });

  test('links the CMS stores are fine: internal, external, empty, with metadata', () => {
    const block = {
      url: [{ '@id': '/events/hub', title: 'Hub', Subject: [], image_field: '' }],
      href: [{ '@id': 'https://example.com/' }],
      preview_image: [],
      cleared: '',
      empty: [{ '@id': '' }],
      target: { '@type': 'URL', value: '/x' },
    };
    expect(unstorableLinkFields(block)).toEqual([]);
  });

  test('found inside an object field, named by the top-level field', () => {
    expect(unstorableLinkFields({ data: { link: [{ '@id': { '@id': '/x' } }] } })).toEqual(['data']);
  });

  test("a child block's bad link is the child's, not its container's", () => {
    const grid = {
      '@type': 'grid',
      blocks: { c1: { '@type': 'card', url: [{ '@id': { '@id': '/x' } }] } },
      blocks_layout: { items: ['c1'] },
    };
    expect(unstorableLinkFields(grid)).toEqual([]);
  });

  test("an object_list child's bad link is the child's, not its container's", () => {
    const list = {
      '@type': 'slider',
      slides: [{ '@id': 's1', href: [{ '@id': { '@id': '/x' } }] }],
    };
    const childFields = [{ isObjectList: true, region: 'slides', idField: '@id' }];
    expect(unstorableLinkFields(list, childFields)).toEqual([]);
    // Without being told it's a region, the list is just a field holding the bad link.
    expect(unstorableLinkFields(list)).toEqual(['slides']);
  });

  // An object_list keyed by `@id` (idField) stores each item's id there, and
  // Plone walks it like any other `@id`. An id that isn't a string (an object
  // spread over it) crashes the save just the same, so the item reports it.
  test("an item whose own @id (its idField) isn't a string is unstorable", () => {
    const item = { '@id': { '@id': 'https://example.com/' }, url: [{ '@id': 'https://example.com/' }] };
    expect(unstorableLinkFields(item)).toEqual(['@id']);
  });

  test("an item's string id is fine", () => {
    expect(unstorableLinkFields({ '@id': 'social-linkedin', url: [{ '@id': 'https://example.com/' }] })).toEqual([]);
  });
});

/**
 * An object_list item is found, moved and merged by its id (the list's
 * idField), so the id must be a string, whatever the idField is called. An
 * item whose id isn't one can't be found by it, so it can't be checked or
 * opened as a block of its own: its container reports the list.
 */
describe('badItemIdFields', () => {
  const footer = (items) => ({ '@type': 'footer', social: items });
  const social = [{ isObjectList: true, region: 'social', idField: '@id' }];

  test("a list keyed by @id with an item whose id isn't a string", () => {
    expect(badItemIdFields(footer([
      { '@id': 'social-linkedin', url: [] },
      { '@id': { '@id': 'https://example.com/' }, url: [] },
    ]), social)).toEqual(['social']);
  });

  test.each([
    ['field_id', { field_id: { id: 'f1' } }],
    ['key', { key: 7 }],
    ['key', { key: ['k1'] }],
  ])("a list keyed by %s with an item whose id isn't a string", (idField, item) => {
    const block = { '@type': 'b', items: [item] };
    expect(badItemIdFields(block, [{ isObjectList: true, region: 'items', idField }])).toEqual(['items']);
  });

  test('inside an object field, named by the top-level field', () => {
    const table = { '@type': 'table', table: { rows: [{ key: { k: 1 } }] } };
    const fields = [{ isObjectList: true, region: 'rows', regionPath: ['table'], idField: 'key' }];
    expect(badItemIdFields(table, fields)).toEqual(['table']);
  });

  test('string ids are fine, whatever the idField', () => {
    const block = { '@type': 'b', social: [{ '@id': 's1' }], subblocks: [{ field_id: 'f1' }] };
    expect(badItemIdFields(block, [
      { isObjectList: true, region: 'social', idField: '@id' },
      { isObjectList: true, region: 'subblocks', idField: 'field_id' },
    ])).toEqual([]);
  });
});
