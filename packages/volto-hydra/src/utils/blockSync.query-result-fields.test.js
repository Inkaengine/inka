/**
 * The source fields a listing can map onto its item blocks.
 *
 * A frontend declares what a result offers (`sourceFields` on its mapping
 * widget); the item type's declared mappings are proposed against that.
 */
import { describe, test, expect, vi } from 'vitest';

// The context module is JSX in a .js file, which the test transform cannot
// parse; the sibling blockPath tests stub it the same way.
vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
}));

import { computeSmartDefaults } from './blockSync';

// What a listing's mapping widget offers as sources: the frontend declares them
// (`sourceFields`), as the fields its fetcher returns.
const SOURCES = {
  getURL: { title: 'URL', type: 'string' },
  title: { title: 'Title', type: 'string' },
  Subject: { title: 'Categories', type: 'array' },
};

test('a declared categories mapping survives when the target field exists', () => {
  const target = {
    properties: {
      title: { title: 'Title' },
      tags: { title: 'Categories', type: 'array', items: { type: 'string' } },
    },
  };
  const mapping = computeSmartDefaults(SOURCES, target, {
    '@default': { Subject: { field: 'tags', type: 'array' } },
  });
  expect(mapping.Subject).toEqual({ field: 'tags', type: 'array' });
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
    const mapping = computeSmartDefaults(SOURCES, target, {
      '@default': { Subject: { field: 'tags', type: 'array' } },
    });
    expect(mapping.Subject).toEqual({ field: 'tags', type: 'array' });
  });

  test('a bare mapping onto a list field gains the list conversion', () => {
    const mapping = computeSmartDefaults(SOURCES, target, {
      '@default': { Subject: 'tags' },
    });
    expect(mapping.Subject).toEqual({ field: 'tags', type: 'array' });
  });

  // Proposed as the widget stores it: every entry with its conversion, which
  // the listing renderer, having no schema, converts by.
  test('every entry carries the conversion its field needs', () => {
    const mapping = computeSmartDefaults(SOURCES, target, {
      '@default': { getURL: 'url', title: 'title' },
    });
    expect(mapping.getURL).toEqual({ field: 'url', type: 'link' });
    expect(mapping.title).toEqual({ field: 'title', type: 'string' });
  });

  // A feed offers fewer sources than a catalog listing (an RSS entry has no
  // lead image): an entry for one it doesn't offer would be stored, and refused.
  test("a declared entry for a source the mapping doesn't offer isn't proposed", () => {
    const mapping = computeSmartDefaults(
      { getURL: SOURCES.getURL, title: SOURCES.title },
      target,
      { '@default': { getURL: 'url', title: 'title', Subject: 'tags' } },
    );
    expect(Object.keys(mapping)).toEqual(['getURL', 'title']);
  });

  test("a declared entry the source can't become isn't proposed", () => {
    const mapping = computeSmartDefaults(SOURCES, target, {
      '@default': { Subject: 'url', title: 'title' },
    });
    expect(mapping).not.toHaveProperty('Subject');
  });
});
