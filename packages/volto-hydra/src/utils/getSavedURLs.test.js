/**
 * Unit tests for getSavedURLs.js
 *
 * Covers the parse/serialise contract for the `Name|EditURL[|PublishURL]`
 * cookie/env format. The PublishURL slot is the new bit — when a published
 * site is hosted at a different origin than the edit-mode frontend, the
 * editor may still paste a URL from the published site into a link widget
 * and we need to recognise that prefix to flatten it to a /path.
 *
 * Imports the parseEntry / serialiseEntries internals via the public
 * default export (getSavedURLs reads cookies), so we stick to the exports
 * we actually publish.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Cookies from 'js-cookie';
import getSavedURLs, { serialiseEntries } from './getSavedURLs';
import { getSavedUrlsCookieName } from './cookieNames';

afterEach(() => {
  // Cookie is mutated by getSavedURLs reads (test isolation).
  Cookies.remove(getSavedUrlsCookieName());
});

describe('getSavedURLs.serialiseEntries', () => {
  it('serialises name+url (legacy 2-part) entries unchanged', () => {
    expect(
      serialiseEntries([{ name: 'Nuxt', url: 'https://nuxt.example.com' }]),
    ).toBe('Nuxt|https://nuxt.example.com');
  });

  it('emits a 3-part Name|EditURL|PublishURL when publishUrl is set', () => {
    expect(
      serialiseEntries([
        {
          name: 'Site',
          url: 'https://edit.example.com',
          publishUrl: 'https://www.example.com',
        },
      ]),
    ).toBe('Site|https://edit.example.com|https://www.example.com');
  });

  it('omits the third slot when publishUrl is missing/empty', () => {
    expect(
      serialiseEntries([{ name: 'Only', url: 'https://e.x', publishUrl: '' }]),
    ).toBe('Only|https://e.x');
  });
});

describe('getSavedURLs (cookie parsing)', () => {
  it('parses a 3-part Name|EditURL|PublishURL cookie entry', () => {
    Cookies.set(
      getSavedUrlsCookieName(),
      'Site|https://edit.example.com|https://www.example.com',
    );
    const entries = getSavedURLs();
    const match = entries.find((e) => e.name === 'Site');
    expect(match).toBeDefined();
    expect(match.url).toBe('https://edit.example.com');
    expect(match.publishUrl).toBe('https://www.example.com');
  });

  it('leaves publishUrl undefined for legacy 2-part entries', () => {
    Cookies.set(getSavedUrlsCookieName(), 'Old|https://legacy.example.com');
    const entries = getSavedURLs();
    const match = entries.find((e) => e.name === 'Old');
    expect(match).toBeDefined();
    expect(match.url).toBe('https://legacy.example.com');
    expect(match.publishUrl).toBeUndefined();
  });
});
