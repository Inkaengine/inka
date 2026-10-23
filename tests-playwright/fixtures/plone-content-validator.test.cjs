const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { validate, checkIntegrity, checkBlockSchemas, fieldMapFromSchemas } = require('./plone-content-validator.cjs');

/**
 * Build a minimal plone.exportimport content tree under a temp dir.
 * Returns the content dir path. Caller is responsible for cleanup.
 */
function buildFixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plone-content-test-'));
  const contentDir = path.join(root, 'content');
  fs.mkdirSync(contentDir);
  // Required sibling files for validate()
  for (const sib of ['discussions.json', 'portlets.json', 'principals.json', 'redirects.json']) {
    fs.writeFileSync(path.join(root, sib), '{}');
  }

  const dataFiles = overrides.dataFiles || ['plone_site_root/data.json', 'page-a/data.json'];
  const blobFiles = overrides.blobFiles || [];
  // Default local_roles covers the default fixture's two UIDs. Tests that
  // add new content can still override _data_files_ here, but they're
  // expected to handle their own local_roles via metadata overrides
  // (or accept the UID-coverage error they're testing for).
  const localRoles = overrides.localRoles || {
    rootuid1234567: { local_roles: { admin: ['Owner'] } },
    pageauid1234567: { local_roles: { admin: ['Owner'] } },
  };
  fs.writeFileSync(
    path.join(contentDir, '__metadata__.json'),
    JSON.stringify({
      _data_files_: dataFiles,
      _blob_files_: blobFiles,
      local_roles: localRoles,
    }, null, 2),
  );

  const rootItem = {
    '@id': '/',
    '@type': 'Plone Site',
    id: 'plone_site_root',
    UID: 'rootuid1234567',
    ...overrides.rootItem,
  };
  fs.mkdirSync(path.join(contentDir, 'plone_site_root'));
  fs.writeFileSync(path.join(contentDir, 'plone_site_root', 'data.json'), JSON.stringify(rootItem));

  const pageA = overrides.pageA || {
    '@id': '/page-a',
    '@type': 'Document',
    id: 'page-a',
    UID: 'pageauid1234567',
    parent: { '@id': '/' },
  };
  fs.mkdirSync(path.join(contentDir, 'page-a'));
  fs.writeFileSync(path.join(contentDir, 'page-a', 'data.json'), JSON.stringify(pageA));

  return { root, contentDir };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

