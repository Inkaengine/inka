import { describe, it, expect } from 'vitest';
import { parseLocation, formatLocation } from './location';

/**
 * A Location criterion's value as the editor's widget shows it: the place
 * (`base`: a folder's UID for an Absolute path; `.`, `..`, `/*` (2nd level),
 * `/*\/*` (3rd level)… for a Relative path), whether only what is under it is
 * listed (`childrenOnly`), and Plone's depth. It is written with the ending
 * that says which: `/` the place and what is under it, `/*` only what is under
 * it (Inka's listing locations).
 *
 * A value with neither ending (Volto's `.`, `..`, `uid::1`) means what it means
 * to Plone, where the place is a result except at depth 1. It reads as that,
 * and is written back with the ending that keeps that meaning.
 */
describe('parseLocation', () => {
  it.each([
    ['./', { base: '.', childrenOnly: false, depth: null }],
    ['./*', { base: '.', childrenOnly: true, depth: null }],
    ['./*::1', { base: '.', childrenOnly: true, depth: 1 }],
    ['../::2', { base: '..', childrenOnly: false, depth: 2 }],
    ['/*/', { base: '/*', childrenOnly: false, depth: null }],
    ['/*/*', { base: '/*', childrenOnly: true, depth: null }],
    ['/*/*/', { base: '/*/*', childrenOnly: false, depth: null }],
    ['/*/*/*/::1', { base: '/*/*/*', childrenOnly: false, depth: 1 }],
    ['abc123/*::2', { base: 'abc123', childrenOnly: true, depth: 2 }],
    ['abc123/', { base: 'abc123', childrenOnly: false, depth: null }],
  ])('%s is %o', (value, parsed) => {
    expect(parseLocation(value)).toEqual(parsed);
  });

  it.each([
    ['.', { base: '.', childrenOnly: false, depth: null }],
    ['.::1', { base: '.', childrenOnly: true, depth: 1 }],
    ['.::2', { base: '.', childrenOnly: false, depth: 2 }],
    ['..', { base: '..', childrenOnly: false, depth: null }],
    ['abc123::1', { base: 'abc123', childrenOnly: true, depth: 1 }],
    ['../news::1', { base: '../news', childrenOnly: true, depth: 1 }],
  ])("Volto's %s reads as Plone means it: %o", (value, parsed) => {
    expect(parseLocation(value)).toEqual(parsed);
  });

  it('reads / and /* as the site root, as the listing does', () => {
    expect(parseLocation('/*')).toEqual({
      base: '/',
      childrenOnly: true,
      depth: null,
    });
    expect(parseLocation('/')).toEqual({
      base: '/',
      childrenOnly: false,
      depth: null,
    });
    expect(parseLocation('/::1')).toEqual({
      base: '/',
      childrenOnly: true,
      depth: 1,
    });
    expect(formatLocation({ base: '/', childrenOnly: true, depth: 1 })).toBe(
      '/*::1',
    );
    expect(
      formatLocation({ base: '/', childrenOnly: false, depth: null }),
    ).toBe('/');
  });

  it('reads no value as no place', () => {
    expect(parseLocation(undefined)).toEqual({
      base: '',
      childrenOnly: false,
      depth: null,
    });
    expect(parseLocation('')).toEqual({
      base: '',
      childrenOnly: false,
      depth: null,
    });
  });

  it('shows a value whose depth is not a number as it is, rather than guess', () => {
    expect(parseLocation('.::x')).toEqual({
      base: '.::x',
      childrenOnly: false,
      depth: null,
    });
  });
});

describe('formatLocation', () => {
  it('writes the ending, then the depth', () => {
    expect(formatLocation({ base: '.', childrenOnly: true, depth: 1 })).toBe(
      './*::1',
    );
    expect(
      formatLocation({ base: '/*', childrenOnly: false, depth: null }),
    ).toBe('/*/');
    expect(formatLocation({ base: '/*/*', childrenOnly: true, depth: 2 })).toBe(
      '/*/*/*::2',
    );
    expect(
      formatLocation({ base: 'abc123', childrenOnly: false, depth: 1 }),
    ).toBe('abc123/::1');
  });

  it('writes nothing for no place', () => {
    expect(formatLocation({ base: '', childrenOnly: true, depth: 1 })).toBe('');
  });

  it("writes Volto's values back with the ending that keeps their meaning", () => {
    expect(formatLocation(parseLocation('.::1'))).toBe('./*::1');
    expect(formatLocation(parseLocation('.'))).toBe('./');
    expect(formatLocation(parseLocation('abc123::1'))).toBe('abc123/*::1');
  });

  it('round-trips a value with an ending', () => {
    for (const value of [
      './',
      './*::1',
      '../::2',
      '/*/',
      '/*/*',
      '/*/*/*/::1',
      'abc123/*::2',
    ]) {
      expect(formatLocation(parseLocation(value))).toBe(value);
    }
  });
});
