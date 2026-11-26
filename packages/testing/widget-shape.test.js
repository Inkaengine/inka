/**
 * A URL or a site path must be stored in a field whose widget gives a link
 * control. Volto's internal_url widget is one: it holds a path on the site.
 */
import { describe, test, expect } from 'vitest';
import { collectWidgetShapeIssues } from './discover-blocks.js';

const issuesFor = (widget, value) => {
  const out = [];
  const schema = { properties: { searchUrl: { title: 'Search page URL', ...(widget ? { widget } : {}) } } };
  collectWidgetShapeIssues({ '@type': 'shortcuts', searchUrl: value }, schema, '/page', 'b1', out, 'shortcuts');
  return out.flatMap((r) => r.issues);
};

describe('a path or URL value', () => {
  test('is accepted in an internal_url field', () => {
    expect(issuesFor('internal_url', '/case-studies')).toEqual([]);
  });

  test('is accepted in a url field', () => {
    expect(issuesFor('url', 'https://example.com/')).toEqual([]);
  });

  test('is reported in a plain text field', () => {
    expect(issuesFor(undefined, '/case-studies')).toEqual([
      expect.stringContaining('field "searchUrl": value looks like a URL/link'),
    ]);
  });
});

describe('an `@` key a block has no reason to carry', () => {
  // A schema can't declare an `@` field, so the only `@` keys a block may carry are its
  // identity: `@type`, `@uid`, and on a list item the key its list is keyed by. This
  // check once skipped every `@` key, and a stray `@id` sat on six NSW docs blocks.
  const undeclared = (block, pathInfo) => {
    const found = new Map();
    const schema = { properties: { title: { title: 'Title' } } };
    collectWidgetShapeIssues(block, schema, '/page', 'b1', [], 'card', found,
      { blockSchema: schema }, {}, [], pathInfo, null);
    return [...found.values()].map((f) => f.field);
  };

  test('an `@id` on a page block is reported', () => {
    expect(undeclared({ '@type': 'card', '@id': 'footer-vid-edit', title: 'T' })).toEqual(['@id']);
  });

  test('not `@id` on an item of a list keyed by it, nor `@type` or `@uid`', () => {
    expect(undeclared({ '@type': 'card', '@uid': 'b1', '@id': 'one', title: 'T' }, { idField: '@id' })).toEqual([]);
  });
});
