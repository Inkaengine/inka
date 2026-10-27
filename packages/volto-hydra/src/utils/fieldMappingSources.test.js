/**
 * A field-mapping widget offers the sources its schema declares and, when it
 * names a vocabulary (plone.app.vocabularies.MetadataFields: every metadata
 * column the site's catalog holds), each column of that vocabulary too — so a
 * site's own catalog fields can be mapped without a frontend naming them.
 */
import { describe, expect, it } from 'vitest';

import { mergeVocabularySources } from './fieldMappingSources';

describe('mergeVocabularySources', () => {
  const declared = {
    '@id': { title: 'URL', type: 'string' },
    effective: { title: 'Published', type: 'date' },
  };

  it('keeps the declared sources first, with their own titles and types', () => {
    const merged = mergeVocabularySources(declared, [
      { token: 'effective', title: 'Effective Date' },
    ]);
    expect(Object.keys(merged)).toEqual(['@id', 'effective']);
    expect(merged.effective).toEqual({ title: 'Published', type: 'date' });
  });

  it("adds each of the vocabulary's columns the declaration does not have, as text", () => {
    const merged = mergeVocabularySources(declared, [
      { token: 'review_state', title: 'Review state' },
      { token: 'location', title: '' },
    ]);
    expect(Object.keys(merged)).toEqual(['@id', 'effective', 'review_state', 'location']);
    expect(merged.review_state).toEqual({ title: 'Review state', type: 'string' });
    expect(merged.location).toEqual({ title: 'location', type: 'string' });
  });

  it('skips a column that differs from a declared source only in case', () => {
    // A catalog's Title and Description columns hold what a result's title and
    // description already do: offering both would list each twice.
    const merged = mergeVocabularySources(
      { title: { title: 'Title', type: 'string' } },
      [
        { token: 'Title', title: 'Title' },
        { token: 'EffectiveDate', title: 'Effective date' },
      ],
    );
    expect(Object.keys(merged)).toEqual(['title', 'EffectiveDate']);
  });

  it('with no vocabulary terms is the declaration', () => {
    expect(mergeVocabularySources(declared, [])).toEqual(declared);
    expect(mergeVocabularySources(undefined, [{ token: 'a', title: 'A' }])).toEqual({
      a: { title: 'A', type: 'string' },
    });
  });
});
