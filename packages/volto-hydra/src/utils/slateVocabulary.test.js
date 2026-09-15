/**
 * The style vocabulary must not be a transcription.
 *
 * `undefinedSlateTypes` judges a node by asking "does anything define a
 * rendering for this type". Answering that from a list copied out of
 * volto-slate's source is a promise to keep re-copying it: the registry is OPEN
 * (`slate.elements['blockquote'] = …` is how the Blockquote plugin adds itself),
 * so any addon can extend it and the copy silently goes stale.
 *
 * Two things are checked against the LIVE registry, with volto-slate's own
 * applyConfig chain run (vitest-setup-hydra.js does that):
 *   - the fallback vocabulary matches what is registered, and
 *   - the types the block emitters EXTRACT are still registered, and still
 *     excluded from it. `table`/`td`/`img` render mid-paste and are then lifted
 *     into blocks of their own (hydra turns a pasted table into a `slateTable`
 *     BLOCK), so a STORED one means extraction failed and must be reported.
 */
import { describe, test, expect } from 'vitest';
import config from '@plone/volto/registry';
import {
  DEFAULT_SLATE_VOCABULARY,
  EXTRACTED_SLATE_TYPES,
} from '../../../hydra-js/slateStyles.js';

const liveElements = () => Object.keys(config.settings.slate?.elements || {});

describe('DEFAULT_SLATE_VOCABULARY', () => {
  test('matches the storable element types volto-slate registers', () => {
    const extracted = new Set(EXTRACTED_SLATE_TYPES);
    const live = liveElements()
      .filter((t) => !extracted.has(t))
      .sort();
    expect(
      live.length,
      'volto-slate config did not load — this would compare against nothing',
    ).toBeGreaterThan(5);
    const missing = live.filter((t) => !DEFAULT_SLATE_VOCABULARY.includes(t));
    const extra = DEFAULT_SLATE_VOCABULARY.filter((t) => !live.includes(t));
    expect(
      { missing, extra },
      'DEFAULT_SLATE_VOCABULARY has drifted from config.settings.slate.elements. ' +
        'Regenerate it from the live registry rather than editing by hand.',
    ).toEqual({ missing: [], extra: [] });
  });
});

describe('extracted types', () => {
  test('are registered as elements, and excluded from what may be stored', () => {
    // If volto-slate stops registering them, the exclusion is stale and quietly
    // excluding nothing.
    const els = liveElements();
    for (const t of EXTRACTED_SLATE_TYPES) {
      expect(els, `${t} is no longer a registered slate element`).toContain(t);
      expect(
        DEFAULT_SLATE_VOCABULARY,
        `${t} is extracted into a block — it must not count as storable`,
      ).not.toContain(t);
    }
  });

  test('cover every type slate.tableTypes names', () => {
    // The table half is derived from config, not written out here.
    for (const t of config.settings.slate?.tableTypes || []) {
      expect(EXTRACTED_SLATE_TYPES).toContain(t);
    }
    expect(config.settings.slate?.tableTypes?.length || 0).toBeGreaterThan(0);
  });
});
