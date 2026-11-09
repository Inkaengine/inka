/**
 * A URL or a site path must be stored in a field whose widget gives a link
 * control. Volto's internal_url widget is one: it holds a path on the site.
 */
import { describe, test, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { collectWidgetShapeIssues } = require('./discover-blocks.cjs');

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
