/**
 * Picking catalog indexes from what the site reports.
 *
 * The failure this prevents is quiet: an author types `effective_date` into a
 * free-text list, the sort option appears in the menu, and choosing it sorts
 * nothing — there is no such index. Offering only what `@querystring` reports
 * makes that unrepresentable.
 */
import { describe, test, expect } from 'vitest';

import { indexChoices } from './QuerystringSelectWidget';

const QUERYSTRING = {
  indexes: {
    Title: { title: 'Title', sortable: true },
    portal_type: { title: 'Type', sortable: false },
    effective: { title: 'Publication date', sortable: true },
  },
  sortable_indexes: {
    Title: { title: 'Title' },
    effective: { title: 'Publication date' },
  },
};

describe('indexChoices', () => {
  test('offers only sortable indexes by default', () => {
    const choices = indexChoices(QUERYSTRING, 'sortable');
    expect(choices.map(([name]) => name)).toEqual(['effective', 'Title']);
  });

  test('"all" offers every queryable index, sortable or not', () => {
    const choices = indexChoices(QUERYSTRING, 'all');
    expect(choices.map(([name]) => name).sort()).toEqual([
      'Title',
      'effective',
      'portal_type',
    ]);
  });

  test('stores the index name and shows its title', () => {
    // The name is what a query is built from; the title is only what the author
    // reads. Storing the title would produce a query that matches nothing.
    const choices = indexChoices(QUERYSTRING, 'sortable');
    expect(choices).toContainEqual(['effective', 'Publication date']);
  });

  test('reads in the order a person scans, by title', () => {
    const choices = indexChoices(QUERYSTRING, 'sortable');
    expect(choices.map(([, title]) => title)).toEqual([
      'Publication date',
      'Title',
    ]);
  });

  test('an index with no title falls back to its name, never blank', () => {
    const choices = indexChoices(
      { sortable_indexes: { created: {} } },
      'sortable',
    );
    expect(choices).toEqual([['created', 'created']]);
  });

  test('picking ONE index offers a way to pick none', () => {
    // "No sorting" is a real answer for a sort field — usually the default —
    // and without an entry for it there is no way back to it.
    const choices = indexChoices(QUERYSTRING, 'sortable', '— no sorting —');
    expect(choices[0]).toEqual(['', '— no sorting —']);
    expect(choices.map(([name]) => name)).toEqual(['', 'effective', 'Title']);
  });

  test('picking SEVERAL needs no none entry — empty already says it', () => {
    const choices = indexChoices(QUERYSTRING, 'sortable', null);
    expect(choices.map(([name]) => name)).toEqual(['effective', 'Title']);
  });

  test('an empty menu rather than a crash before @querystring has loaded', () => {
    expect(indexChoices(undefined, 'sortable')).toEqual([]);
    expect(indexChoices({}, 'all')).toEqual([]);
  });
});
