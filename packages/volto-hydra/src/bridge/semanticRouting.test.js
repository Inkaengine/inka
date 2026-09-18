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
    ['post', '/target/@move', 'content.move'],
  ])('%s %s -> %s', (op, path, intent) => {
    expect(routeToIntent({ op, path, data: {} })?.intent).toBe(intent);
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
