import { describe, it, expect } from 'vitest';
import { translationStatus } from './index.js';

/**
 * What a translator needs to know on opening a translated page.
 *
 * Three questions, none of which required reading the page end to end or
 * diffing anything:
 *
 *   untranslated — copied and never touched (this part already existed)
 *   stale        — translated, but the source has changed since
 *   missing      — the source has a block this page never got
 *
 * `@canonical` gives the pairing; the fingerprint stored when the translation
 * was written gives the change. A block with no stored fingerprint is not
 * claimed to be anything: unknown is a real answer and saying "stale" would
 * train people to ignore the marker.
 */
const schemas = {
  slate: { properties: { text: { type: 'array', widget: 'slate' } } },
  teaser: {
    properties: {
      title: { type: 'string' },
      href: { type: 'array', widget: 'object_browser' },
    },
  },
  gridBlock: {
    properties: {
      headline: { type: 'string' },
      items: { type: 'array', widget: 'object_list' },
    },
  },
};

const sourceBlocks = {
  s1: { '@type': 'slate', text: [{ type: 'p', children: [{ text: 'Hello' }] }] },
  s2: { '@type': 'teaser', title: 'Design', href: [{ '@id': '/en/about' }] },
  s3: { '@type': 'teaser', title: 'Build' },
};

describe('translationStatus', () => {
  it('says nothing about a page that is up to date', () => {
    const translation = {
      t1: {
        '@type': 'slate',
        '@canonical': 's1',
        '@translation': { fingerprint: 'f-s1' },
        text: [{ type: 'p', children: [{ text: 'Hallo' }] }],
      },
      t2: {
        '@type': 'teaser',
        '@canonical': 's2',
        '@translation': { fingerprint: 'f-s2' },
        title: 'Gestaltung',
      },
      t3: {
        '@type': 'teaser',
        '@canonical': 's3',
        '@translation': { fingerprint: 'f-s3' },
        title: 'Bauen',
      },
    };
    const status = translationStatus(translation, sourceBlocks, {
      schemas,
      fingerprintOf: (block, id) => `f-${id}`,
    });
    expect(status.statuses).toEqual({});
    expect(status.missing).toEqual([]);
  });

  it('marks a block whose source has changed since it was translated', () => {
    const translation = {
      t1: {
        '@type': 'slate',
        '@canonical': 's1',
        '@translation': { fingerprint: 'written-from-the-old-words' },
        text: [{ type: 'p', children: [{ text: 'Hallo' }] }],
      },
      t2: {
        '@type': 'teaser',
        '@canonical': 's2',
        '@translation': { fingerprint: 'f-s2' },
        title: 'Gestaltung',
      },
      t3: {
        '@type': 'teaser',
        '@canonical': 's3',
        '@translation': { fingerprint: 'f-s3' },
        title: 'Bauen',
      },
    };
    const status = translationStatus(translation, sourceBlocks, {
      schemas,
      fingerprintOf: (block, id) => `f-${id}`,
    });
    expect(status.statuses).toEqual({ t1: 'stale' });
  });

  it('still reports a copy nobody has translated yet', () => {
    const translation = {
      t2: {
        '@type': 'teaser',
        '@canonical': 's2',
        '@translation': { fingerprint: 'f-s2' },
        // Word for word what it was copied from.
        title: 'Design',
        href: [{ '@id': '/en/about' }],
      },
    };
    const status = translationStatus(translation, sourceBlocks, {
      schemas,
      fingerprintOf: (block, id) => `f-${id}`,
    });
    expect(status.statuses.t2).toBe('untranslated');
  });

  it('names the source blocks this page never got', () => {
    const translation = {
      t1: {
        '@type': 'slate',
        '@canonical': 's1',
        '@translation': { fingerprint: 'f-s1' },
        text: [{ type: 'p', children: [{ text: 'Hallo' }] }],
      },
    };
    const status = translationStatus(translation, sourceBlocks, {
      schemas,
      fingerprintOf: (block, id) => `f-${id}`,
    });
    // s2 and s3 exist in the source and nothing here points at them: blocks
    // added to the original after this translation was made.
    expect(status.missing.sort()).toEqual(['s2', 's3']);
  });

  it('claims nothing for a block whose fingerprint was never recorded', () => {
    const translation = {
      t1: {
        '@type': 'slate',
        '@canonical': 's1',
        text: [{ type: 'p', children: [{ text: 'Hallo' }] }],
      },
    };
    const status = translationStatus(translation, sourceBlocks, {
      schemas,
      fingerprintOf: (block, id) => `f-${id}`,
    });
    expect(status.statuses.t1).toBeUndefined();
    expect(status.unknown).toEqual(['t1']);
  });

  it('keeps going when one block type has no schema, and says which', () => {
    // A page-wide pass must not lose every marker because one block type is
    // unknown to this frontend — but it must not pretend either.
    // A translation is a COPY, so it carries its source's type: the type this
    // frontend does not know is the one on both sides.
    const withMystery = {
      ...sourceBlocks,
      s4: { '@type': 'mystery', text: 'Hello' },
    };
    const translation = {
      t4: {
        '@type': 'mystery',
        '@canonical': 's4',
        '@translation': { fingerprint: 'recorded-somehow' },
        text: 'Hallo',
      },
      t2: {
        '@type': 'teaser',
        '@canonical': 's2',
        '@translation': { fingerprint: 'written-from-the-old-words' },
        title: 'Gestaltung',
      },
    };
    const status = translationStatus(translation, withMystery, {
      schemas,
      fingerprintOf: (block, id, type) => {
        if (!schemas[type]) throw new Error('no schema');
        return `f-${id}`;
      },
    });
    expect(status.statuses.t2, 'the blocks it can answer for').toBe('stale');
    expect(status.unknown).toContain('t4');
  });

  it('looks inside containers, where most of a page lives', () => {
    const nestedSource = {
      grid: {
        '@type': 'gridBlock',
        headline: 'What we do',
        blocks: { 'src-t': { '@type': 'teaser', title: 'Design' } },
        blocks_layout: { items: ['src-t'] },
      },
    };
    const translation = {
      grid: {
        '@type': 'gridBlock',
        '@canonical': 'grid',
        '@translation': { fingerprint: 'f-grid' },
        headline: 'Was wir machen',
        blocks: {
          t: {
            '@type': 'teaser',
            '@canonical': 'src-t',
            '@translation': { fingerprint: 'written-from-the-old-words' },
            title: 'Gestaltung',
          },
        },
        blocks_layout: { items: ['t'] },
      },
    };
    const status = translationStatus(translation, nestedSource, {
      schemas,
      fingerprintOf: (block, id) => `f-${id}`,
    });
    expect(status.statuses).toEqual({ t: 'stale' });
  });
});
