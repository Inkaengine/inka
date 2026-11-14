import { hasSearchKeyword, keepsChosenSort, searchSort } from './index.js';

// How a search block sorts (plone/volto#4000): a keyword is ranked by
// relevance unless the reader chose a sort; with no keyword the listing's own
// sort applies. A sort the reader chose is dropped when the keyword starts or
// ends, and kept while one keyword changes to another.

describe('hasSearchKeyword', () => {
  test('a word is a keyword', () => {
    expect(hasSearchKeyword('dog')).toBe(true);
    expect(hasSearchKeyword('  2024 ')).toBe(true);
  });
  test('nothing, spaces or punctuation alone is none', () => {
    // Plone's text index can't read a term with no letter or digit.
    for (const text of [undefined, null, '', '   ', '"', '() *']) {
      expect(hasSearchKeyword(text)).toBe(false);
    }
  });
});

describe('keepsChosenSort', () => {
  test('a keyword typed where there was none drops it', () => {
    expect(keepsChosenSort('', 'dog')).toBe(false);
  });
  test('the keyword cleared drops it', () => {
    expect(keepsChosenSort('dog', '')).toBe(false);
  });
  test('one keyword changed to another keeps it', () => {
    expect(keepsChosenSort('dog', 'cat')).toBe(true);
  });
  test('no keyword either side keeps it', () => {
    expect(keepsChosenSort('', undefined)).toBe(true);
  });
});

describe('searchSort', () => {
  test('a chosen sort is used, keyword or not', () => {
    expect(searchSort('dog', 'sortable_title', 'ascending')).toEqual({
      sort_on: 'sortable_title',
      sort_order: 'ascending',
    });
    expect(searchSort('', 'effective')).toEqual({ sort_on: 'effective' });
  });
  test('a keyword with no sort chosen asks for relevance', () => {
    expect(searchSort('dog', '')).toEqual({ sort_on: null });
  });
  test('no keyword and no sort chosen leaves the listing its own', () => {
    expect(searchSort('', undefined)).toEqual({});
  });
});
