/**
 * The source fields a listing can map onto its item blocks.
 *
 * `QUERY_RESULT_FIELDS` is what the field-mapping widget offers as sources, so a
 * result field missing from it cannot be mapped by an author at all — the mapping
 * exists only if a block's recipe declares it, and then it can be neither changed
 * nor recreated. Categories were in exactly that position: every Plone result
 * carries `Subject` (the keyword index behind tags/topics), the design system's
 * list item renders them as pills, and no author could wire the two together.
 */
import { describe, test, expect, vi } from 'vitest';

// The context module is JSX in a .js file, which the test transform cannot
// parse; the sibling blockPath tests stub it the same way.
vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
}));

import { QUERY_RESULT_FIELDS, computeSmartDefaults } from './blockSync';

describe('QUERY_RESULT_FIELDS', () => {
  test("offers the result's categories as a mappable source", () => {
    expect(QUERY_RESULT_FIELDS.Subject).toBeDefined();
    // A keyword index holds a LIST — one pill per category. Typed as `array` so
    // a lone value is still carried as a list rather than joined into a string
    // (the `string` conversion turns ['a','b'] into "a, b", which a pill
    // renderer then shows as nothing).
    expect(QUERY_RESULT_FIELDS.Subject.type).toBe('array');
    expect(QUERY_RESULT_FIELDS.Subject.title).toBeTruthy();
  });

  test('a declared categories mapping survives when the target field exists', () => {
    const target = {
      properties: {
        title: { title: 'Title' },
        tags: { title: 'Categories', type: 'array', items: { type: 'string' } },
      },
    };
    const mapping = computeSmartDefaults(
      QUERY_RESULT_FIELDS,
      target,
      { '@default': { Subject: { field: 'tags', type: 'array' } } },
    );
    expect(mapping.Subject).toBeTruthy();
    const field = typeof mapping.Subject === 'string' ? mapping.Subject : mapping.Subject.field;
    expect(field).toBe('tags');
  });
});

describe('computeSmartDefaults keeps the conversion a list needs', () => {
  const target = {
    properties: {
      title: { title: 'Title' },
      tags: { title: 'Categories', type: 'array', items: { type: 'string' } },
      url: { title: 'Link', widget: 'object_browser', mode: 'link' },
    },
  };

  test('a declared list conversion is not thrown away', () => {
    // The widget normalises a block's declared mappings. It kept `{field, type}`
    // for link and image only, so `type: 'array'` was silently dropped — and a
    // keyword index that returns ONE value then arrives as a bare string, which
    // a pill renderer skips.
    const mapping = computeSmartDefaults(QUERY_RESULT_FIELDS, target, {
      '@default': { Subject: { field: 'tags', type: 'array' } },
    });
    expect(mapping.Subject).toEqual({ field: 'tags', type: 'array' });
  });

  test('a bare mapping onto a list field gains the list conversion', () => {
    const mapping = computeSmartDefaults(QUERY_RESULT_FIELDS, target, {
      '@default': { Subject: 'tags' },
    });
    expect(mapping.Subject).toEqual({ field: 'tags', type: 'array' });
  });

  test('a link target still gets its conversion, and a plain field stays bare', () => {
    const mapping = computeSmartDefaults(QUERY_RESULT_FIELDS, target, {
      '@default': { '@id': 'url', title: 'title' },
    });
    expect(mapping['@id']).toEqual({ field: 'url', type: 'link' });
    expect(mapping.title).toBe('title');
  });
});