describe('plone-content-validator validate()', () => {
  it('returns no errors on a clean fixture', () => {
    const { root, contentDir } = buildFixture();
    const r = validate(contentDir);
    cleanup(root);
    assert.deepEqual(r.errors, []);
    assert.equal(r.stats.dataFiles, 2);
  });

  it('reports missing parent container', () => {
    const { root, contentDir } = buildFixture({
      dataFiles: ['plone_site_root/data.json', 'section/child/data.json'],
    });
    fs.mkdirSync(path.join(contentDir, 'section'), { recursive: true });
    fs.mkdirSync(path.join(contentDir, 'section', 'child'), { recursive: true });
    fs.writeFileSync(
      path.join(contentDir, 'section', 'child', 'data.json'),
      JSON.stringify({ '@id': '/section/child', '@type': 'Document', id: 'child', UID: 'x'.repeat(15), parent: {} }),
    );
    const r = validate(contentDir);
    cleanup(root);
    assert.ok(r.errors.some((e) => e.includes('parent container missing')), r.errors.join('\n'));
  });

  it('reports Image with remote URL instead of blob_path', () => {
    const { root, contentDir } = buildFixture({
      dataFiles: ['plone_site_root/data.json', 'my-image/data.json'],
      pageA: {
        '@id': '/my-image',
        '@type': 'Image',
        id: 'my-image',
        UID: 'img1234567890',
        parent: { '@id': '/' },
        image: { download: 'https://example.com/remote.jpg' },
      },
    });
    // buildFixture wrote page-a, but we also need my-image at the path
    fs.mkdirSync(path.join(contentDir, 'my-image'), { recursive: true });
    fs.writeFileSync(
      path.join(contentDir, 'my-image', 'data.json'),
      JSON.stringify({
        '@id': '/my-image', '@type': 'Image', id: 'my-image',
        UID: 'img1234567890', parent: {}, image: { download: 'https://example.com/remote.jpg' },
      }),
    );
    // Remove page-a so the only Image we check is my-image
    fs.rmSync(path.join(contentDir, 'page-a'), { recursive: true });
    fs.writeFileSync(
      path.join(contentDir, '__metadata__.json'),
      JSON.stringify({ _data_files_: ['plone_site_root/data.json', 'my-image/data.json'], _blob_files_: [] }, null, 2),
    );
    const r = validate(contentDir);
    cleanup(root);
    assert.ok(r.errors.some((e) => e.includes('remote URL')), r.errors.join('\n'));
  });

  // A File's blob is just as shippable as an Image's, and just as easy to leave
  // behind: git can hold a data.json promising a 374KB video with nothing at the
  // blob_path. That is how the homepage hero video came to be referenced by a
  // tracked data.json while the mp4 itself was git-ignored — validation passed,
  // and the deployed page served a 404.
  it('reports File with blob_path pointing at a missing file', () => {
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a',
        '@type': 'File',
        id: 'page-a',
        UID: 'pageauid1234567',
        parent: { '@id': '/' },
        file: {
          blob_path: 'page-a/file/hero.mp4',
          'content-type': 'video/mp4',
          filename: 'hero.mp4',
          size: 374638,
        },
      },
    });
    const r = validate(contentDir);
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes('blob_path file missing')),
      `expected a missing-blob error, got: ${r.errors.join('\n') || '(none)'}`,
    );
  });

  it('accepts a File whose blob_path exists', () => {
    const { root, contentDir } = buildFixture({
      blobFiles: ['page-a/file/hero.mp4'],
      pageA: {
        '@id': '/page-a',
        '@type': 'File',
        id: 'page-a',
        UID: 'pageauid1234567',
        parent: { '@id': '/' },
        file: {
          blob_path: 'page-a/file/hero.mp4',
          'content-type': 'video/mp4',
          filename: 'hero.mp4',
          size: 4,
        },
      },
    });
    fs.mkdirSync(path.join(contentDir, 'page-a', 'file'), { recursive: true });
    fs.writeFileSync(path.join(contentDir, 'page-a', 'file', 'hero.mp4'), 'data');
    const r = validate(contentDir);
    cleanup(root);
    assert.deepEqual(r.errors, []);
  });

  it('reports child before parent in _data_files_ ordering', () => {
    const { root, contentDir } = buildFixture({
      dataFiles: [
        'plone_site_root/data.json',
        'section/child/data.json',  // child first
        'section/data.json',        // parent second (wrong order)
      ],
    });
    for (const rel of ['section', 'section/child']) {
      fs.mkdirSync(path.join(contentDir, rel), { recursive: true });
      fs.writeFileSync(
        path.join(contentDir, rel, 'data.json'),
        JSON.stringify({ '@id': '/' + rel, '@type': 'Document', id: rel.split('/').pop(), UID: rel + '1234567', parent: {} }),
      );
    }
    const r = validate(contentDir);
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes('appears before its parent')),
      r.errors.join('\n'),
    );
  });

  // The two tests above use path-shaped directories (section/child/data.json).
  // Real distributions are UID-keyed and FLAT — every data.json sits in its own
  // <uid>/ dir and the hierarchy lives ONLY in the `@id` field. Deriving the
  // parent from the directory path silently no-ops on that layout, which is how
  // 90 of 150 objects got dropped at import with nothing going red.
  it('reports child before parent in a UID-keyed (flat) layout', () => {
    const { root, contentDir } = buildFixture({
      dataFiles: [
        'plone_site_root/data.json',
        'childuid12345678/data.json',   // /components/card — child first
        'parentuid1234567/data.json',   // /components      — parent second
      ],
    });
    const flat = {
      childuid12345678: { '@id': '/components/card', id: 'card' },
      parentuid1234567: { '@id': '/components', id: 'components' },
    };
    for (const [uid, item] of Object.entries(flat)) {
      fs.mkdirSync(path.join(contentDir, uid), { recursive: true });
      fs.writeFileSync(
        path.join(contentDir, uid, 'data.json'),
        JSON.stringify({ ...item, '@type': 'Document', UID: uid }),
      );
    }
    const r = validate(contentDir);
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes('appears before its parent')),
      r.errors.join('\n'),
    );
  });

  it('reports a missing parent container in a UID-keyed (flat) layout', () => {
    const { root, contentDir } = buildFixture({
      dataFiles: ['plone_site_root/data.json', 'orphanuid1234567/data.json'],
    });
    fs.mkdirSync(path.join(contentDir, 'orphanuid1234567'), { recursive: true });
    fs.writeFileSync(
      path.join(contentDir, 'orphanuid1234567', 'data.json'),
      JSON.stringify({
        '@id': '/editing/pages', '@type': 'Document', id: 'pages', UID: 'orphanuid1234567',
      }),
    );
    const r = validate(contentDir);
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes('parent container missing')),
      r.errors.join('\n'),
    );
  });

  it('accepts a correctly ordered UID-keyed (flat) layout', () => {
    const { root, contentDir } = buildFixture({
      dataFiles: [
        'plone_site_root/data.json',
        'parentuid1234567/data.json',   // parent first
        'childuid12345678/data.json',   // child second
      ],
    });
    const flat = {
      parentuid1234567: { '@id': '/components', id: 'components' },
      childuid12345678: { '@id': '/components/card', id: 'card' },
    };
    for (const [uid, item] of Object.entries(flat)) {
      fs.mkdirSync(path.join(contentDir, uid), { recursive: true });
      fs.writeFileSync(
        path.join(contentDir, uid, 'data.json'),
        JSON.stringify({ ...item, '@type': 'Document', UID: uid }),
      );
    }
    const r = validate(contentDir);
    cleanup(root);
    assert.ok(
      !r.errors.some((e) => e.includes('appears before its parent') || e.includes('parent container missing')),
      r.errors.join('\n'),
    );
  });

  // A child whose id shadows an attribute the FTI machinery reads makes its
  // CONTAINER un-serializable: BTreeFolder2Base.__getattr__ resolves the name
  // out of _tree, so getViewMethod's `getattr(aq_base(context), "layout")`
  // returns the child object, calls it unwrapped, and plone.restapi 500s with
  // `AttributeError: REQUEST`. /components died this way in production.
  it('reports a content id that shadows the layout attribute', () => {
    const { root, contentDir } = buildFixture({
      dataFiles: ['plone_site_root/data.json', 'shadowuid1234567/data.json'],
    });
    fs.mkdirSync(path.join(contentDir, 'shadowuid1234567'), { recursive: true });
    fs.writeFileSync(
      path.join(contentDir, 'shadowuid1234567', 'data.json'),
      JSON.stringify({
        '@id': '/page-a/layout', '@type': 'Document', id: 'layout',
        UID: 'shadowuid1234567',
      }),
    );
    const r = validate(contentDir);
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes('reserved')),
      r.errors.join('\n'),
    );
  });

  it('reports id starting with underscore', () => {
    const { root, contentDir } = buildFixture({
      dataFiles: ['plone_site_root/data.json', '_underscore/data.json'],
    });
    fs.mkdirSync(path.join(contentDir, '_underscore'), { recursive: true });
    fs.writeFileSync(
      path.join(contentDir, '_underscore', 'data.json'),
      JSON.stringify({
        '@id': '/_underscore', '@type': 'Document',
        id: '_underscore', UID: 'undr1234567890', parent: {},
      }),
    );
    fs.rmSync(path.join(contentDir, 'page-a'), { recursive: true });
    fs.writeFileSync(
      path.join(contentDir, '__metadata__.json'),
      JSON.stringify({
        _data_files_: ['plone_site_root/data.json', '_underscore/data.json'],
        _blob_files_: [],
      }, null, 2),
    );
    const r = validate(contentDir);
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes('starts with underscore')),
      r.errors.join('\n'),
    );
  });

  it("reports top-level 'content' key in __metadata__.json", () => {
    const { root, contentDir } = buildFixture();
    fs.writeFileSync(
      path.join(contentDir, '__metadata__.json'),
      JSON.stringify({
        _data_files_: ['plone_site_root/data.json', 'page-a/data.json'],
        _blob_files_: [],
        // Wrong key — Plone import will reject as unknown kwarg.
        content: { 'pageauid1234567': { local_roles: { admin: ['Owner'] } } },
      }, null, 2),
    );
    const r = validate(contentDir);
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes("'content' key")),
      r.errors.join('\n'),
    );
  });

  it('accepts content with NO local_roles (optional for plone.distribution)', () => {
    // local_roles is generated/defaulted on import, not required: plone.distribution
    // imports items fine when it is absent and defaults them to admin ownership.
    // The REAL pretagov __metadata__.json ships no local_roles key at all and is
    // deployed live (197 items). An earlier version of this test asserted the
    // OPPOSITE — that missing local_roles is an error — which would have rejected
    // that valid distribution. Assert the true behavior instead.
    const { root, contentDir } = buildFixture({
      localRoles: {},
    });
    const r = validate(contentDir);
    cleanup(root);
    assert.ok(
      !r.errors.some((e) => e.includes('local_roles')),
      `local_roles must not be required, got: ${r.errors.join('\n')}`,
    );
  });

  it('catches underscore id in NESTED data.json (not just direct children)', () => {
    const { root, contentDir } = buildFixture({
      dataFiles: [
        'plone_site_root/data.json',
        'page-a/data.json',
        'page-a/_bad/data.json',
      ],
    });
    fs.mkdirSync(path.join(contentDir, 'page-a', '_bad'), { recursive: true });
    fs.writeFileSync(
      path.join(contentDir, 'page-a', '_bad', 'data.json'),
      JSON.stringify({
        '@id': '/page-a/_bad', '@type': 'Document',
        id: '_bad', UID: 'badbadbadbad12', parent: {},
      }),
    );
    fs.writeFileSync(
      path.join(contentDir, '__metadata__.json'),
      JSON.stringify({
        _data_files_: [
          'plone_site_root/data.json',
          'page-a/data.json',
          'page-a/_bad/data.json',
        ],
        _blob_files_: [],
      }, null, 2),
    );
    const r = validate(contentDir);
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes('_bad') && e.includes('starts with underscore')),
      r.errors.join('\n'),
    );
  });
});

/**
 * redirects.json: judge CONSISTENCY, not conformance.
 *
 * plone.exportimport's importer hands each pair to plone.app.redirector's
 * storage as is, and that storage is keyed by PHYSICAL path (/Plone/old) —
 * which is what a raw export writes. A site-relative "/old" sitting among
 * physical ones is stored where no request looks: deploys green, 404s forever.
 * That MIX is the bug.
 *
 * A wholly site-relative file is a different thing. A consumer may convert the
 * raw export into a site-relative tree on purpose — pretagov's
 * convert-export-to-local.py strips the site prefix from redirect keys and
 * values — and demanding the prefix there is undone by the next export, so the
 * check would churn forever against redirects that demonstrably work (verified:
 * /about/about-us 302s on the live API). Previously this file was rejected
 * outright, which is why that rule is now about mixing.
 */
describe('plone-content-validator redirects.json paths', () => {
  const withRedirects = (redirects) => {
    const fixture = buildFixture({ rootItem: { '@id': '/Plone' } });
    fs.writeFileSync(path.join(fixture.root, 'redirects.json'), JSON.stringify(redirects));
    return fixture;
  };

  it('accepts redirects under the site root\'s physical path', () => {
    const { root, contentDir } = withRedirects({ '/Plone/old': '/Plone/page-a' });
    const r = validate(contentDir);
    cleanup(root);
    assert.deepEqual(r.errors, []);
  });

  it('accepts a WHOLLY site-relative file (a converted tree)', () => {
    // Was rejected outright. A converted tree strips the site prefix by
    // design, so requiring it here fights the converter and churns every
    // export, against redirects that work.
    const { root, contentDir } = withRedirects({ '/old': '/page-a', '/x': '/y' });
    const r = validate(contentDir);
    cleanup(root);
    assert.deepEqual(r.errors, []);
  });

  it('reports a MIX of physical and site-relative (the ones that never fire)', () => {
    const { root, contentDir } = withRedirects({
      '/Plone/old': '/Plone/page-a',
      '/stray': '/Plone/page-a',
    });
    const r = validate(contentDir);
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes('mixes physical and site-relative') && e.includes('"/stray"')),
      r.errors.join('\n'),
    );
  });

  it('reports a mixed pair whose target alone is site-relative', () => {
    const { root, contentDir } = withRedirects({ '/Plone/old': '/page-a' });
    const r = validate(contentDir);
    cleanup(root);
    assert.ok(r.errors.some((e) => e.includes('"/page-a"')), r.errors.join('\n'));
  });
});

