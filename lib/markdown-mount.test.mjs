import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveLiteralIncludes, readTree, resolveMarkdownLink, resolveMediaUrl, resolveMarkdownLinksInBlocks, isMarkdownTree, resolveCodeExampleSources, schemaRegistryFromBlockDefinitions, decodeAuto, normalizeNestedUids } from './markdown-mount.mjs';

describe('resolveLiteralIncludes', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'li-'));
    writeFileSync(join(dir, 'ButtonBlock.jsx'), [
      "import { x } from './utils.js';",
      '// docs:start',
      'function ButtonBlock({ block }) {',
      '  return <a href={block.href} data-edit-text="title">{block.title}</a>;',
      '}',
      '// docs:end',
      'export default ButtonBlock;',
    ].join('\n'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const li = (opts) => `\`\`\`{literalinclude} ButtonBlock.jsx\n${opts}\n\`\`\``;

  it('inlines the whole file with an inferred language from the extension', () => {
    const out = resolveLiteralIncludes(li(''), dir);
    expect(out).toMatch(/^```jsx\n/);
    expect(out).toContain('function ButtonBlock');
    expect(out).toContain('export default');
  });

  it('slices with :start-after: / :end-before:, dropping imports/exports', () => {
    const out = resolveLiteralIncludes(li(':start-after: // docs:start\n:end-before: // docs:end'), dir);
    expect(out).toContain('function ButtonBlock');
    expect(out).not.toContain('import');
    expect(out).not.toContain('export default');
  });

  it('honors an explicit :language: and :lines:', () => {
    const out = resolveLiteralIncludes(li(':language: js\n:lines: 3-5'), dir);
    expect(out).toMatch(/^```js\n/);
    expect(out).toContain('function ButtonBlock');
    expect(out).not.toContain('docs:start');
  });

  it('slices with :start-at: / :end-at:, keeping the matched boundary lines', () => {
    // start-AT/end-AT include the matched line (unlike start-after/end-before),
    // so a slice can anchor on the block's own markup with no injected markers.
    const out = resolveLiteralIncludes(li(':start-at: function ButtonBlock\n:end-at: }'), dir);
    expect(out).toContain('function ButtonBlock({ block })');
    expect(out).not.toContain('import');
    expect(out).not.toContain('export default');
  });

  it('leaves ordinary code fences untouched', () => {
    const md = '```jsx\nconst x = 1;\n```';
    expect(resolveLiteralIncludes(md, dir)).toBe(md);
  });

  it('fails loudly on a missing file', () => {
    expect(() => resolveLiteralIncludes('```{literalinclude} nope.jsx\n```', dir)).toThrow(/not found/);
  });

  describe(':as: json — a .md include returns the decoded block JSON, not the raw markdown', () => {
    let mdDir, slice;
    const parseFence = (out) => JSON.parse(out.replace(/^```json\n/, '').replace(/\n```$/, ''));
    beforeAll(() => {
      mdDir = mkdtempSync(join(tmpdir(), 'li-md-'));
      slice = 'This is the example paragraph.';
      // The file carries its own prototypes, so the slice decodes to a slate block
      // exactly as it renders on the page. The include self-slices between markers.
      writeFileSync(join(mdDir, 'example.md'), [
        '---',
        'title: Example',
        'blocks-matched: |',
        '  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />',
        '---',
        '',
        '# Heading above',
        '',
        '<!-- example:start -->',
        slice,
        '<!-- example:end -->',
        '',
        '# Heading below',
      ].join('\n'));
    });
    afterAll(() => rmSync(mdDir, { recursive: true, force: true }));

    it('emits a ```json fence holding the single sliced block, uid stripped', () => {
      const out = resolveLiteralIncludes(
        '```{literalinclude} example.md\n:start-after: <!-- example:start -->\n:end-before: <!-- example:end -->\n:as: json\n```',
        mdDir,
      );
      expect(out).toMatch(/^```json\n/);
      const shown = parseFence(out);
      expect(shown['@type']).toBe('slate');
      expect(shown.value).toBeTruthy();          // the decoded slate value
      expect(shown['@uid']).toBeUndefined();     // runtime uid filtered out
    });

    it('a .md include WITHOUT :as: json still inlines the raw markdown text', () => {
      const out = resolveLiteralIncludes(
        '```{literalinclude} example.md\n:start-after: <!-- example:start -->\n:end-before: <!-- example:end -->\n```',
        mdDir,
      );
      expect(out).toContain(slice);
      expect(out).not.toMatch(/^```json\n/);
    });

    it('rejects :as: json on a non-.md file (only markdown decodes to blocks)', () => {
      expect(() => resolveLiteralIncludes(li(':as: json'), dir)).toThrow(/not a \.md file/);
    });

    describe(':block: — select one block by @type/uid (the :pyobject: analog)', () => {
      let selDir;
      beforeAll(() => {
        selDir = mkdtempSync(join(tmpdir(), 'li-blk-'));
        writeFileSync(join(selDir, 'page.md'), [
          '---',
          'title: Sel',
          'blocks-matched: |',
          '  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />',
          '---',
          '',
          'A paragraph before.',
          '',
          `<block type="card" data-json='{"title":"Hi","href":"/x"}' />`,
          '',
          'A paragraph after.',
        ].join('\n'));
      });
      afterAll(() => rmSync(selDir, { recursive: true, force: true }));

      it('selects the block by @type, ignoring the surrounding blocks', () => {
        const out = resolveLiteralIncludes(
          '```{literalinclude} page.md\n:block: card\n:as: json\n```',
          selDir,
        );
        const shown = JSON.parse(out.replace(/^```json\n/, '').replace(/\n```$/, ''));
        expect(shown['@type']).toBe('card');
        expect(shown.title).toBe('Hi');
        expect(shown['@uid']).toBeUndefined();
      });

      it('fails loud when :block: matches nothing', () => {
        expect(() => resolveLiteralIncludes(
          '```{literalinclude} page.md\n:block: nope\n:as: json\n```',
          selDir,
        )).toThrow(/matched no block/);
      });
    });
  });
});

