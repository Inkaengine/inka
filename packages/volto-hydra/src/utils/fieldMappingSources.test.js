/**
 * A field-mapping widget offers the sources its schema declares and, when it
 * names a vocabulary (plone.app.vocabularies.MetadataFields: every metadata
 * column the site's catalog holds), each column of that vocabulary too — so a
 * site's own catalog fields can be mapped without a frontend naming them.
 */
import { describe, expect, it } from 'vitest';

import { mergeVocabularySources } from './fieldMappingSources';

describe('mergeVocabularySources', () => {
  // No type has a field of any of these columns' names: an indexer fills
  // them, so they hold text.
  const site = { pageType: 'Document', contentTypes: { Document: { properties: {} } } };
  const declared = {
    '@id': { title: 'URL', type: 'string' },
    effective: { title: 'Published', type: 'date' },
  };

  it('keeps the declared sources first, with their own titles and types', () => {
    const merged = mergeVocabularySources(declared, [
      { token: 'effective', title: 'Effective Date' },
    ], site);
    expect(Object.keys(merged)).toEqual(['@id', 'effective']);
    expect(merged.effective).toEqual({ title: 'Published', type: 'date' });
  });

  it("adds each of the vocabulary's columns the declaration does not have", () => {
    const merged = mergeVocabularySources(declared, [
      { token: 'review_state', title: 'Review state' },
      { token: 'location', title: '' },
    ], site);
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
      site,
    );
    expect(Object.keys(merged)).toEqual(['title', 'EffectiveDate']);
  });

  it('with no vocabulary terms is the declaration', () => {
    expect(mergeVocabularySources(declared, [], site)).toEqual(declared);
    expect(mergeVocabularySources(undefined, [{ token: 'a', title: 'A' }], site)).toEqual({
      a: { title: 'A', type: 'string' },
    });
  });

  it('types each column as its field on the content types holds it', () => {
    const typed = {
      pageType: 'Document',
      contentTypes: {
        Document: { properties: { Topic: { type: 'array', items: { type: 'string' } }, flag: { type: 'boolean' } } },
        Event: { properties: { start: { type: 'string', widget: 'datetime' } } },
      },
    };
    const merged = mergeVocabularySources(
      declared,
      [
        { token: 'Topic', title: 'Topic' },
        { token: 'start', title: 'Start' },
        { token: 'flag', title: 'Flag' },
      ],
      typed,
    );
    expect(merged.Topic).toEqual({ title: 'Topic', type: 'array' });
    expect(merged.start).toEqual({ title: 'Start', type: 'date' });
    expect(merged.flag).toEqual({ title: 'Flag', type: 'boolean' });
  });

  it("leaves out a column there is no telling the kind of, or that Inka can't convert", () => {
    const merged = mergeVocabularySources(
      declared,
      [
        { token: 'Topic', title: 'Topic' },
        { token: 'text', title: 'Text' },
      ],
      {
        pageType: 'Folder',
        contentTypes: {
          Document: { properties: { Topic: { type: 'array', items: { type: 'string' } }, text: { type: 'string', widget: 'richtext' } } },
          Link: { properties: { Topic: { type: 'string' } } },
        },
      },
    );
    expect(Object.keys(merged)).toEqual(['@id', 'effective']);
  });
});
