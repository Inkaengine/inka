import { describe, it, expect, afterEach, vi } from 'vitest';

// agentApi reads a block's pull destinations (copyFromTargetMapping → blockSync
// → ../context), and HydraSchemaContext.js is JSX inside a .js file, which
// vitest/vite can't transform. Stub it — the same convention as blockSync.test.js
// and copyFromTarget.test.js.
vi.mock('../../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => {},
  getLiveBlockData: () => null,
  HydraSchemaProvider: ({ children }) => children,
  useHydraSchemaContext: () => ({}),
}));

import { registerAgentApi } from './agentApi';

describe('agent API before the editor has its page', () => {
  let unregister;
  afterEach(() => unregister?.());

  it('says it has no page yet, and reading the page says why, not a TypeError', () => {
    const live = { current: { properties: null, blockPathMap: {} } };
    unregister = registerAgentApi(live);
    expect(window.__inkaAgent.loaded()).toBe(false);
    expect(() => window.__inkaAgent.getPage()).toThrow(/no page loaded yet/);

    live.current = { properties: { '@type': 'Document', modified: '2026-10-30T00:00:00' }, blockPathMap: {} };
    expect(window.__inkaAgent.loaded()).toBe(true);
    expect(window.__inkaAgent.getPage().version).toBe('2026-10-30T00:00:00');
  });
});
