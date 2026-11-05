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

import config from '@plone/volto/registry';
import { registerAgentApi } from './agentApi';
import { heldImage, releaseImages } from '../../utils/pendingImages';

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

  // Plone says a field holds a file by its factory (a lead image's is
  // "Image"): an agent putting a staged file there gives the file itself, not
  // the URL an image block takes.
  it("says which fields hold a file, by the field's factory", () => {
    const { types } = schemas({
      teaser: {
        id: 'teaser',
        title: 'Teaser',
        blockSchema: { properties: { lead: { title: 'Lead', type: 'object', factory: 'Image' }, url: { title: 'URL', widget: 'url' } }, fieldsets: [] },
      },
    });
    expect(types.teaser.blockSchema.properties.lead).toEqual({ title: 'Lead', type: 'object', factory: 'Image' });
    expect(types.teaser.blockSchema.properties.url.factory).toBeUndefined();
  });

  it('says nothing about a block with no rules at all', () => {
    const { types } = schemas({
      bare: { id: 'bare', title: 'Bare', blockSchema: { properties: {}, fieldsets: [] } },
    });
    expect(types.bare.fieldRules).toBeUndefined();
  });
});

describe('holding a file an agent adds, until the page is saved', () => {
  let unregister;
  afterEach(() => {
    unregister?.();
    releaseImages();
    vi.unstubAllGlobals();
    delete config.settings.deferImageUploads;
    window.history.pushState({}, '', '/');
  });

  /** The editor of `path`, a page that is folderish or not, in a folder whose @types are `addable`. */
  const editing = (path, { isFolderish, addable }) => {
    window.history.pushState({}, '', `${path}/edit`);
    const asked = [];
    vi.stubGlobal('fetch', async (url) => {
      asked.push(url);
      return new Response(JSON.stringify(Object.entries(addable).map(([id, ok]) => ({ id, addable: ok }))));
    });
    unregister = registerAgentApi({
      current: { properties: { '@type': 'Document', is_folderish: isFolderish }, blockPathMap: {} },
    });
    return asked;
  };
  const PNG_BASE64 = btoa(String.fromCharCode(137, 80, 78, 71));

  it("is refused when the site's front end doesn't take held images", async () => {
    editing('/news/page', { isFolderish: false, addable: { Image: true } });
    await expect(window.__inkaAgent.holdFile({ name: 'a.png', type: 'image/png', data: PNG_BASE64 }))
      .rejects.toThrow(/front end .*deferImageUploads/);
  });

  it('holds the file where the image widget would upload it, and returns the reference the page names it by', async () => {
    config.settings.deferImageUploads = true;
    const asked = editing('/news/page', { isFolderish: false, addable: { Image: true } });
    const ref = await window.__inkaAgent.holdFile({ name: 'a.png', type: 'image/png', data: PNG_BASE64 });
    expect(ref).toMatch(/^inka-pending:/);
    const held = heldImage(ref);
    // Beside a page that holds no items, as ImageWidget uploads.
    expect(held.folder).toBe('/news');
    expect(asked).toEqual(['/++api++/news/@types']);
    expect(held.file.name).toBe('a.png');
    expect(held.file.type).toBe('image/png');
    expect([...new Uint8Array(await held.file.arrayBuffer())]).toEqual([137, 80, 78, 71]);
  });

  it('holds it inside a page that holds items', async () => {
    config.settings.deferImageUploads = true;
    editing('/news/page', { isFolderish: true, addable: { File: true } });
    const ref = await window.__inkaAgent.holdFile({ name: 'r.pdf', type: 'application/pdf', data: btoa('%PDF') });
    expect(heldImage(ref).folder).toBe('/news/page');
  });

  it("holds it in the site's root when editing the home page", async () => {
    config.settings.deferImageUploads = true;
    window.history.pushState({}, '', '/edit');
    const asked = [];
    vi.stubGlobal('fetch', async (url) => {
      asked.push(url);
      return new Response(JSON.stringify([{ id: 'Image', addable: true }]));
    });
    unregister = registerAgentApi({ current: { properties: { '@type': 'Plone Site', is_folderish: true }, blockPathMap: {} } });
    const ref = await window.__inkaAgent.holdFile({ name: 'a.png', type: 'image/png', data: PNG_BASE64 });
    expect(heldImage(ref).folder).toBe('/');
    expect(asked).toEqual(['/++api++/@types']);
  });

  it("is refused when the folder doesn't take that kind of file from this user", async () => {
    config.settings.deferImageUploads = true;
    editing('/news/page', { isFolderish: false, addable: { Image: true, File: false } });
    await expect(window.__inkaAgent.holdFile({ name: 'r.pdf', type: 'application/pdf', data: btoa('%PDF') }))
      .rejects.toThrow('You can’t add files to /news, so this one can’t be saved there.');
  });
});
