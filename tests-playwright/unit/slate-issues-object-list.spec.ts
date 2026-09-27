import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { collectSlateIssues } = require('../helpers/discover-blocks.cjs');

/**
 * Which fields block-sanity checks as slate values.
 *
 * Without a schema it has to guess from the data: an array whose first item has
 * `children` or `text`. An object_list's items are records, and a record can
 * have a `text` field of its own (a link's text), so where the schema says a
 * field is an object_list it is not a slate value, whatever its items hold.
 */
test.describe('slate issues: object_list fields are not slate values', () => {
  const actions = [
    { key: 'a1', text: 'Edit', url: [{ '@id': '#' }] },
    { key: 'a2', text: 'Delete', url: [{ '@id': '#' }] },
  ];

  test('an object_list whose items have a text field is not checked as slate', () => {
    const out: unknown[] = [];
    collectSlateIssues({ '@type': 'row', actions }, '/p', 'b1', out, 'row', false, new Set(['actions']));
    expect(out).toEqual([]);
  });

  test('without the schema, the same data still looks like slate', () => {
    const out: Array<{ field: string }> = [];
    collectSlateIssues({ '@type': 'row', actions }, '/p', 'b1', out, 'row');
    expect(out.map((o) => o.field)).toEqual(['actions']);
  });

  test('a real slate field beside the object_list is still checked', () => {
    const out: Array<{ field: string; issues: string[] }> = [];
    const value = [{ text: 'a bare leaf' }];
    collectSlateIssues({ '@type': 'row', actions, value }, '/p', 'b1', out, 'row', false, new Set(['actions']));
    expect(out.map((o) => o.field)).toEqual(['value']);
    expect(out[0].issues).toContain('value[0]: text leaf at root (must be wrapped in an element)');
  });
});
