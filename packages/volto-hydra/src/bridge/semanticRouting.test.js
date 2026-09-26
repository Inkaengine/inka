import { describe, it, expect, vi } from 'vitest';
import { BridgeApi } from './BridgeApi';
import { routeToIntent } from './intentRouter';
import { plonify } from '@volto-hydra/helpers';

const semanticAdapter = () => ({ capabilities: ['content', 'search-filter'] });
const passthroughAdapter = () => ({ capabilities: ['content', 'http-passthrough'] });

const doc = {
  id: 'uuid-1',
  path: '/news/first-post',
  type: 'Document',
  title: 'First post',
  blocks: { a: { '@type': 'slate' } },
  blocksLayout: { items: ['a'] },
  fields: { description: 'hi' },
  state: 'published',
};

describe('routeToIntent', () => {
  it.each([
    ['get', '/_test_data/@types/Document', 'types.getSchema'],
    ['get', '/@querystring', 'querystring.getIndexes'],
    ['get', '/@users/admin', 'auth.whoami'],
    ['get', '/news/@search?path.depth=1', 'tree.list'],
    ['get', '/@search?SearchableText=x', 'search'],
    ['get', '/news/first-post', 'content.get'],
    ['patch', '/news/first-post', 'content.update'],
    ['post', '/news', 'content.create'],
    ['del', '/news/first-post', 'content.delete'],
    ['get', '/news/@breadcrumbs', 'breadcrumbs.get'],
    ['post', '/news/@workflow/publish', 'state.transition'],
    ['get', '/@site', 'site.get'],
    ['get', '/en/about/@translations', 'translations.get'],
    ['post', '/en/about/@translations', 'translations.link'],
    ['del', '/en/about/@translations', 'translations.unlink'],
    ['get', '/en/about/@translation-locator?target_language=de', 'translations.locate'],
  ])('%s %s -> %s', (op, path, intent) => {
    expect(routeToIntent({ op, path, data: {} })?.intent).toBe(intent);
  });

  /**
   * The admin gates real features on what @site says — `features.multilingual`
   * decides whether Manage Translations exists at all. In a bridge session that
   * read has nowhere to go: the router had no case for it, so it fell to the
   * default and returned null, and every multilingual affordance silently
   * vanished against every adapter.
   */
  /**
   * The translation group, both ways. Volto's own table sends all four of these
   * at Plone paths, and with no case for them every one fell to the default and
   * returned null — so against an adapter the table rendered, then threw when it
   * read a group that had never been fetched.
   */
  it('carries what each translation call is about', () => {
    expect(
      routeToIntent({ op: 'get', path: '/en/about/@translations', data: {} }),
    ).toEqual({
      intent: 'translations.get',
      args: { path: '/en/about' },
      endpoint: 'translations',
    });
    // Linking names the document to bring into the group; Volto sends a path.
    expect(
      routeToIntent({
        op: 'post',
        path: '/en/about/@translations',
        data: { id: '/de/ueber-uns' },
      }),
    ).toEqual({
      intent: 'translations.link',
      args: { path: '/en/about', target: '/de/ueber-uns' },
      endpoint: 'translations',
    });
    // Unlinking names the language to remove, not a path.
    expect(
      routeToIntent({
        op: 'del',
        path: '/en/about/@translations',
        data: { language: 'de' },
      }),
    ).toEqual({
      intent: 'translations.unlink',
      args: { path: '/en/about', language: 'de' },
      endpoint: 'translations',
    });
    // The locator's language rides in the query string, not the body.
    expect(
      routeToIntent({
        op: 'get',
        path: '/en/about/@translation-locator?target_language=de',
        data: {},
      }),
    ).toEqual({
      intent: 'translations.locate',
      args: { path: '/en/about', language: 'de' },
      endpoint: 'translation-locator',
    });
  });

  it('routes the site read, which the admin gates features on', () => {
    expect(routeToIntent({ op: 'get', path: '/@site', data: {} })).toEqual({
      intent: 'site.get',
      args: {},
      endpoint: 'site',
    });
  });

  /**
   * Volto's cut-and-paste sends every selected item in one @move. Routing only
   * source[0] moved the first and silently dropped the rest — a bulk move that
   * half-lands while the listing looks plausible.
   */
  it('routes a @move to one content.move per source', () => {
    const steps = routeToIntent({
      op: 'post',
      path: '/target/@move',
      data: { source: ['/a/one', '/a/two'] },
    });
    expect(steps).toEqual([
      { intent: 'content.move', args: { path: '/a/one', targetParentPath: '/target' } },
      { intent: 'content.move', args: { path: '/a/two', targetParentPath: '/target' } },
    ]);
  });

  it('routes an upload to asset.upload, not content.create', () => {
    // The image widget posts a file payload to a folder. Treating that as a
    // content create made the CMS build a page named after the file — a node
    // on Drupal rather than a media entity — so asset.upload was never
    // exercised by the editor despite every adapter implementing it.
    const r = routeToIntent({
      op: 'post',
      path: '/news',
      data: {
        '@type': 'Image',
        title: 'hero.png',
        image: {
          data: 'aGVsbG8=',
          encoding: 'base64',
          'content-type': 'image/png',
          filename: 'hero.png',
        },
      },
    });
    expect(r.intent).toBe('asset.upload');
    expect(r.args).toMatchObject({
      parentPath: '/news',
      filename: 'hero.png',
      contentType: 'image/png',
      data: 'aGVsbG8=',
    });
  });

  it('still treats a plain create as content.create', () => {
    // Guard against the shape check being too eager: a document with ordinary
    // fields must not be mistaken for an upload.
    const r = routeToIntent({
      op: 'post',
      path: '/news',
      data: { '@type': 'Document', title: 'A page', description: 'not a file' },
    });
    expect(r.intent).toBe('content.create');
  });

  it('returns null for endpoints with no canonical form', () => {
    expect(routeToIntent({ op: 'get', path: '/x/@history' })).toBeNull();
  });

  it('distinguishes a folder listing from a search', () => {
    // path.depth=1 is how the contents view asks for children; treating it as
    // a fulltext search would ask CMSes for an index they may not have.
    expect(routeToIntent({ op: 'get', path: '/n/@search?path.depth=1' }).intent).toBe('tree.list');
    expect(routeToIntent({ op: 'get', path: '/n/@search?b_size=5' }).intent).toBe('search');
  });

  it('maps blocks_layout onto the canonical blocksLayout on update', () => {
    const r = routeToIntent({
      op: 'patch',
      path: '/a',
      data: { title: 'T', blocks: {}, blocks_layout: { items: ['x'] } },
    });
    expect(r.args.data.blocksLayout).toEqual({ items: ['x'] });
    expect(r.args.data.blocks_layout).toBeUndefined();
  });
});

