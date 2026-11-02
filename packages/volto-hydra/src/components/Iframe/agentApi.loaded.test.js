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

describe('what a block says about rules that depend on the data', () => {
  let unregister;
  afterEach(() => unregister?.());

  const schemas = (blocksConfig) => {
    const live = {
      current: {
        properties: { '@type': 'Document', blocks: {}, blocks_layout: { items: [] } },
        blockPathMap: {},
        blocksConfig,
        intl: { formatMessage: (m) => m?.defaultMessage ?? '' },
        contentTypeSchema: { title: 'Page', properties: {}, fieldsets: [] },
      },
    };
    unregister = registerAgentApi(live);
    return window.__inkaAgent.getBlockSchemas();
  };

  it('tells an agent about a field it cannot otherwise see, and one that will be refused', () => {
    // The schema an agent reads is resolved once, against no data: `advanced`
    // is absent from it, so without this an agent has no way to learn the
    // field exists at all.
    const enhancer = (args) => args.schema;
    enhancer.config = {
      enhancerType: 'fieldRules',
      fieldRules: {
        advanced: { when: { mode: 'advanced' }, else: false },
        maxItems: { when: { maxItems: { lt: 1 } }, error: 'Too few.' },
        image: { when: { image: { regex: '\\.png$' } }, warning: 'Prefer an SVG.' },
        legacy: false,
      },
    };
    const { types } = schemas({
      hero: {
        id: 'hero',
        title: 'Hero',
        blockSchema: { properties: { mode: { title: 'Mode' } }, fieldsets: [] },
        schemaEnhancer: enhancer,
      },
    });

    expect(types.hero.fieldRules).toEqual({
      advanced: { shownWhen: [{ mode: 'advanced' }] },
      maxItems: { errors: [{ when: { maxItems: { lt: 1 } }, message: 'Too few.' }] },
      image: {
        warnings: [{ when: { image: { regex: '\\.png$' } }, message: 'Prefer an SVG.' }],
      },
    });
    // `legacy: false` is unconditional, so the field is simply not in the
    // schema and there is nothing to say about it.
    expect(types.hero.fieldRules.legacy).toBeUndefined();
  });

  it('says nothing about a block whose rules are all unconditional', () => {
    const enhancer = (args) => args.schema;
    enhancer.config = { enhancerType: 'fieldRules', fieldRules: { b_size: false } };
    const { types } = schemas({
      plain: {
        id: 'plain',
        title: 'Plain',
        blockSchema: { properties: {}, fieldsets: [] },
        schemaEnhancer: enhancer,
      },
    });
    expect(types.plain.fieldRules).toBeUndefined();
  });

  it('says nothing about a block with no rules at all', () => {
    const { types } = schemas({
      bare: { id: 'bare', title: 'Bare', blockSchema: { properties: {}, fieldsets: [] } },
    });
    expect(types.bare.fieldRules).toBeUndefined();
  });
});