describe('plone-content-validator checkIntegrity()', () => {
  // A template definition need not name itself: its blocks hold slots and no
  // templateId, and where it lives already says what it is.
  describe('a definition that does not name itself', () => {
    const definition = {
      '@id': '/templates/frame', '@type': 'Document', id: 'frame', UID: 'frame-uid',
      blocks: {
        head: { '@type': 'slate', fixed: true, readOnly: true, slotId: 'head' },
        body: { '@type': 'slate', fixed: false, slotId: 'body' },
      },
      blocks_layout: { items: ['head', 'body'] },
    };
    const page = (fill) => ({
      '@id': '/p', '@type': 'Document', id: 'p', UID: 'page-uid',
      blocks: { f: { '@type': 'slate', templateId: '/templates/frame', slotId: 'body', fixed: false, ...fill } },
      blocks_layout: { items: ['f'] },
    });
    const fillErrors = (items) =>
      checkIntegrity(items).errors.filter((e) => e.includes('fills template'));

    it('is not reported as a page filling a template', () => {
      assert.deepEqual(fillErrors([{ rel: '/templates/frame', data: definition }]), []);
    });

    it('still has the pages that fill it checked — for slotId', () => {
      const items = (fill) => [
        { rel: '/templates/frame', data: definition },
        { rel: '/p', data: page(fill) },
      ];
      // readOnly is NOT required on a page block. It is authored on the
      // template, and on an instance absent and false are indistinguishable
      // everywhere they are read.
      assert.deepEqual(fillErrors(items({ readOnly: false })), []);
      assert.deepEqual(fillErrors(items({})), []);

      // slotId is required, because the merge matches by it and silently drops
      // a block that has none.
      const noSlot = fillErrors([
        { rel: '/templates/frame', data: definition },
        {
          rel: '/p',
          data: {
            '@id': '/p', '@type': 'Document', id: 'p', UID: 'page-uid',
            blocks: { f: { '@type': 'slate', templateId: '/templates/frame' } },
            blocks_layout: { items: ['f'] },
          },
        },
      ]);
      assert.ok(noSlot.some((e) => e.includes('/p') && e.includes('slotId')), noSlot.join('\n'));
    });
  });

  it('flags broken resolveuid refs', () => {
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a',
        '@type': 'Document',
        id: 'page-a',
        UID: 'pageauid1234567',
        parent: { '@id': '/' },
        // Reference a UID that doesn't exist in the tree
        body: 'See <a href="resolveuid/deadbeefdeadbeef">this</a>',
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.ok(r.errors.some((e) => e.includes('broken resolveuid')), r.errors.join('\n'));
    assert.equal(r.stats.resolveuidBroken, 1);
  });

  it('resolves a readable UID the way the mock does, and flags one that names nothing', () => {
    // Test fixtures carry readable UIDs (`test-image-1-uid`); the mock resolves
    // `resolveuid/<[a-z0-9-]+>`. Matching only hex left these as "unrecognized
    // reference form" — or, in free text, unchecked altogether.
    const image = { '@id': '/img', '@type': 'Image', id: 'img', UID: 'test-image-1-uid', image: { data: 'x' } };
    const page = (uid) => ({
      '@id': '/p', '@type': 'Document', id: 'p', UID: 'page-uid',
      blocks: { i: { '@type': 'image', url: `resolveuid/${uid}` } },
      blocks_layout: { items: ['i'] },
    });
    const ok = checkIntegrity([{ rel: '/img', data: image }, { rel: '/p', data: page('test-image-1-uid') }]);
    assert.deepEqual(ok.errors.filter((e) => e.includes('resolveuid') || e.includes('reference form')), []);
    const bad = checkIntegrity([{ rel: '/img', data: image }, { rel: '/p', data: page('no-such-uid') }]);
    assert.ok(bad.errors.some((e) => e.includes('broken resolveuid/no-such-uid')), bad.errors.join('\n'));
  });

  it('FAILS on a multi-node slate value (must be a single top-level node)', () => {
    // The editor makes one block per paragraph, and a paragraph boundary is a
    // block boundary, so a slate value with >1 top-level node (a title + body
    // packed into one block) has no bare-markdown spelling. lib/slate-normalize
    // collapses it; a multi-block cell belongs in a `columns` block instead.
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a', '@type': 'Document', id: 'page-a',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: {
          s: {
            '@type': 'slate',
            value: [
              { type: 'p', children: [{ type: 'strong', children: [{ text: 'Title' }] }] },
              { type: 'p', children: [{ text: 'Body paragraph.' }] },
            ],
          },
        },
        blocks_layout: { items: ['s'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.ok(r.errors.some((e) => e.includes('top-level nodes')), r.errors.join('\n'));
  });

  it('FAILS on a template block with no templateId', () => {
    // A forced-layout template's blocks are matched to a page's region by
    // templateId + slotId. A block carrying only slotId is silently skipped by
    // the expansion: no error anywhere, the block simply never renders. That
    // cost an hour of "why is my footer button missing" — the validator, the
    // schema gate and block-sanity were all green while it was broken.
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/templates/thing', '@type': 'Document', id: 'thing',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: {
          good: { '@type': 'slate', templateId: 'resolveuid/pageauid1234567', slotId: 'good' },
          orphan: { '@type': 'slate', slotId: 'orphan' },
        },
        blocks_layout: { items: ['good', 'orphan'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.ok(r.errors.some((e) => e.includes('orphan') && e.includes('templateId')),
      r.errors.join('\n'));
  });

  it('FAILS on a NESTED template block with no templateId', () => {
    // The drop is not a top-level rule. fillRegionEntries runs for EVERY region
    // at every depth and opens with
    //     if (!child || !child.templateId) continue; // orphan / missing → drop
    // so a block two levels down goes the same way — and takes its own children
    // with it, because they are only reachable through it.
    //
    // Measured, not assumed: dropping `templateId` from ONE widget nested inside
    // a footer column took that widget and its three address/phone slates out of
    // the merged footer (4 widgets/8 leaves -> 3/5). Dropping `slotId` from the
    // same widget changed nothing. That is the shape a real footer shipped in,
    // and every gate was green while the content was gone.
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/templates/thing', '@type': 'Document', id: 'thing',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: {
          row: {
            '@type': 'columns', templateId: 'resolveuid/pageauid1234567', slotId: 'row', fixed: true, readOnly: true,
            blocks: {
              col: {
                '@type': 'column', templateId: 'resolveuid/pageauid1234567', slotId: 'col', fixed: true, readOnly: true,
                blocks: {
                  buried: { '@type': 'slate', slotId: 'buried', fixed: true, readOnly: true },
                },
                blocks_layout: { items: ['buried'] },
              },
            },
            blocks_layout: { columns: ['col'] },
          },
        },
        blocks_layout: { items: ['row'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.ok(r.errors.some((e) => e.includes('buried') && e.includes('templateId')),
      r.errors.join('\n'));
  });

  it('FAILS on a nested SLOT with no slotId', () => {
    // A non-fixed child is a placeholder the page fills, matched by slotId
    // (`else if (child.slotId)`). Without one it matches neither branch of
    // fillRegionEntries and is dropped just as silently.
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/templates/thing', '@type': 'Document', id: 'thing',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: {
          row: {
            '@type': 'columns', templateId: 'resolveuid/pageauid1234567', slotId: 'row', fixed: true, readOnly: true,
            blocks: {
              nameless: { '@type': 'slate', templateId: 'resolveuid/pageauid1234567', fixed: false },
            },
            blocks_layout: { columns: ['nameless'] },
          },
        },
        blocks_layout: { items: ['row'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.ok(r.errors.some((e) => e.includes('nameless') && e.includes('slotId')),
      r.errors.join('\n'));
  });

  it('REPORTS an untagged block inside a non-fixed SLOT', () => {
    // This used to pass, on the reasoning that a slot's children are the
    // PAGE's content and so need no tags of their own — true of the merge as
    // it runs today, and /templates/contact-cta ships exactly this shape: a
    // `fixed: false` section whose `cta-btn` carries nothing, which does come
    // through intact.
    //
    // But it comes through intact only because of that one flag. A template is
    // the authored source of truth, and an untagged block in one says nothing
    // about who owns it. Set the section `fixed: true` — an ordinary change —
    // and fillRegionEntries drops the button on its first rule,
    // `if (!child || !child.templateId) continue`, silently, from every page
    // using the template. The sibling /templates/contact-cta-info tags the
    // same button, so the tagged shape is already the house style.
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/templates/thing', '@type': 'Document', id: 'thing',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: {
          slot: {
            '@type': 'section', templateId: 'resolveuid/pageauid1234567', slotId: 'slot', fixed: false,
            blocks: { btn: { '@type': 'button' } },
            blocks_layout: { items: ['btn'] },
          },
        },
        blocks_layout: { items: ['slot'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.ok(r.errors.some((e) => e.includes('btn') && e.includes('slotId')),
      r.errors.join('\n') || '(no error raised)');
  });

  it('PASSES a fully-tagged nested template', () => {
    const tag = (extra) => ({ templateId: 'resolveuid/pageauid1234567', fixed: true, readOnly: true, ...extra });
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/templates/thing', '@type': 'Document', id: 'thing',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: {
          row: {
            ...tag({ '@type': 'columns', slotId: 'row' }),
            blocks: {
              col: {
                ...tag({ '@type': 'column', slotId: 'col' }),
                blocks: { leaf: tag({ '@type': 'slate', slotId: 'leaf' }) },
                blocks_layout: { items: ['leaf'] },
              },
            },
            blocks_layout: { columns: ['col'] },
          },
        },
        blocks_layout: { items: ['row'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.ok(!r.errors.some((e) => e.includes('template block')), r.errors.join('\n'));
  });

  it('FAILS on a template block with no slotId', () => {
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/templates/thing', '@type': 'Document', id: 'thing',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: {
          good: { '@type': 'slate', templateId: 'resolveuid/pageauid1234567', slotId: 'good' },
          noslot: { '@type': 'slate', templateId: 'resolveuid/pageauid1234567' },
        },
        blocks_layout: { items: ['good', 'noslot'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.ok(r.errors.some((e) => e.includes('noslot') && e.includes('slotId')),
      r.errors.join('\n'));
  });

  it('FAILS on a template block that does not say whether it is fixed', () => {
    // The third thing a template block must declare is how locked it is.
    // Omitting `fixed` does not mean "not fixed" — it makes the block a SLOT,
    // a region for the page to fill. An empty page region then renders an
    // empty slot, so the block silently disappears. That is the bug that cost
    // an hour: templateId and slotId were both present and correct.
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/templates/thing', '@type': 'Document', id: 'thing',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: {
          decided: { '@type': 'slate', templateId: '/templates/thing', slotId: 'decided', fixed: true, readOnly: true },
          vague: { '@type': 'slate', templateId: '/templates/thing', slotId: 'vague' },
        },
        blocks_layout: { items: ['decided', 'vague'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.ok(r.errors.some((e) => e.includes('vague') && e.includes('fixed')), r.errors.join('\n'));
    assert.ok(!r.errors.some((e) => e.includes('decided')), r.errors.join('\n'));
  });

  it('accepts fixed: false — an explicit slot', () => {
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/templates/thing', '@type': 'Document', id: 'thing',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: {
          slot: { '@type': 'slate', templateId: '/templates/thing', slotId: 'slot', fixed: false },
        },
        blocks_layout: { items: ['slot'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.equal(r.errors.filter((e) => /fixed/.test(e)).length, 0, r.errors.join('\n'));
  });

  it('FAILS on a non-boolean fixed', () => {
    // "false" is truthy. A string here would read as a slot to the validator
    // and as fixed to anything doing a plain truthiness check.
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/templates/thing', '@type': 'Document', id: 'thing',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: {
          stringy: { '@type': 'slate', templateId: '/templates/thing', slotId: 'stringy', fixed: 'false' },
        },
        blocks_layout: { items: ['stringy'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.ok(r.errors.some((e) => e.includes('stringy') && e.includes('fixed')), r.errors.join('\n'));
  });

  it('accepts a template whose blocks all carry both', () => {
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/templates/thing', '@type': 'Document', id: 'thing',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: {
          a: { '@type': 'slate', templateId: 'resolveuid/pageauid1234567', slotId: 'a' },
          b: { '@type': 'slate', templateId: '/templates/thing', slotId: 'b' },
        },
        blocks_layout: { items: ['a', 'b'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.equal(r.errors.filter((e) => /templateId|slotId/.test(e)).length, 0,
      r.errors.join('\n'));
  });

  it('leaves ordinary pages alone', () => {
    // Only pages that ARE templates are checked. A normal page's blocks have
    // no templateId and must not be nagged about one.
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a', '@type': 'Document', id: 'page-a',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: { plain: { '@type': 'slate' } },
        blocks_layout: { items: ['plain'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.equal(r.errors.filter((e) => /templateId|slotId/.test(e)).length, 0,
      r.errors.join('\n'));
  });

  it('FAILS on an INSTANCE block that fills a template with no slotId', () => {
    // The mirror of the template-side rule, on the page that instantiates one.
    // A block inside a `<fields templateId=...>` region is matched to a template
    // slot by its slotId. Carry the templateId but omit the slotId (or give one
    // the template has no slot for) and forced-layout expansion matches it to
    // nothing — the block is composed into the page data (block-sanity discovers
    // it) yet no frontend has a slot to render it, so its data-block-uid never
    // appears and the only symptom is a reveal timeout. That is exactly how
    // /docs/examples/slate's `callout` (templateId set, slotId absent) slipped
    // through: 2c-ter only checked blocks whose slotId already matched a slot.
    const { root, contentDir } = buildFixture({
      dataFiles: [
        'plone_site_root/data.json',
        'tpl/data.json',
        'inst/data.json',
      ],
      localRoles: {
        rootuid1234567: { local_roles: { admin: ['Owner'] } },
        tpluid1234567890: { local_roles: { admin: ['Owner'] } },
        instuid123456789: { local_roles: { admin: ['Owner'] } },
      },
    });
    const write = (rel, obj) => {
      fs.mkdirSync(path.join(contentDir, rel), { recursive: true });
      fs.writeFileSync(path.join(contentDir, rel, 'data.json'), JSON.stringify(obj));
    };
    // The template declares two slots: schema and rendering.
    write('tpl', {
      '@id': '/ref', '@type': 'Document', id: 'ref',
      UID: 'tpluid1234567890', parent: { '@id': '/' },
      blocks: {
        'tpl-schema': { '@type': 'codeExample', templateId: 'resolveuid/tpluid1234567890', slotId: 'schema', fixed: false },
        'tpl-rendering': { '@type': 'codeExample', templateId: 'resolveuid/tpluid1234567890', slotId: 'rendering', fixed: false },
      },
      blocks_layout: { items: ['tpl-schema', 'tpl-rendering'] },
    });
    // The instance fills `rendering` correctly, but its callout carries the
    // templateId with NO slotId — the callout-22 shape.
    write('inst', {
      '@id': '/page', '@type': 'Document', id: 'page',
      UID: 'instuid123456789', parent: { '@id': '/' },
      blocks: {
        good: { '@type': 'codeExample', templateId: 'resolveuid/tpluid1234567890', templateInstanceId: 'ti', slotId: 'rendering', fixed: false, readOnly: false },
        orphan: { '@type': 'callout', templateId: 'resolveuid/tpluid1234567890', templateInstanceId: 'ti' },
      },
      blocks_layout: { items: ['good', 'orphan'] },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.ok(r.errors.some((e) => e.includes('orphan') && /slot/i.test(e)),
      r.errors.join('\n'));
    // The fully-coupled block (slotId + fixed + readOnly) must NOT be flagged.
    assert.ok(!r.errors.some((e) => e.includes('block good ')), r.errors.join('\n'));
  });

  it('ACCEPTS an INSTANCE slot-fill that does not state fixed/readOnly', () => {
    // These two are authored on the TEMPLATE, not repeated on every page that
    // fills it. On an instance, absent and false are indistinguishable wherever
    // they are read — the merge branches on `if (block.fixed)`, isSlot is
    // `!b.fixed && !b.readOnly`, and isBlockPositionLocked / isBlockReadonly are
    // both `!!`. Requiring them here asked a real site to write two inert fields
    // onto every block filling a template: 719 of them on the first content tree
    // this was ever run against, not one of which changed any behaviour.
    //
    // Stating TRUE still matters and is still checked: a page block is
    // classified as chrome by its OWN `fixed`, so a slot the template marks
    // fixed must say so on the instance too (covered separately).
    //
    // NOTE: this test used to stand in for blockmd's emit synthesis
    // (markdown-mount normalizeInstanceTemplateFields). That belongs in
    // blockmd's own tests, against blockmd's own output, rather than in a rule
    // every hand-authored content tree has to satisfy.
    const { root, contentDir } = buildFixture({
      dataFiles: [
        'plone_site_root/data.json',
        'tpl/data.json',
        'inst/data.json',
      ],
      localRoles: {
        rootuid1234567: { local_roles: { admin: ['Owner'] } },
        tpluid1234567890: { local_roles: { admin: ['Owner'] } },
        instuid123456789: { local_roles: { admin: ['Owner'] } },
      },
    });
    const write = (rel, obj) => {
      fs.mkdirSync(path.join(contentDir, rel), { recursive: true });
      fs.writeFileSync(path.join(contentDir, rel, 'data.json'), JSON.stringify(obj));
    };
    write('tpl', {
      '@id': '/ref', '@type': 'Document', id: 'ref',
      UID: 'tpluid1234567890', parent: { '@id': '/' },
      blocks: {
        'tpl-schema': { '@type': 'codeExample', templateId: 'resolveuid/tpluid1234567890', slotId: 'schema', fixed: false },
      },
      blocks_layout: { items: ['tpl-schema'] },
    });
    write('inst', {
      '@id': '/page', '@type': 'Document', id: 'page',
      UID: 'instuid123456789', parent: { '@id': '/' },
      blocks: {
        halfway: { '@type': 'codeExample', templateId: 'resolveuid/tpluid1234567890', templateInstanceId: 'ti', slotId: 'schema' },
      },
      blocks_layout: { items: ['halfway'] },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.deepEqual(r.errors.filter((e) => e.includes('halfway')), []);
  });

  it('FAILS on a broken path inside a SLATE link node', () => {
    // Slate links live at value[].data.url, not in a block field, so pass 2c's
    // LINK_FIELDS scan never saw them. Only resolveuid refs were caught (by a
    // raw-text regex over the whole file) — a plain-path slate link pointing
    // nowhere was not checked at all, and the gate still said "0 broken".
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a', '@type': 'Document', id: 'page-a',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: {
          'slate-1': {
            '@type': 'slate',
            value: [{
              type: 'p',
              children: [
                { text: 'See ' },
                { type: 'link', data: { url: '/nope' }, children: [{ text: 'this' }] },
              ],
            }],
          },
        },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.ok(r.errors.some((e) => e.includes('/nope')), r.errors.join('\n'));
    assert.equal(r.stats.linksBroken, 1);
  });

  it('accepts a slate link to a real page', () => {
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a', '@type': 'Document', id: 'page-a',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: {
          'slate-1': {
            '@type': 'slate',
            value: [{
              type: 'p',
              children: [{ type: 'link', data: { url: '/page-a' }, children: [{ text: 'self' }] }],
            }],
          },
        },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.equal(r.stats.linksBroken, 0, r.errors.join('\n'));
  });

  it('accepts a path carrying a #fragment, and still checks the path', () => {
    // Deep-linking to a heading is legitimate content — RichText emits slugged
    // ids for headings precisely so `page#section` resolves. The path branch
    // did not strip the fragment, so a perfectly good link read as
    // "path not in content: /page-a#section".
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a', '@type': 'Document', id: 'page-a',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: {
          'good': {
            '@type': 'teaser',
            href: [{ '@id': '/page-a#a-heading' }],
          },
        },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.equal(r.stats.linksBroken, 0, r.errors.join('\n'));
  });

  // The blocks these reference tests use, with the widget that says each
  // field holds a reference. Which field is a reference is never knowable
  // from its name, so a test about reference integrity has to declare it.
  const REF_CONFIG = {
    teaser: { blockSchema: { properties: { href: { widget: 'object_browser' } } } },
    image: { blockSchema: { properties: { url: { widget: 'url' }, href: { widget: 'object_browser' } } } },
    button: { blockSchema: { properties: { url: { widget: 'url' }, href: { widget: 'object_browser' } } } },
    slate: { blockSchema: { properties: { value: { widget: 'slate' } } } },
  };

  it('still FAILS when the page before the #fragment does not exist', () => {
    // Stripping the fragment must not become a way to smuggle a dead path past
    // the gate.
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a', '@type': 'Document', id: 'page-a',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: {
          'bad': { '@type': 'teaser', href: [{ '@id': '/ghost#a-heading' }] },
        },
      },
    });
    const r = checkIntegrity(contentDir, { schemasFor: () => REF_CONFIG });
    cleanup(root);
    assert.ok(r.errors.some((e) => e.includes('/ghost')), r.errors.join('\n'));
    assert.equal(r.stats.linksBroken, 1);
  });

  it('FAILS on a broken internal href in a block teaser', () => {
    // A broken link is a malformed-content ERROR, not a warning. A warning does
    // not fail the deploy gate, so a broken href would ship.
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a',
        '@type': 'Document',
        id: 'page-a',
        UID: 'pageauid1234567',
        parent: { '@id': '/' },
        blocks: {
          'teaser-1': {
            '@type': 'teaser',
            href: [{ '@id': '/does-not-exist' }],
          },
        },
      },
    });
    const r = checkIntegrity(contentDir, { schemasFor: () => REF_CONFIG });
    cleanup(root);
    assert.ok(r.errors.some((e) => e.includes('/does-not-exist')), r.errors.join('\n'));
    assert.equal(r.stats.linksBroken, 1);
  });

  it('FAILS on an image block url in [{"@id": path}] array form pointing nowhere', () => {
    // The exact shape that shipped 5 dead image blocks on pretagov-site: url as
    // an object_browser ARRAY, not a string, pointing at /images/test-image
    // which does not exist. Pass 2c only checked url as a STRING, so this was
    // never looked at and the gate reported "0 broken".
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a',
        '@type': 'Document',
        id: 'page-a',
        UID: 'pageauid1234567',
        parent: { '@id': '/' },
        blocks: {
          'image-1': {
            '@type': 'image',
            url: [{ '@id': '/images/test-image' }],
          },
        },
      },
    });
    const r = checkIntegrity(contentDir, { schemasFor: () => REF_CONFIG });
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes('/images/test-image')),
      r.errors.join('\n'),
    );
    assert.equal(r.stats.linksBroken, 1);
  });

  it('accepts a valid array-form url that resolves', () => {
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a',
        '@type': 'Document',
        id: 'page-a',
        UID: 'pageauid1234567',
        parent: { '@id': '/' },
        blocks: {
          'image-1': { '@type': 'image', url: [{ '@id': '/' }] },  // homepage
        },
      },
    });
    const r = checkIntegrity(contentDir, { schemasFor: () => REF_CONFIG });
    cleanup(root);
    assert.deepEqual(r.errors, []);
    assert.equal(r.stats.linksBroken, 0);
    assert.equal(r.stats.linksOk, 1);
  });

  it('FAILS on a reference form it does not understand', () => {
    // "if a sanity test is finding links it can't understand, it fails." An
    // href that is neither resolveuid, internal path, external URL, nor a known
    // scheme must not be silently skipped.
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a',
        '@type': 'Document',
        id: 'page-a',
        UID: 'pageauid1234567',
        parent: { '@id': '/' },
        blocks: {
          'btn-1': { '@type': 'button', href: [{ '@id': 'garbage-not-a-ref' }] },
        },
      },
    });
    const r = checkIntegrity(contentDir, { schemasFor: () => REF_CONFIG });
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes('garbage-not-a-ref')),
      r.errors.join('\n'),
    );
  });

  it('accepts external URLs and known schemes without flagging them', () => {
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a',
        '@type': 'Document',
        id: 'page-a',
        UID: 'pageauid1234567',
        parent: { '@id': '/' },
        blocks: {
          'img-1': { '@type': 'image', href: [{ '@id': 'https://digital.nsw.gov.au/x' }] },
          'img-2': { '@type': 'image', href: [{ '@id': 'mailto:hi@example.com' }] },
        },
      },
    });
    const r = checkIntegrity(contentDir, { schemasFor: () => REF_CONFIG });
    cleanup(root);
    assert.deepEqual(r.errors, []);
    assert.equal(r.stats.linksOk, 2);
  });

  it('FAILS on a blocks_layout.items entry with no matching block', () => {
    // A uid listed in a container's blocks_layout but absent from its `blocks`
    // dict is a dangling reference — what a partial block deletion leaves (remove
    // the block def but not its layout entry).
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a', '@type': 'Document', id: 'page-a', UID: 'pageauid1234567',
        parent: { '@id': '/' },
        blocks: { 'real-1': { '@type': 'slate' } },
        blocks_layout: { items: ['real-1', 'ghost-block-999'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes('ghost-block-999') && e.includes('blocks_layout')),
      r.errors.join('\n'),
    );
  });

  it('FAILS on a dangling ref in the nested blocks_layout.blocks_layout key', () => {
    // The exact bug a teaser removal left: block def gone from `blocks`, uid still
    // in the vestigial blocks_layout.blocks_layout array.
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a', '@type': 'Document', id: 'page-a', UID: 'pageauid1234567',
        parent: { '@id': '/' },
        blocks: {
          'grid-1': {
            '@type': 'gridBlock',
            blocks: { 'child-1': { '@type': 'teaser' } },
            blocks_layout: { blocks_layout: ['deleted-teaser-uid'], items: ['child-1'] },
          },
        },
        blocks_layout: { items: ['grid-1'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes('deleted-teaser-uid')),
      r.errors.join('\n'),
    );
  });

  it('accepts a container whose blocks_layout fully resolves', () => {
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a', '@type': 'Document', id: 'page-a', UID: 'pageauid1234567',
        parent: { '@id': '/' },
        blocks: { 'a': { '@type': 'slate' }, 'b': { '@type': 'slate' } },
        blocks_layout: { blocks_layout: [], items: ['a', 'b'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.deepEqual(r.errors, []);
    assert.equal(r.stats.layoutBroken, 0);
  });

  it('reports a block id listed TWICE in one blocks_layout', () => {
    // A duplicate is not dangling — both entries resolve — so the dangling
    // check waves it through, and the page renders that block twice while
    // whichever block the second entry was MEANT to be renders not at all.
    // Real case: a template gained a new slot, the id generator restarted its
    // counter and minted an id an earlier run had already given to another
    // slot, and six case studies shipped their date stamp twice and their lead
    // row never.
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a', '@type': 'Document', id: 'page-a', UID: 'pageauid1234567',
        parent: { '@id': '/' },
        blocks: { a: { '@type': 'slate' }, b: { '@type': 'slate' } },
        blocks_layout: { items: ['a', 'b', 'a'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes('lists block a twice')),
      r.errors.join('\n'),
    );
  });

  it('reports a block id used by two blocks on one page', () => {
    // Every rows' value block was "v1" (r1/v1, r2/v1, r3/v1): each container's
    // own layout resolves, so the layout checks pass, but the editor maps a
    // block id to ONE block, so only one of them could be selected or edited.
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a', '@type': 'Document', id: 'page-a', UID: 'pageauid1234567',
        parent: { '@id': '/' },
        blocks: {
          r1: { '@type': 'row', blocks: { v1: { '@type': 'slate' } }, blocks_layout: { items: ['v1'] } },
          r2: { '@type': 'row', blocks: { v1: { '@type': 'slate' } }, blocks_layout: { items: ['v1'] } },
        },
        blocks_layout: { items: ['r1', 'r2'] },
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes('block id v1 is used twice (in r1 and r2)')),
      r.errors.join('\n'),
    );
  });

  it('accepts the same block id on two different pages', () => {
    const page = (n) => ({
      '@id': `/page-${n}`, '@type': 'Document', id: `page-${n}`, UID: `page${n}uid1234567`,
      parent: { '@id': '/' },
      blocks: { v1: { '@type': 'slate' } },
      blocks_layout: { items: ['v1'] },
    });
    const { root, contentDir } = buildFixture({ pageA: page('a'), pageB: page('b') });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.deepEqual(r.errors, []);
  });

  it('resolves valid resolveuid refs', () => {
    // UID must be hex ≥ 10 chars to match the /resolveuid/[a-f0-9]{10,}/ regex
    const uid = 'abcdef1234567890';
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a',
        '@type': 'Document',
        id: 'page-a',
        UID: uid,
        parent: { '@id': '/' },
        body: `Self-ref: <a href="resolveuid/${uid}">here</a>`,
      },
    });
    const r = checkIntegrity(contentDir);
    cleanup(root);
    assert.equal(r.stats.resolveuidBroken, 0);
    assert.equal(r.stats.resolveuidOk, 1);
  });
});