describe('resolveMarkdownLink', () => {
  it('rewrites a relative .md link to a served path against the page dir', () => {
    expect(resolveMarkdownLink('selecting-blocks.md', 'docs/what-editors-will-experience'))
      .toBe('/docs/what-editors-will-experience/selecting-blocks');
    expect(resolveMarkdownLink('advanced/index.md', 'docs')).toBe('/docs/advanced');
    expect(resolveMarkdownLink('../architecture.md#chrome', 'docs/x')).toBe('/docs/architecture#chrome');
    expect(resolveMarkdownLink('foo.md', '')).toBe('/foo');
  });
  it('passes external, absolute, anchor and non-.md links through untouched', () => {
    for (const u of ['https://x.io/a', 'mailto:a@b.c', '#frag', '/docs/live-preview', '/x.md-ish'])
      expect(resolveMarkdownLink(u, 'docs')).toBe(u);
  });
  it('prepends the mount prefix so a cross-link matches the served @id', () => {
    // A /docs mount serves its tree under /docs; a sibling .md link must too.
    expect(resolveMarkdownLink('visual-editing.md', '', '/docs')).toBe('/docs/visual-editing');
    expect(resolveMarkdownLink('../architecture.md#chrome', 'what-editors', '/docs'))
      .toBe('/docs/architecture#chrome');
    expect(resolveMarkdownLink('index.md', '', '/docs')).toBe('/docs');
    expect(resolveMarkdownLink('foo.md', '', '')).toBe('/foo'); // '/' mount unchanged
  });
  it('rewrites only slate link nodes when walking blocks', () => {
    const blocks = { 's-1': { '@type': 'slate', value: [
      { type: 'link', data: { url: 'other.md' }, children: [{ text: 'x' }] },
      { type: 'link', data: { url: 'https://keep.me' }, children: [{ text: 'y' }] },
    ] } };
    resolveMarkdownLinksInBlocks(blocks, 'docs');
    expect(blocks['s-1'].value[0].data.url).toBe('/docs/other');
    expect(blocks['s-1'].value[1].data.url).toBe('https://keep.me');
  });
});

