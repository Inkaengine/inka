import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { resolveTarget, type Target } from '../targets';

let target: Target;

beforeAll(async () => {
  target = await resolveTarget();
  await target.start();
});

afterAll(async () => {
  await target.stop();
});

beforeEach(async () => {
  await target.seed();
});

const CATEGORIES = 'categories';

describe('vocabulary.get', () => {
  it('returns the canonical Vocabulary shape', async () => {
    const vocab: any = await target.adapter.dispatch('vocabulary.get', {
      name: target.vocabularies[CATEGORIES],
      limit: 10,
    });
    expect(Array.isArray(vocab.items)).toBe(true);
    expect(typeof vocab.total).toBe('number');
    for (const item of vocab.items) {
      expect(typeof item.token).toBe('string');
      expect(typeof item.title).toBe('string');
    }
  });

  it('reports the full size of the vocabulary, not the page size', async () => {
    // Asserted WITHIN one response. The vocabulary is generated until PHP's
    // execution limit stops it and is still growing while the suite runs, so
    // neither a constant sampled at start() (3533 vs 3586) nor two requests
    // compared against each other (4010 vs 4026) is stable. What is stable, and
    // is the actual property, is that one response reports a total larger than
    // the page it returned.
    const tenPage: any = await target.adapter.dispatch('vocabulary.get', {
      name: target.vocabularies[CATEGORIES],
      limit: 10,
    });
    expect(tenPage.items.length).toBeLessThanOrEqual(10);
    expect(tenPage.total).toBeGreaterThan(tenPage.items.length);
  });

  it('narrows the result set with a title filter', async () => {
    const vocab: any = await target.adapter.dispatch('vocabulary.get', {
      name: target.vocabularies[CATEGORIES],
      title: `Category ${Math.floor(target.vocabularySize / 2)}`,
    });
    expect(vocab.items.length).toBeGreaterThan(0);
    for (const item of vocab.items) {
      expect(item.title).toContain(
        `Category ${Math.floor(target.vocabularySize / 2)}`,
      );
    }
  });

  it('stays usable as type-ahead against a large vocabulary', async () => {
    // The seed generates 10 000 terms precisely so this assertion means
    // something: an adapter that fetches the whole vocabulary and filters in
    // memory will breach this well before a user notices it is broken.
    // Budgeted RELATIVE to this backend, not in absolute milliseconds. The
    // property is "filters server-side"; an absolute 1000ms encoded an
    // assumption about backend speed and failed at 1204ms against
    // WordPress-on-WASM, where every request costs ~1.1s no matter what it
    // does — the environment, not the adapter. An adapter that pulled all
    // 10 000 terms back and filtered in memory would take many times a single
    // small request on ANY backend, which is what this now measures.
    const baselineStart = Date.now();
    await target.adapter.dispatch('vocabulary.get', {
      name: target.vocabularies[CATEGORIES],
      limit: 1,
    });
    const baseline = Date.now() - baselineStart;

    const started = Date.now();
    const vocab: any = await target.adapter.dispatch('vocabulary.get', {
      name: target.vocabularies[CATEGORIES],
      title: `Category ${target.vocabularySize - 1}`,
      limit: 20,
    });
    const elapsed = Date.now() - started;
    expect(vocab.items.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(Math.max(1000, baseline * 3));
  });

  it('rejects an unknown vocabulary with NOT_FOUND', async () => {
    await expect(
      target.adapter.dispatch('vocabulary.get', { name: 'no.such.vocabulary' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
