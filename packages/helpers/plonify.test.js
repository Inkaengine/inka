import { describe, it, expect } from 'vitest';
import { plonify } from './plonify';

describe('plonify: the search envelope', () => {
  const results = {
    items: [{ path: '/news/first-post', title: 'First post', type: 'Document' }],
    total: 1,
  };

  it('omits batching when the CMS reports none', () => {
    // Plone omits the key unless the results really are batched ("Don't provide
    // batching links if resultset isn't batched" — HypermediaBatch.links), and
    // Volto renders its paging controls on `search?.batching &&`. An empty
    // object here put paging under every single-page result, on every adapter,
    // including one talking to a real Plone.
    const out = plonify('search', results, { path: '/@search' });
    expect('batching' in out).toBe(false);
    expect(out.items_total).toBe(1);
  });

  it('passes batching through when there is some', () => {
    const batched = {
      ...results,
      total: 50,
      batching: { '@id': '/@search', next: '/@search?b_start=25' },
    };
    const out = plonify('search', batched, { path: '/@search' });
    expect(out.batching.next).toBe('/@search?b_start=25');
  });
});
