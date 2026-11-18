import { describe, it, expect } from 'vitest';
import { parseRelativePath, formatRelativePath } from './relativePath';

/**
 * A relative-path Location criterion is a path from the listing's page, and
 * optionally `::depth` (plone.app.querystring `_relativePath`): `.::1` is the
 * page's own children, `./` everything under it, `..` its parent's tree.
 */
describe('parseRelativePath', () => {
  it.each([
    ['./', { path: './', depth: null }],
    ['.', { path: './', depth: null }],
    ['../', { path: '../', depth: null }],
    ['..', { path: '../', depth: null }],
    ['.::1', { path: './', depth: 1 }],
    ['./::2', { path: './', depth: 2 }],
    ['..::1', { path: '../', depth: 1 }],
  ])('%s is %o', (value, parsed) => {
    expect(parseRelativePath(value)).toEqual(parsed);
  });

  it('keeps a path the menu does not offer as it is', () => {
    expect(parseRelativePath('../news::1')).toEqual({ path: '../news', depth: 1 });
    expect(parseRelativePath('reports')).toEqual({ path: 'reports', depth: null });
  });

  it('reads no value as no path and every level', () => {
    expect(parseRelativePath(undefined)).toEqual({ path: '', depth: null });
    expect(parseRelativePath('')).toEqual({ path: '', depth: null });
  });

  it('keeps depth 0, the page alone, as Plone reads it', () => {
    expect(parseRelativePath('.::0')).toEqual({ path: './', depth: 0 });
  });

  it('shows a value whose depth is not a number as it is, rather than guess', () => {
    expect(parseRelativePath('.::x')).toEqual({ path: '.::x', depth: null });
  });
});

describe('formatRelativePath', () => {
  it('writes the depth after the path', () => {
    expect(formatRelativePath({ path: './', depth: 1 })).toBe('./::1');
    expect(formatRelativePath({ path: '../news', depth: 3 })).toBe('../news::3');
  });

  it('writes no depth for every level', () => {
    expect(formatRelativePath({ path: '../', depth: null })).toBe('../');
  });

  it('round-trips what it reads, keeping its meaning', () => {
    for (const value of ['./', '../', './::1', '../::2', '../news::1', 'reports']) {
      expect(formatRelativePath(parseRelativePath(value))).toBe(value);
    }
  });
});