describe('checkIntegrity over in-memory items (API-fed)', () => {
  it('catches broken resolveuid, dangling layout refs and duplicate UIDs with no disk tree', () => {
    const uid = 'abcdef1234567890';
    const r = checkIntegrity([
      {
        rel: 'page-a',
        data: {
          '@id': '/page-a',
          '@type': 'Document',
          id: 'page-a',
          UID: uid,
          blocks: {
            good: { '@type': 'slate', value: [{ type: 'p', children: [{ text: `see resolveuid/${uid}` }] }] },
            bad: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'see resolveuid/feedfeedfeedfeed' }] }] },
          },
          blocks_layout: { items: ['good', 'bad', 'ghost'] },
        },
      },
      {
        rel: 'page-b',
        data: { '@id': '/page-b', '@type': 'Document', id: 'page-b', UID: uid, blocks: {}, blocks_layout: { items: [] } },
      },
    ]);
    assert.equal(r.stats.resolveuidOk, 1);
    assert.equal(r.stats.resolveuidBroken, 1);
    assert.equal(r.stats.layoutBroken, 1);
    assert.ok(r.errors.some((e) => e.includes('duplicate UID')));
    assert.ok(r.errors.some((e) => e.includes('missing block ghost')));
    // Disk-only passes must not have run (nothing to stat).
    assert.equal(r.stats.imagesBroken, 0);
  });

  it('a clean in-memory set reports nothing', () => {
    const r = checkIntegrity([
      {
        rel: 'page-a',
        data: { '@id': '/page-a', '@type': 'Document', id: 'page-a', UID: 'aaaabbbbcccc', blocks: {}, blocks_layout: { items: [] } },
      },
    ]);
    assert.deepEqual(r.errors, []);
  });
});

