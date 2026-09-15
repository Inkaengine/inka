/**
 * Picking WHICH vocabulary a field uses.
 *
 * The listing answers `{"@id", "title"}` — no `token` — which is exactly why
 * Volto's own vocabulary widgets cannot be pointed at it: their reducer stores
 * `item.token`, so the menu would show names and save nothing. What a field
 * holds is the NAME, and the name is the last segment of `@id`.
 */
import { describe, test, expect } from 'vitest';

import { vocabularyNameFrom } from './VocabularySelectWidget';

describe('vocabularyNameFrom', () => {
  test('takes the name out of a listing item', () => {
    expect(
      vocabularyNameFrom({
        '@id':
          'http://localhost:8080/Plone/@vocabularies/plone.app.vocabularies.Keywords',
        title: 'plone.app.vocabularies.Keywords',
      }),
    ).toBe('plone.app.vocabularies.Keywords');
  });

  test('survives an escaped name', () => {
    expect(
      vocabularyNameFrom({ '@id': '/@vocabularies/some%20vocabulary' }),
    ).toBe('some vocabulary');
  });

  test('falls back to the title when there is no @id to read', () => {
    expect(
      vocabularyNameFrom({ title: 'plone.app.vocabularies.Weekdays' }),
    ).toBe('plone.app.vocabularies.Weekdays');
  });

  test('an item with neither is not offered', () => {
    expect(vocabularyNameFrom({})).toBe('');
    expect(vocabularyNameFrom(undefined)).toBe('');
  });
});
