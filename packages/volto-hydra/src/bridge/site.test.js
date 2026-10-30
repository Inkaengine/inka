import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ensureSiteLoaded, resetSiteLoadForTests } from './site';

const storeWith = (site, onDispatch = () => Promise.resolve()) => ({
  getState: () => ({ site }),
  dispatch: vi.fn(onDispatch),
});

describe('ensureSiteLoaded', () => {
  beforeEach(() => resetSiteLoadForTests());

  it('reads the site once, and not again', async () => {
    const store = storeWith({ loaded: false, data: {} });
    await ensureSiteLoaded(store);
    await ensureSiteLoaded(store);
    expect(store.dispatch).toHaveBeenCalledTimes(1);
  });

  it('does not trust a store that arrived saying the site was read', async () => {
    // A serialised store can carry loaded: true from a read the SERVER made,
    // which in a bridge session went to the CMS without the adapter and without
    // the session whose features the editor is in. Believing it left the admin
    // sure the site had one language, for good, because nothing re-reads @site.
    const store = storeWith({ loaded: true, data: { features: {} } });
    await ensureSiteLoaded(store);
    expect(store.dispatch).toHaveBeenCalledTimes(1);
  });

  it('reads it ONCE for callers that overlap', async () => {
    // GET_SITE_PENDING clears `data`, so a second read while the first is in
    // flight blanks the features a caller may have just acted on. App's loader
    // and the route's loader both want this before they start.
    let release;
    const store = storeWith(
      { loaded: false, data: {} },
      () => new Promise((resolve) => (release = resolve)),
    );
    const a = ensureSiteLoaded(store);
    const b = ensureSiteLoaded(store);
    expect(store.dispatch).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([a, b]);
  });

  it('lets a later caller retry after a read failed', async () => {
    // Not cached as a verdict: the session would otherwise spend its life
    // believing a site it never managed to read has no features.
    const store = storeWith({ loaded: false, data: {} }, () =>
      Promise.reject(new Error('CMS down')),
    );
    await expect(ensureSiteLoaded(store)).rejects.toThrow('CMS down');
    await expect(ensureSiteLoaded(store)).rejects.toThrow('CMS down');
    expect(store.dispatch).toHaveBeenCalledTimes(2);
  });
});