describe('checkBlockSchemas()', () => {
  const FIELDS = {
    contentBlock: ['title', 'description', 'linkUrl'],
    slateish: ['value'],
  };
  const page = (blocks) => [{ rel: 'content/x', data: { blocks } }];

  it('reports a field the block schema does not declare', () => {
    // The shape that went unnoticed for months: the right value under a key the
    // schema has never heard of, so the field is uneditable and unrendered.
    const r = checkBlockSchemas(
      page({ b1: { '@type': 'contentBlock', title: 'T', url: '/somewhere' } }),
      FIELDS,
    );
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /contentBlock\.url/);
    assert.equal(r.stats.undeclared, 1);
  });

  it('says nothing about a block whose fields are all declared', () => {
    const r = checkBlockSchemas(
      page({ b1: { '@type': 'contentBlock', title: 'T', linkUrl: '/somewhere' } }),
      FIELDS,
    );
    assert.deepEqual(r.errors, []);
  });

  it('reports each stray field once, however many pages repeat it', () => {
    // A converter bug repeats on every page it touched; one report per
    // (blockType, field) keeps the output about the bug, not its blast radius.
    const items = ['a', 'b', 'c'].map((rel) => ({
      rel: `content/${rel}`,
      data: { blocks: { b1: { '@type': 'contentBlock', url: '/x' } } },
    }));
    const r = checkBlockSchemas(items, FIELDS);
    assert.equal(r.errors.length, 1);
    assert.equal(r.stats.items, 3);
  });

  it('finds blocks nested inside other blocks', () => {
    const r = checkBlockSchemas(
      page({
        g: {
          '@type': 'slateish',
          value: [],
          columns: [{ '@type': 'contentBlock', url: '/x' }],
        },
      }),
      FIELDS,
      // `columns` is an object_list; which fields hold children is declared,
      // never guessed from the name.
      { idFieldMap: { slateish: { columns: '@id' } } },
    );
    assert.match(r.errors[0], /contentBlock\.url/);
  });

  it('warns about a block type missing from the field map', () => {
    const r = checkBlockSchemas(page({ b1: { '@type': 'mystery' } }), FIELDS);
    assert.equal(r.errors.length, 0);
    assert.equal(r.stats.unknownTypes, 1);
    assert.match(r.warnings[0], /mystery/);
  });

  it('ignores identity keys and a container\'s child storage', () => {
    const r = checkBlockSchemas(
      page({
        b1: {
          '@type': 'contentBlock',
          '@id': 'x',
          title: 'T',
          blocks: { inner: { '@type': 'contentBlock', linkUrl: '/y' } },
          blocks_layout: { items: ['inner'] },
        },
      }),
      FIELDS,
    );
    assert.deepEqual(r.errors, []);
  });
});