describe('resolveMediaUrl', () => {
  it('rewrites a relative image/video url to the served path against the page dir', () => {
    // a page at the site root pointing into another mounted tree
    expect(resolveMediaUrl('./docs/static/demo.mp4', '')).toBe('/docs/static/demo.mp4');
    expect(resolveMediaUrl('docs/static/demo.mp4', '')).toBe('/docs/static/demo.mp4');
    // a docs page pointing at a sibling image, keeping the filename (not a folder)
    expect(resolveMediaUrl('../images/x.png', 'examples', '/docs')).toBe('/docs/images/x.png');
    expect(resolveMediaUrl('shot.png', 'examples/form', '/docs')).toBe('/docs/examples/form/shot.png');
  });
  it('passes external, data, absolute and already-mounted urls through untouched', () => {
    for (const u of ['https://x.io/a.png', 'data:image/svg+xml,<svg/>', '/architecture.svg', '/docs/static/demo.mp4'])
      expect(resolveMediaUrl(u, 'examples', '/docs')).toBe(u);
  });
  it('rewrites image and video block urls when walking blocks', () => {
    const blocks = {
      'v-1': { '@type': 'video', url: './docs/static/demo.mp4' },
      'i-1': { '@type': 'image', url: '/architecture.svg' },
      'i-2': { '@type': 'image', url: 'shot.png' },
    };
    resolveMarkdownLinksInBlocks(blocks, '');
    expect(blocks['v-1'].url).toBe('/docs/static/demo.mp4');
    expect(blocks['i-1'].url).toBe('/architecture.svg'); // absolute untouched
    expect(blocks['i-2'].url).toBe('/shot.png');
  });
});

describe('readTree fills object_browser link summaries from the local target', () => {
  // The markdown mount stores a link to a local object as the bare, non-stale
  // reference `[{'@id':'/path'}]`. Volto snapshots the summary at edit time and
  // never re-resolves, so the DISTRIBUTION readTree builds (what gets imported)
  // must already carry the summary — otherwise the deployed teaser ships with no
  // title/description. The mock server re-resolves on serve, which would hide
  // this: the fill has to happen at decode/readTree, driven by the WIDGET (an
  // object_browser field), not the field name (`href` is object_browser on a
  // teaser but a plain url string on a card).
  const schemaFor = (t) =>
    t === 'teaser' ? { properties: { href: { widget: 'object_browser', mode: 'link' }, title: { type: 'string' } } }
    : t === 'card' ? { properties: { href: { widget: 'url' } } }
    : null;

  const seed = () => {
    const root = mkdtempSync(join(tmpdir(), 'mm-link-'));
    writeFileSync(join(root, 'target.md'),
      `---\n"@type": Document\nUID: tgtuid1234567\nid: target\ntitle: Target Page\ndescription: A described target\n---\n`);
    writeFileSync(join(root, 'source.md'), [
      '---', '"@type": Document', 'UID: srcuid1234567', 'id: source', '---', '',
      `<block type="teaser" data-json='{"href":[{"@id":"/target"}],"title":"See"}' />`, '',
    ].join('\n'));
    return root;
  };

  it('fills @type/Title/Description onto a bare object_browser link', () => {
    const root = seed();
    const { items } = readTree(root, { schemaFor });
    rmSync(root, { recursive: true, force: true });
    const teaser = Object.values(items.get('/source').blocks)[0];
    expect(teaser.href[0]['@id']).toBe('/target');
    expect(teaser.href[0].Title).toBe('Target Page');
    expect(teaser.href[0].Description).toBe('A described target');
    expect(teaser.href[0]['@type']).toBe('Document');
  });

  it('reproduces the exact Volto snapshot shape for a preview-bearing target', () => {
    // The fill must reconstitute the SAME object Volto snapshots at edit time,
    // so a source stripped to the bare `@id` deploys byte-identical to the fat
    // form it replaces. Mirrors the real `/docs/examples/content-types/page`
    // target (a Document with a preview_image).
    const root = mkdtempSync(join(tmpdir(), 'mm-link-full-'));
    writeFileSync(join(root, 'page.md'),
      `---\n"@type": Document\nUID: pageuid12345678\nid: page\ntitle: Page\ndescription: The Page content type.\npreview_image:\n  blob_path: page/preview.png\n---\n`);
    writeFileSync(join(root, 'source.md'), [
      '---', '"@type": Document', 'UID: srcuid1234567', 'id: source', '---', '',
      `<block type="teaser" data-json='{"href":[{"@id":"/page"}]}' />`, '',
    ].join('\n'));
    const { items } = readTree(root, { schemaFor });
    rmSync(root, { recursive: true, force: true });
    const teaser = Object.values(items.get('/source').blocks)[0];
    expect(teaser.href[0]).toEqual({
      '@id': '/page', '@type': 'Document', Title: 'Page', Description: 'The Page content type.',
      title: 'Page', head_title: null, getRemoteUrl: null, hasPreviewImage: true, image_field: 'preview_image',
    });
  });

  it('leaves a url-widget field (an external string) untouched', () => {
    const root = mkdtempSync(join(tmpdir(), 'mm-url-'));
    writeFileSync(join(root, 'source.md'), [
      '---', '"@type": Document', 'UID: srcuid1234567', 'id: source', '---', '',
      `<block type="card" data-json='{"href":"https://example.com"}' />`, '',
    ].join('\n'));
    const { items } = readTree(root, { schemaFor });
    rmSync(root, { recursive: true, force: true });
    const card = Object.values(items.get('/source').blocks)[0];
    expect(card.href).toBe('https://example.com');
  });
});