describe('plonify site.get', () => {
  /**
   * Volto reads these keys directly — `state.site.data['plone.default_language']`
   * and `state.site.data.features.multilingual` — so the canonical answer has to
   * arrive under Plone's own names or the admin sees a single-language site with
   * no default language, whatever the CMS said.
   */
  it('gives Volto the keys it reads', () => {
    const p = plonify('site.get', {
      defaultLanguage: 'en',
      languages: ['en', 'de'],
      features: { multilingual: true },
      title: 'Example',
    });
    expect(p['plone.default_language']).toBe('en');
    expect(p['plone.available_languages']).toEqual(['en', 'de']);
    expect(p.features.multilingual).toBe(true);
    expect(p['plone.site_title']).toBe('Example');
  });

  it('reports a single-language site rather than guessing', () => {
    // A CMS with no multilingual support says so, and the admin hides the
    // affordances instead of offering ones that cannot work.
    const p = plonify('site.get', { defaultLanguage: 'en' });
    expect(p.features.multilingual).toBe(false);
    expect(p['plone.available_languages']).toEqual(['en']);
  });
});

describe('plonify translations', () => {
  /**
   * Volto's translation table reads `content['@components'].translations.items`
   * and, for each entry, `item['@id']` and `item.language`. The canonical answer
   * names a path and a language, so it has to arrive under those keys — the view
   * derives its whole row set from them, and gets `undefined` otherwise.
   */
  it('gives the table the keys it reads', () => {
    const p = plonify('translations.get', {
      items: [{ language: 'de', path: '/de/ueber-uns', title: 'Über uns' }],
    });
    expect(p.items[0]['@id']).toBe('/de/ueber-uns');
    expect(p.items[0].language).toBe('de');
    expect(p.items[0].title).toBe('Über uns');
  });

  it('reports no translations as an empty list, not a missing one', () => {
    // The view reads `.items` before checking it: an absent list throws where an
    // empty one renders "not translated yet".
    expect(plonify('translations.get', {}).items).toEqual([]);
    expect(plonify('translations.get', null).items).toEqual([]);
  });

  it('answers the locator with the place, as Volto reads it', () => {
    const p = plonify('translations.locate', { path: '/de' });
    expect(p['@id']).toBe('/de');
  });
});