describe('checkIntegrity() — object_list items must carry their type', () => {
  // Schema-driven: an object_list field's items are block instances (they get a
  // @uid, are selectable/editable), so each must carry a type in the field the
  // schema names. Absent a schema this can't be known, so the check runs only
  // when schemas are supplied. Regression guard for the `tab`/socialLinks
  // "no editable example" bug the bridge suite caught 17 minutes in.
  // `allowedBlocks` is what makes this list TYPED: its items vary in kind, so
  // each must say which. A list with one inline `schema` is a record list and
  // carries no type — the fixture states the difference rather than leaving it
  // to a default, which is how it used to read as typed by accident.
  const accordionConfig = {
    accordion: {
      blockSchema: {
        properties: { panels: { widget: 'object_list', allowedBlocks: ['panel'], typeField: '@type' } },
      },
    },
    panel: { blockSchema: { properties: { title: {} } } },
  };

  const pageWithAccordion = (panels) => ({
    '@id': '/page-a', '@type': 'Document', id: 'page-a',
    UID: 'pageauid1234567', parent: { '@id': '/' },
    blocks: { acc: { '@type': 'accordion', panels } },
    blocks_layout: { items: ['acc'] },
  });

  it('FLAGS a data-json object_list item that dropped its @type', () => {
    const { root, contentDir } = buildFixture({
      pageA: pageWithAccordion([{ '@id': 'p1', '@type': 'panel', title: 'ok' }, { '@id': 'p2', title: 'no type' }]),
    });
    const r = checkIntegrity(contentDir, { schemasFor: () => accordionConfig });
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes('object_list field "panels" item 1') && e.includes('missing its type field "@type"')),
      r.errors.join('\n'),
    );
    // item 0 carries @type — only item 1 is reported.
    assert.ok(!r.errors.some((e) => e.includes('panels" item 0')), r.errors.join('\n'));
  });

  it('PASSES when every object_list item carries its @type', () => {
    const { root, contentDir } = buildFixture({
      pageA: pageWithAccordion([{ '@id': 'p1', '@type': 'panel', title: 'a' }, { '@id': 'p2', '@type': 'panel', title: 'b' }]),
    });
    const r = checkIntegrity(contentDir, { schemasFor: () => accordionConfig });
    cleanup(root);
    assert.ok(!r.errors.some((e) => e.includes('missing its type field')), r.errors.join('\n'));
  });

  it('honors the schema-named typeField (not a hardcoded @type)', () => {
    // A field can name where the type lives; the check reads THAT key.
    const facetConfig = {
      facetgroup: {
        blockSchema: { properties: { facets: { widget: 'object_list', typeField: 'type' } } },
      },
    };
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a', '@type': 'Document', id: 'page-a',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: { fg: { '@type': 'facetgroup', facets: [{ label: 'no type key' }] } },
        blocks_layout: { items: ['fg'] },
      },
    });
    const r = checkIntegrity(contentDir, { schemasFor: () => facetConfig });
    cleanup(root);
    assert.ok(
      r.errors.some((e) => e.includes('facets" item 0') && e.includes('missing its type field "type"')),
      r.errors.join('\n'),
    );
  });

  it('accepts an item typed by @type even where the schema names another typeField', () => {
    // hydra reads an item's type as `@type ?? item[typeField]` (getBlockType),
    // so an item carrying @type IS typed — a frontend whose facets are
    // `{"@type": "selectFacet"}` against a schema naming `type` renders fine.
    const facetConfig = {
      facetgroup: {
        blockSchema: { properties: { facets: { widget: 'object_list', typeField: 'type' } } },
      },
    };
    const r = checkIntegrity(
      [{
        rel: '/p',
        data: {
          '@id': '/p', '@type': 'Document', id: 'p', UID: 'p-uid',
          blocks: { fg: { '@type': 'facetgroup', facets: [{ '@type': 'selectFacet' }] } },
          blocks_layout: { items: ['fg'] },
        },
      }],
      { schemasFor: () => facetConfig },
    );
    assert.deepEqual(r.errors.filter((e) => e.includes('type field')), []);
  });
});

