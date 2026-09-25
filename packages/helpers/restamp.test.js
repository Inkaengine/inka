import { describe, it, expect } from 'vitest';
import { restampTranslatedBlocks } from './index.js';

/**
 * Clearing the marker by doing the work.
 *
 * A stale marker that cannot be cleared is worse than none: translators learn
 * to ignore it, and the ones that matter go unseen with it. So when a
 * translator rewrites a block, the copy records the source it has now caught up
 * with — the fingerprint moves forward.
 *
 * What counts as "did the work" is the WORDS changing in that block, not the
 * block object changing. Restyling one, or swapping its image, is no evidence
 * anyone read the new English, and clearing the marker on that would lose the
 * very drift these fingerprints exist to catch.
 */
const fingerprintOf = (block) =>
  // Stand-in for sourceFingerprint: the words, and nothing else.
  JSON.stringify([block?.title ?? '', block?.description ?? '']);

const source = {
  s1: { '@type': 'teaser', title: 'Design, rewritten', description: 'New words' },
  s2: { '@type': 'teaser', title: 'Build', description: 'Old words' },
};

describe('restampTranslatedBlocks', () => {
  it('moves the fingerprint forward for a block the translator rewrote', () => {
    const initial = {
      t1: {
        '@type': 'teaser',
        '@canonical': 's1',
        '@translation': { fingerprint: 'made-from-the-old-english' },
        title: 'Gestaltung',
      },
    };
    const saved = {
      t1: { ...initial.t1, title: 'Gestaltung, neu geschrieben' },
    };

    const out = restampTranslatedBlocks(saved, initial, source, { fingerprintOf });

    expect(out.t1['@translation'].fingerprint).toBe(fingerprintOf(source.s1));
  });

  it('leaves a block the translator did not touch exactly as it was', () => {
    const initial = {
      t2: {
        '@type': 'teaser',
        '@canonical': 's2',
        '@translation': { fingerprint: 'made-from-the-old-english' },
        title: 'Bauen',
      },
    };
    const saved = { t2: { ...initial.t2 } };

    const out = restampTranslatedBlocks(saved, initial, source, { fingerprintOf });

    expect(out.t2['@translation'].fingerprint).toBe('made-from-the-old-english');
  });

  it('does not count restyling as translating', () => {
    // The words are what a translation is. Someone who changed a colour has
    // not read the English that changed, and clearing the marker would hide it.
    const initial = {
      t1: {
        '@type': 'teaser',
        '@canonical': 's1',
        '@translation': { fingerprint: 'made-from-the-old-english' },
        title: 'Gestaltung',
      },
    };
    const saved = {
      t1: { ...initial.t1, styles: { backgroundColor: 'red' }, variation: 'summary' },
    };

    const out = restampTranslatedBlocks(saved, initial, source, { fingerprintOf });

    expect(out.t1['@translation'].fingerprint).toBe('made-from-the-old-english');
  });

  it('reaches blocks inside containers, where most of a page lives', () => {
    const nestedSource = {
      'src-grid': {
        '@type': 'gridBlock',
        blocks: { 'src-t': { '@type': 'teaser', title: 'Design, rewritten' } },
        blocks_layout: { items: ['src-t'] },
      },
    };
    const inner = (title) => ({
      '@type': 'teaser',
      '@canonical': 'src-t',
      '@translation': { fingerprint: 'made-from-the-old-english' },
      title,
    });
    const initial = {
      grid: {
        '@type': 'gridBlock',
        '@canonical': 'src-grid',
        '@translation': { fingerprint: 'grid-fp' },
        blocks: { t: inner('Gestaltung') },
        blocks_layout: { items: ['t'] },
      },
    };
    const saved = {
      grid: {
        ...initial.grid,
        blocks: { t: inner('Gestaltung, neu geschrieben') },
      },
    };

    const out = restampTranslatedBlocks(saved, initial, nestedSource, {
      fingerprintOf,
    });

    expect(out.grid.blocks.t['@translation'].fingerprint).toBe(
      fingerprintOf(nestedSource['src-grid'].blocks['src-t']),
    );
  });

  it('records a fingerprint for a block that never had one', () => {
    // Content translated before any of this existed, or a copy made by
    // something else: once someone works on it, we know what it was caught up
    // with and can say so from then on.
    const initial = {
      t1: { '@type': 'teaser', '@canonical': 's1', title: 'Gestaltung' },
    };
    const saved = { t1: { ...initial.t1, title: 'Neu' } };

    const out = restampTranslatedBlocks(saved, initial, source, { fingerprintOf });

    expect(out.t1['@translation'].fingerprint).toBe(fingerprintOf(source.s1));
  });

  it('leaves a block that translates nothing alone, and the original untouched', () => {
    const initial = {
      own: { '@type': 'slate', text: 'A block written in German only' },
    };
    const saved = { own: { ...initial.own, text: 'Changed' } };

    const out = restampTranslatedBlocks(saved, initial, source, { fingerprintOf });

    expect(out.own['@translation']).toBeUndefined();
    expect(saved.own['@translation'], 'the input is not mutated').toBeUndefined();
  });
});