describe('plonify', () => {
  it('renders a Document in the shape reducers read', () => {
    const p = plonify('content.get', doc);
    expect(p['@id']).toBe('/news/first-post');
    expect(p['@type']).toBe('Document');
    expect(p.id).toBe('first-post');
    expect(p.UID).toBe('uuid-1');
    expect(p.blocks_layout).toEqual({ items: ['a'] });
    expect(p.review_state).toBe('published');
    expect(p.description).toBe('hi');
  });

  describe('adapter-declared actions', () => {
    const permissions = {
      state: { name: 'published', label: 'Published' },
      transitions: [],
      effective: { canEdit: true, canDelete: true, canShare: true },
    };
    const actions = (extra) =>
      plonify('state.get', { ...permissions, actions: extra }, {
        endpoint: 'actions',
      });

    it('sends a built-in to the CMS instead of Volto', () => {
      const p = actions([
        { id: 'edit', title: 'Edit in WordPress', url: 'http://cms/wp-admin/post.php?post=7' },
      ]);
      const edit = p.object.find((a) => a.id === 'edit');
      // `url` is what Plone 6 emits and what Volto reads. This asserted '@id'
      // until it was checked against a live Plone; the mock had been written to
      // agree with the adapter, so both were wrong together.
      expect(edit.url).toBe('http://cms/wp-admin/post.php?post=7');
      // Marked native so the toolbar leaves the admin rather than routing.
      expect(edit.native).toBe(true);
    });

    it('withholds one the adapter says is not permitted', () => {
      const p = actions([{ id: 'sharing', title: 'Sharing', permitted: false }]);
      expect(p.object.find((a) => a.id === 'sharing')).toBeUndefined();
      // Only that one: withholding is not a reason to lose the rest.
      expect(p.object.find((a) => a.id === 'edit')).toBeDefined();
    });

    it('adds one Volto has no concept of, in the category asked for', () => {
      const p = actions([
        {
          id: 'wp-settings',
          title: 'Site settings',
          url: 'http://cms/wp-admin/options-general.php',
          category: 'site',
          target: 'iframe',
        },
      ]);
      // Volto reads state.actions.actions.site_actions — Plone's own category
      // name — not `site`.
      const added = p.site_actions.find((a) => a.id === 'wp-settings');
      expect(added.url).toBe('http://cms/wp-admin/options-general.php');
      // How it opens travels with the action: the toolbar decides nothing.
      expect(added.target).toBe('iframe');
      expect(p.object.find((a) => a.id === 'wp-settings')).toBeUndefined();
    });

    it('carries the screen an action answers, so the toolbar can find it', () => {
      // Category is not enough: WordPress declares two `site` actions, and only
      // one of them is Site Setup. The adapter marks which, and that mark has to
      // survive into the store or the toolbar is back to guessing by position.
      const p = actions([
        {
          id: 'wp-media',
          title: 'Media library',
          url: 'http://cms/wp-admin/upload.php',
          category: 'site',
        },
        {
          id: 'wp-settings',
          title: 'Site settings',
          url: 'http://cms/wp-admin/options-general.php',
          category: 'site',
          panel: 'site-setup',
        },
      ]);
      expect(p.site_actions.find((a) => a.id === 'wp-settings').panel).toBe('site-setup');
      // Not invented for the one that did not claim it.
      expect(p.site_actions.find((a) => a.id === 'wp-media').panel).toBeUndefined();
    });

    it('leaves the built-ins alone when the adapter declares nothing', () => {
      const p = plonify('state.get', permissions, { endpoint: 'actions' });
      expect(p.object.map((a) => a.id)).toEqual([
        'view',
        'edit',
        'folderContents',
        'delete',
        'sharing',
      ]);
    });
  });

  it('renders listings with items_total', () => {
    const p = plonify('tree.list', { items: [doc], total: 1 }, { path: '/news' });
    expect(p.items_total).toBe(1);
    expect(p.items[0]['@id']).toBe('/news/first-post');
  });

  it('reads types.list from the canonical {items} envelope', () => {
    // Every adapter returns {items}; treating it as a bare array threw
    // ".map is not a function" and left the add menu permanently empty.
    const p = plonify('types.list', {
      items: [{ id: 'page', title: 'Page', addable: true }],
    });
    expect(p).toHaveLength(1);
    expect(p[0]['@id']).toBe('/@types/page');
    expect(p[0].addable).toBe(true);
  });

  it('renders an uploaded asset as the image widget reads it', () => {
    // The widget uses content['@id'] as the stored value and content.image as
    // image_scales.image[0]; those two are the contract, not the whole Document.
    const p = plonify('asset.upload', {
      id: 'media-uuid-1',
      path: '/sites/default/files/hero.png',
      title: 'hero.png',
      fields: { filename: 'hero.png', url: '/sites/default/files/hero.png' },
    });
    expect(p['@id']).toBe('/sites/default/files/hero.png');
    expect(p.image.download).toBe('/sites/default/files/hero.png');
    expect(p['@type']).toBe('Image');
  });

  it('splits query indexes into sortable and all', () => {
    const p = plonify('querystring.getIndexes', {
      Title: { title: 'Title', sortable: true, enabled: true, operations: [] },
      Sub: { title: 'Subject', sortable: false, enabled: true, operations: [] },
    });
    expect(Object.keys(p.indexes)).toEqual(['Title', 'Sub']);
    expect(Object.keys(p.sortable_indexes)).toEqual(['Title']);
  });
});