describe('checkIntegrity — every list item has its own id', () => {
  // Frontends key object_list items and table rows/cells by their id
  // (`expand(rows, null, 'key')`). Items with no id — or a repeated one — all
  // resolve to one item, so a whole table renders its last cell everywhere.
  const page = (blocks) => [{
    rel: '/p',
    data: {
      '@id': '/p', '@type': 'Document', id: 'p', UID: 'p-uid',
      blocks, blocks_layout: { items: Object.keys(blocks) },
    },
  }];
  const slidesConfig = (idField) => ({
    slider: {
      blockSchema: {
        properties: { slides: { widget: 'object_list', ...(idField ? { idField } : {}) } },
      },
    },
    slide: { blockSchema: { properties: { title: {} } } },
  });
  const idErrors = (r) => r.errors.filter((e) => e.includes(' id '));

  it('FAILS an object_list item with no id (default idField @id)', () => {
    const r = checkIntegrity(page({ s: { '@type': 'slider', slides: [{ '@type': 'slide', '@id': 'a' }, { '@type': 'slide' }] } }), { schemasFor: () => slidesConfig() });
    assert.ok(r.errors.some((e) => e.includes('slides" item 1') && e.includes('has no id "@id"')), r.errors.join('\n'));
    assert.ok(!r.errors.some((e) => e.includes('slides" item 0')), r.errors.join('\n'));
  });

  it('reads the id from the schema-named idField, so ids stored under the wrong key fail', () => {
    // A region that put ids in @id while the frontend reads `key`.
    const r = checkIntegrity(page({ s: { '@type': 'slider', slides: [{ '@type': 'slide', '@id': 'a' }] } }), { schemasFor: () => slidesConfig('key') });
    assert.ok(r.errors.some((e) => e.includes('slides" item 0') && e.includes('has no id "key"')), r.errors.join('\n'));
  });

  it('FAILS two object_list items that share an id', () => {
    const r = checkIntegrity(page({ s: { '@type': 'slider', slides: [{ '@type': 'slide', '@id': 'x' }, { '@type': 'slide', '@id': 'x' }] } }), { schemasFor: () => slidesConfig() });
    assert.ok(r.errors.some((e) => e.includes('slides" item 1') && e.includes('repeats id "x"')), r.errors.join('\n'));
  });

  const table = (rows) => ({ t: { '@type': 'slateTable', table: { rows } } });
  const cell = (key, text) => ({ ...(key ? { key } : {}), type: 'data', value: [{ type: 'p', children: [{ text }] }] });

  it('FAILS table rows and cells with no key', () => {
    const r = checkIntegrity(page(table([{ cells: [cell(null, 'a'), cell(null, 'b')] }])), {});
    assert.ok(r.errors.some((e) => e.includes('table row 0') && e.includes('has no id "key"')), r.errors.join('\n'));
    assert.ok(r.errors.some((e) => e.includes('row 0 cell 1') && e.includes('has no id "key"')), r.errors.join('\n'));
  });

  it('FAILS table cells that repeat a key within their row', () => {
    const r = checkIntegrity(page(table([{ key: 'r1', cells: [cell('c', 'a'), cell('c', 'b')] }])), {});
    assert.ok(r.errors.some((e) => e.includes('row 0 cell 1') && e.includes('repeats id "c"')), r.errors.join('\n'));
  });

  it('PASSES keyed lists and tables', () => {
    const r = checkIntegrity(page({
      s: { '@type': 'slider', slides: [{ '@type': 'slide', '@id': 'a' }, { '@type': 'slide', '@id': 'b' }] },
      ...table([{ key: 'r1', cells: [cell('c1', 'a'), cell('c2', 'b')] }, { key: 'r2', cells: [cell('c3', 'c'), cell('c4', 'd')] }]),
    }), { schemasFor: () => slidesConfig() });
    assert.deepEqual(idErrors(r), []);
  });
});