describe('README.md and index.md are the same folder landing', () => {
  const page = (fm) => `---\n${fm}\n---\n`;
  it('treats a README.md root as the site root, and a folder README.md as the folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'mm-readme-'));
    writeFileSync(join(root, 'README.md'), page('"@type": Document\nUID: root\nid: Plone'));
    mkdirSync(join(root, 'guide'), { recursive: true });
    writeFileSync(join(root, 'guide', 'README.md'), page('"@type": Document\nUID: g\nid: guide'));
    const { items } = readTree(root);
    expect(items.has('/')).toBe(true);           // root README -> /
    expect(items.has('/guide')).toBe(true);       // folder README -> /guide, not /guide/README
    expect(items.has('/guide/README')).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
  it('isMarkdownTree accepts a README.md-rooted tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'mm-rt-'));
    writeFileSync(join(root, 'README.md'), page('"@type": Document\nUID: r\nid: Plone'));
    expect(isMarkdownTree(root)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('readTree honors a top-level `.blockmdignore` (gitignore syntax)', () => {
  const page = (fm) => `---\n${fm}\n---\n`;
  it('never walks ignored paths into content — globs + nested anchors, from the top level', () => {
    // The docs/ dir serves triple duty (readable md + website + Sphinx source),
    // so alongside doc pages it holds build output and other trees. One top-level
    // `.blockmdignore`, standard git patterns matched against the path relative to
    // the root, names what is NOT content — replacing per-folder `exclude:`.
    const root = mkdtempSync(join(tmpdir(), 'mm-excl-'));
    writeFileSync(join(root, '.blockmdignore'), 'content/\n_build/\ntest-*\nexamples/examples/\n');
    writeFileSync(join(root, 'index.md'), page('"@type": Document\nUID: root\nid: Plone'));
    writeFileSync(join(root, 'architecture.md'), page('"@type": Document\nUID: a\nid: architecture'));
    for (const infra of ['content', '_build']) {
      mkdirSync(join(root, infra), { recursive: true });
      writeFileSync(join(root, infra, 'stray.md'), 'no frontmatter, would break decode\n');
    }
    // `examples/` is content, but its nested `examples/examples/` and any `test-*`
    // are not — an anchored pattern and a glob both match from the top level.
    mkdirSync(join(root, 'examples'), { recursive: true });
    writeFileSync(join(root, 'examples', 'index.md'), page('"@type": Document\nUID: e\nid: examples'));
    writeFileSync(join(root, 'examples', 'button.md'), page('"@type": Document\nUID: b\nid: button'));
    for (const infra of ['test-react', 'examples']) {
      mkdirSync(join(root, 'examples', infra), { recursive: true });
      writeFileSync(join(root, 'examples', infra, 'stray.md'), 'no frontmatter\n');
    }

    const { items } = readTree(root);
    expect(items.has('/')).toBe(true);
    expect(items.has('/architecture')).toBe(true);
    expect(items.has('/examples/button')).toBe(true);
    expect([...items.keys()].some((k) => k.includes('stray'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('does NOT silently swallow a bad page in a non-ignored location (fail loud)', () => {
    const root = mkdtempSync(join(tmpdir(), 'mm-excl2-'));
    writeFileSync(join(root, '.blockmdignore'), 'content/\n');
    writeFileSync(join(root, 'index.md'), page('"@type": Document\nUID: root\nid: Plone'));
    writeFileSync(join(root, 'broken.md'), 'no frontmatter here\n');
    expect(() => readTree(root)).toThrow(/frontmatter/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('resolveCodeExampleSources — a codeExample derives from a sibling block / schema registry', () => {
  const schemaFor = schemaRegistryFromBlockDefinitions({
    accordion: { blocks: { accordion: { blockSchema: { properties: { panels: { widget: 'object_list' } } } } } },
  });
  const page = () => ({
    blocks: {
      'accordion-4': { '@type': 'accordion', panels: [{ '@id': 'p1', title: 'FAQ' }], right_arrows: true },
      'ce-json': { '@type': 'codeExample', slotId: 'json-data', source: 'accordion', format: 'json' },
      'ce-schema': { '@type': 'codeExample', slotId: 'schema', source: 'accordion', format: 'schema' },
    },
    blocks_layout: { items: ['accordion-4', 'ce-json', 'ce-schema'] },
  });

  it('format=json shows the referenced block data; format=schema shows the registry schema — no hand copy', () => {
    const p = page();
    resolveCodeExampleSources(p, { schemaFor });
    const jsonTab = p.blocks['ce-json'].tabs[0];
    expect(jsonTab.language).toBe('json');
    expect(JSON.parse(jsonTab.code)).toEqual({ '@type': 'accordion', panels: [{ '@id': 'p1', title: 'FAQ' }], right_arrows: true });
    const schemaTab = p.blocks['ce-schema'].tabs[0];
    expect(JSON.parse(schemaTab.code)).toEqual({ properties: { panels: { widget: 'object_list' } } });
  });

  it('resolves a selector by block uid too', () => {
    const p = page();
    p.blocks['ce-json'].source = 'accordion-4'; // uid, not @type
    resolveCodeExampleSources(p, { schemaFor });
    expect(JSON.parse(p.blocks['ce-json'].tabs[0].code)['@type']).toBe('accordion');
  });

  it('fails loud on a selector that matches no block, or a type with no schema', () => {
    const p1 = page(); p1.blocks['ce-json'].source = 'nope';
    expect(() => resolveCodeExampleSources(p1, { schemaFor })).toThrow(/nope/);
    const p2 = page(); p2.blocks['ce-schema'].source = 'video';
    expect(() => resolveCodeExampleSources(p2, { schemaFor })).toThrow(/video/);
  });

  it('builds the registry from the flat sharedBlocksConfig shape too', () => {
    const flat = schemaRegistryFromBlockDefinitions({
      listing: { id: 'listing', blockSchema: { fieldsets: [{ id: 'default' }] } },
      accordion: { blockSchema: { properties: { panels: {} } } },
    });
    expect(flat('listing')).toEqual({ fieldsets: [{ id: 'default' }] });
    expect(flat('accordion')).toEqual({ properties: { panels: {} } });
    expect(flat('nope')).toBeUndefined();
  });

  it('leaves a literalinclude/literal codeExample (no source) untouched', () => {
    const p = { blocks: { 'ce-lit': { '@type': 'codeExample', tabs: [{ language: 'jsx', code: 'x' }] } }, blocks_layout: { items: ['ce-lit'] } };
    resolveCodeExampleSources(p, { schemaFor });
    expect(p.blocks['ce-lit'].tabs).toEqual([{ language: 'jsx', code: 'x' }]);
  });
});

describe("readTree registers a content item's own image/file blob", () => {
  let dir;
  const page = (fm) => `---\n${fm}\n---\n`;
  const seedRoot = (d) =>
    writeFileSync(join(d, 'index.md'), page('"@type": Document\nUID: root-uid\nid: Plone'));

  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'mm-blob-')); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('registers the bytes under the item path when the referenced file exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'mm-ok-'));
    seedRoot(root);
    mkdirSync(join(root, 'news/image'), { recursive: true });
    // A leadimage: an `image:` field on the item itself (not a `blobs:` child),
    // with a root-relative blob_path, exactly as an exported News Item carries.
    writeFileSync(join(root, 'news.md'), page(
      '"@type": News Item\nUID: n1\nid: news\n' +
      'image:\n  blob_path: news/image/pic.jpg\n  filename: pic.jpg\n  content-type: image/jpeg'));
    writeFileSync(join(root, 'news/image/pic.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const { items, blobFiles } = readTree(root);
    // The News Item keeps its image field...
    expect(items.get('/news').image.blob_path).toBe('news/image/pic.jpg');
    // ...and its bytes are registered under the item's own path, so the server
    // (and an export) can resolve them the same way it resolves a `blobs:` child.
    expect(blobFiles.get('/news')).toBe(join(root, 'news/image/pic.jpg'));
    rmSync(root, { recursive: true, force: true });
  });

  it('warns (does not throw) when a declared image/file blob file is absent, serving the item without bytes', () => {
    // Generated images (editor screenshots, demo video) are git-ignored and may
    // be absent on a fresh checkout / cache miss — the mount must still boot so
    // those very images can be generated against it (chicken-and-egg). A missing
    // blob file is a warning; its bytes 404 until regenerated. The fatal check
    // that all referenced media exist runs LAST, after generation.
    const root = mkdtempSync(join(tmpdir(), 'mm-bad-'));
    seedRoot(root);
    writeFileSync(join(root, 'news.md'), page(
      '"@type": News Item\nUID: n1\nid: news\nimage:\n  blob_path: news/image/gone.jpg'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { items, blobFiles } = readTree(root);
    expect(items.has('/news')).toBe(true);       // item still served
    expect(blobFiles.has('/news')).toBe(false);  // but no bytes registered
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('gone.jpg'));
    warn.mockRestore();
    rmSync(root, { recursive: true, force: true });
  });

  it('warns (does not throw) when a `blobs:` child file is absent — registers the item, skips only the bytes', () => {
    // The item must still be registered so the content GRAPH stays complete: an
    // image block referencing /images/gone.pdf resolves to a real item, so
    // discovery / checkIntegrity don't flag it. Only the bytes are missing (the
    // blob 404s until regenerated); page-integrity (sanity, after generation) is
    // what notices a truly-absent image, not the mount or discovery.
    const root = mkdtempSync(join(tmpdir(), 'mm-blobmiss-'));
    seedRoot(root);
    mkdirSync(join(root, 'images'), { recursive: true });
    writeFileSync(join(root, 'images', 'here.pdf'), Buffer.from('%PDF-1.4'));
    writeFileSync(join(root, 'images', 'index.md'), page(
      '"@type": Document\nUID: imgs\nid: images\n' +
      'blobs:\n  - file: here.pdf\n    uid: b-here\n  - file: gone.pdf\n    uid: b-gone'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { items, blobFiles } = readTree(root);
    expect(items.has('/images/here.pdf')).toBe(true);      // present blob: item + bytes
    expect(items.has('/images/gone.pdf')).toBe(true);      // absent blob: item registered (graph complete)
    expect(blobFiles.has('/images/here.pdf')).toBe(true);
    expect(blobFiles.has('/images/gone.pdf')).toBe(false); // ...but no bytes
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('gone.pdf'));
    warn.mockRestore();
    rmSync(root, { recursive: true, force: true });
  });
});
