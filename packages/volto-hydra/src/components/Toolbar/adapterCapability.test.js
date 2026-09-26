import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@plone/volto/registry', () => ({
  default: { settings: { useBridgeBackend: true } },
}));
vi.mock('../../bridge/client', () => ({
  getAdapterInfo: vi.fn(),
}));

import config from '@plone/volto/registry';
import { getAdapterInfo } from '../../bridge/client';
import { adapterSupports } from './adapterCapability';

beforeEach(() => {
  config.settings.useBridgeBackend = true;
  getAdapterInfo.mockReset();
});

describe('adapterSupports', () => {
  it('is true for everything when the admin talks to a CMS directly', () => {
    // Plain Volto against Plone: every screen it ships works, and gating them
    // on an adapter that does not exist would remove working features.
    config.settings.useBridgeBackend = false;
    expect(adapterSupports('translations-grouped')).toBe(true);
  });

  it('follows what the adapter announced', () => {
    getAdapterInfo.mockReturnValue({
      capabilities: ['content', 'multilingual', 'translations-grouped'],
    });
    expect(adapterSupports('translations-grouped')).toBe(true);
    expect(adapterSupports('versioning')).toBe(false);
  });

  it('withholds a capability a multilingual CMS still does not have', () => {
    // The pair that comes apart: one entity per language means there is no
    // second document to link, and the nearest thing to unlinking deletes
    // content. So translating is offered and linking is not.
    getAdapterInfo.mockReturnValue({ capabilities: ['content', 'multilingual'] });
    expect(adapterSupports('multilingual')).toBe(true);
    expect(adapterSupports('translations-grouped')).toBe(false);
  });

  it('says no until the adapter has announced itself', () => {
    getAdapterInfo.mockReturnValue(null);
    expect(adapterSupports('multilingual')).toBe(false);
  });
});