// A site's block schemas, as the site stores them (one JSON file the frontend's
// config also loads) -- the ONE source both checks read: what fields a block
// declares, and what shape each field's value must have.
describe('validating against a site\'s schemas', () => {
  const SCHEMAS = {
    card: {
      blockSchema: { properties: { title: { type: 'string' }, body: { widget: 'slate' } } },
    },
    grid: {
      blockSchema: {
        properties: {
          headline: { type: 'string' },
          cells: { widget: 'object_list', idField: 'key', typeField: '@type' },
        },
      },
      schemaEnhancer: { inheritSchemaFrom: { defaultsField: 'itemDefaults' } },
    },
  };
  const page = (blocks) => [{ rel: 'content/x', data: { blocks } }];

  it('derives the field map from the schemas: fields, defaults prefix, identity fields', () => {
    const map = fieldMapFromSchemas(SCHEMAS);
    assert.deepEqual(map.blocks.card, { fields: ['title', 'body'] });
    assert.deepEqual(map.blocks.grid, { fields: ['headline', 'cells'], defaultsPrefix: 'itemDefaults' });
    assert.deepEqual([...map.identityFields].sort(), ['@id', '@type', 'key']);
  });

  it('leaves the fields of a block the frontend only adds rules to to its own schema', () => {
    // An entry with no blockSchema keeps the admin's built-in schema
    // (mergeFrontendBlock: a key not given is not replaced). This map cannot
    // see that schema, so it must not call the block's fields undeclared —
    // nor the block unknown.
    const schemas = {
      ...SCHEMAS,
      slate: { schemaEnhancer: { fieldRules: { value: [{ when: {}, warning: 'w' }] } } },
    };
    const r = checkBlockSchemas(
      page({ b1: { '@type': 'slate', value: [], anchor: 'intro' } }),
      fieldMapFromSchemas(schemas),
    );
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
  });

  it('reports a field the schemas do not declare', () => {
    const r = checkBlockSchemas(page({ b1: { '@type': 'card', title: 'T', url: '/x' } }), fieldMapFromSchemas(SCHEMAS));
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /card\.url/);
  });

  it('checks a site block\'s field values against its schema, not just its field names', () => {
    // A slate field holding a {value:[...]} wrapper has the right NAME; only the
    // schema says it must be a bare array of nodes.
    const r = checkIntegrity(
      page({ b1: { '@type': 'card', title: 'T', body: { value: [{ type: 'p', children: [{ text: 'x' }] }] } } }),
      { schemasFor: () => SCHEMAS },
    );
    assert.ok(r.errors.some((e) => /card\) field "body" is widget:slate/.test(e)), r.errors.join('\n'));
  });
});


/**
 * A TEMPLATE's own slot arrangement is checkable here, statically.
 *
 * `fixed` chrome is what separates one slot group from the next: it tells the
 * merge where one slot's content ends. Two OPEN slots side by side leave an
 * added block ambiguous — it could belong to either — so hydra's
 * validateTemplatePlaceholders reports "Missing Fixed Block".
 *
 * That check ran only in the editor, at SAVE time, against the merged page. So
 * a template saved with two adjacent open slots passed every gate, and the
 * first anyone knew was an author being refused on a page whose offending
 * blocks live inside a readOnly, template-owned container they cannot reach —
 * an error about the template, raised against the page, with no way back to
 * the cause.
 *
 * The arrangement of a TEMPLATE's own blocks needs no merge and no render: it
 * is right there in its blocks_layout. Checking it here turns that into a gate
 * failure on the commit that introduces it.
 */
describe('plone-content-validator template slot arrangement', () => {
  const definition = (children, layout) => ({
    '@id': '/templates/case-study-layout',
    '@type': 'Document',
    id: 'case-study-layout',
    UID: 'tpl-uid',
    blocks: {
      'lead-text': {
        '@type': 'column',
        fixed: true,
        slotId: 'lead-text',
        blocks: children,
        blocks_layout: { items: layout },
      },
    },
    blocks_layout: { items: ['lead-text'] },
  });
  const slotErrors = (data) =>
    checkIntegrity([{ rel: '/templates/case-study-layout', data }]).errors.filter((e) =>
      /sit next to each other|not contiguous/.test(e),
    );

  it('reports two adjacent OPEN slots in a template column', () => {
    const errs = slotErrors(definition({
      title: { '@type': 'title', slotId: 'title', fixed: false },
      'lead-intro': { '@type': 'slate', slotId: 'lead-intro', fixed: false },
    }, ['title', 'lead-intro']));
    assert.ok(
      errs.some((e) => e.includes('"title"') && e.includes('"lead-intro"')),
      `expected an error naming both slot groups, got:\n${errs.join('\n')}`,
    );
  });

  it('accepts the same column once the heading is chrome', () => {
    assert.deepEqual(slotErrors(definition({
      title: { '@type': 'title', slotId: 'title', fixed: true },
      'lead-intro': { '@type': 'slate', slotId: 'lead-intro', fixed: false },
    }, ['title', 'lead-intro'])), []);
  });

  it('reports one slot split by another', () => {
    const errs = slotErrors(definition({
      a1: { '@type': 'slate', slotId: 'body', fixed: false },
      gap: { '@type': 'slate', slotId: 'aside', fixed: false },
      a2: { '@type': 'slate', slotId: 'body', fixed: false },
    }, ['a1', 'gap', 'a2']));
    assert.ok(errs.some((e) => /not contiguous/.test(e)), errs.join('\n'));
  });
});

/**
 * The slot rules apply to EVERY region, not just `items`.
 *
 * The editor's validateTemplatePlaceholders walks "the page's regions AND every
 * nested container's regions (blocks_layout AND object_list)". This pass read
 * only `blocks_layout.items`, so a template could pass here and still be
 * refused in the editor — and a columns region is not exotic: a case-study
 * layout's own lead row is one, holding the lead slots.
 */
describe('template slot arrangement covers every region', () => {
  const tpl = (blocksLayout, blocks) => [{
    rel: '/templates/t',
    data: {
      '@id': '/templates/t', '@type': 'Document', id: 't', UID: 'tuid000000000000',
      blocks: { row: { '@type': 'columns', slotId: 'row', fixed: true, readOnly: true, ...blocks } },
      blocks_layout: { items: ['row'] },
      ...blocksLayout,
    },
  }];
  const slot = (id) => ({ '@type': 'slate', slotId: id, fixed: false, readOnly: false });
  // `columns.slides` is an object_list. Since #548 the `templateId` shortcut
  // is the MERGE's opt-in, not a default, so a caller that is not merging says
  // which fields hold children — the validator always has the schemas to say.
  const REGIONS = { columns: { slides: '@id' } };
  const errs = (items) =>
    checkIntegrity(items, { idFieldMap: REGIONS }).errors
      .filter((e) => /sit next to each other|not contiguous/.test(e));

  it('reports two adjacent OPEN slots in a COLUMNS region', () => {
    const r = errs(tpl({}, {
      blocks: { a: slot('alpha'), b: slot('beta') },
      blocks_layout: { columns: ['a', 'b'] },
    }));
    assert.ok(r.some((e) => e.includes('"alpha"') && e.includes('"beta"')), r.join('\n') || '(no error raised)');
  });

  it('accepts the same columns region once a fixed block separates them', () => {
    const r = errs(tpl({}, {
      blocks: { a: slot('alpha'), sep: { '@type': 'slate', slotId: 'sep', fixed: true, readOnly: true }, b: slot('beta') },
      blocks_layout: { columns: ['a', 'sep', 'b'] },
    }));
    assert.deepEqual(r, []);
  });

  it('reports two adjacent OPEN slots in an object_list region', () => {
    // An object_list child carries `templateId` — that is what marks it as the
    // template's own, and what getChildFields keys off to call the field a
    // region at all. A bare array is not one, so the fixture states it.
    const inList = (id) => ({ ...slot(id), '@id': `oid-${id}`, templateId: 'resolveuid/tuid000000000000' });
    const r = errs(tpl({}, {
      slides: [inList('alpha'), inList('beta')],
      blocks: {}, blocks_layout: { items: [] },
    }));
    assert.ok(r.some((e) => e.includes('"alpha"') && e.includes('"beta"')), r.join('\n') || '(no error raised)');
  });
});