describe('BridgeApi transport selection', () => {
  it('uses the passthrough when the adapter advertises it', async () => {
    const rpc = { request: vi.fn().mockResolvedValue({}) };
    await new BridgeApi(rpc, { getAdapterInfo: passthroughAdapter }).get('/@querystring');
    expect(rpc.request).toHaveBeenCalledWith('http', expect.objectContaining({ op: 'get' }));
  });

  it('routes semantically when the adapter does not', async () => {
    const rpc = { request: vi.fn().mockResolvedValue(doc) };
    const out = await new BridgeApi(rpc, { getAdapterInfo: semanticAdapter }).get('/news/first-post');
    expect(rpc.request).toHaveBeenCalledWith('content.get', { path: '/news/first-post' });
    expect(out['@id']).toBe('/news/first-post');
  });

  it('folds Volto params into the path before matching', async () => {
    const rpc = { request: vi.fn().mockResolvedValue({ items: [], total: 0 }) };
    await new BridgeApi(rpc, { getAdapterInfo: semanticAdapter }).get('/news/@search', {
      params: { 'path.depth': '1' },
    });
    expect(rpc.request).toHaveBeenCalledWith('tree.list', { parent: '/news' });
  });

  it('performs every move of a bulk @move, in order', async () => {
    const rpc = { request: vi.fn().mockResolvedValue(doc) };
    await new BridgeApi(rpc, { getAdapterInfo: semanticAdapter }).post('/target/@move', {
      data: { source: ['/a/one', '/a/two'] },
    });
    expect(rpc.request.mock.calls).toEqual([
      ['content.move', { path: '/a/one', targetParentPath: '/target' }],
      ['content.move', { path: '/a/two', targetParentPath: '/target' }],
    ]);
  });

  it('fails loudly on an unroutable path rather than returning empty', async () => {
    const rpc = { request: vi.fn() };
    await expect(
      new BridgeApi(rpc, { getAdapterInfo: semanticAdapter }).get('/x/@history'),
    ).rejects.toThrow(/No canonical intent/);
    expect(rpc.request).not.toHaveBeenCalled();
  });

  /**
   * This used to assert the opposite — that an unannounced adapter was treated
   * as passthrough, on the reasoning that passthrough was the status quo.
   *
   * It is not a safe default, it is a guess about which CMS is connected. On
   * WordPress, whose frontend takes longer to register than the announce
   * timeout allowed, that guess sent the content GET and /@types, /@actions
   * and /@breadcrumbs down a passthrough the adapter does not implement. Six
   * 501s, no schema, and an edit form with no fields — while every call made
   * after the announcement worked, which made it read as flakiness.
   *
   * Refusing to route is worse for nobody and names the actual problem.
   */
  it('refuses to route rather than guess at an unannounced adapter', async () => {
    const rpc = { request: vi.fn().mockResolvedValue({}) };
    await expect(
      new BridgeApi(rpc, { getAdapterInfo: () => null }).get('/anything'),
    ).rejects.toThrow(/No adapter announced itself/);
    expect(rpc.request).not.toHaveBeenCalled();
  });
});
