const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { validate, checkIntegrity, checkBlockSchemas } = require('./plone-content-validator.cjs');

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

describe('plone-content-validator checkIntegrity()', () => {
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
            '@type': 'columns', templateId: 'resolveuid/pageauid1234567', slotId: 'row', fixed: true,
            blocks: {
              col: {
                '@type': 'column', templateId: 'resolveuid/pageauid1234567', slotId: 'col', fixed: true,
                blocks: {
                  buried: { '@type': 'slate', slotId: 'buried', fixed: true },
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
            '@type': 'columns', templateId: 'resolveuid/pageauid1234567', slotId: 'row', fixed: true,
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

  it('PASSES an untagged block inside a non-fixed SLOT', () => {
    // A slot's children are the PAGE's content, not the template's: the merge
    // fills the slot from the page and carries its nesting through untouched,
    // so those blocks need no templateId/slotId of their own. /templates/
    // contact-cta ships exactly this shape — a `fixed: false` section whose
    // `cta-btn` carries nothing — and the button comes through the merge intact.
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
    assert.ok(!r.errors.some((e) => e.includes('btn')), r.errors.join('\n'));
  });

  it('PASSES a fully-tagged nested template', () => {
    const tag = (extra) => ({ templateId: 'resolveuid/pageauid1234567', fixed: true, ...extra });
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
          decided: { '@type': 'slate', templateId: '/templates/thing', slotId: 'decided', fixed: true },
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

  it('FAILS on an INSTANCE slot-fill missing fixed/readOnly (emit did not run)', () => {
    // A block that has a valid slotId but no fixed/readOnly means the emit
    // synthesis (markdown-mount normalizeInstanceTemplateFields, which stamps both
    // false on a page slot-fill) never ran for it — a real pipeline gap, not an
    // authoring nit. The coupling must hold: all three or the block is flagged.
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
    assert.ok(r.errors.some((e) => e.includes('halfway') && e.includes('fixed') && e.includes('readOnly')),
      r.errors.join('\n'));
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
    const r = checkIntegrity(contentDir);
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
    const r = checkIntegrity(contentDir);
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
    const r = checkIntegrity(contentDir);
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
    const r = checkIntegrity(contentDir);
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
    const r = checkIntegrity(contentDir);
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
    const r = checkIntegrity(contentDir);
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
  // when a schemaFor is supplied. Regression guard for the `tab`/socialLinks
  // "no editable example" bug the bridge suite caught 17 minutes in.
  const accordionSchema = (t) =>
    t === 'accordion' ? { properties: { panels: { widget: 'object_list' } } } : null;

  const pageWithAccordion = (panels) => ({
    '@id': '/page-a', '@type': 'Document', id: 'page-a',
    UID: 'pageauid1234567', parent: { '@id': '/' },
    blocks: { acc: { '@type': 'accordion', panels } },
    blocks_layout: { items: ['acc'] },
  });

  it('FLAGS a data-json object_list item that dropped its @type', () => {
    const { root, contentDir } = buildFixture({
      pageA: pageWithAccordion([{ '@type': 'panel', title: 'ok' }, { title: 'no type' }]),
    });
    const r = checkIntegrity(contentDir, { schemaFor: accordionSchema });
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
      pageA: pageWithAccordion([{ '@type': 'panel', title: 'a' }, { '@type': 'panel', title: 'b' }]),
    });
    const r = checkIntegrity(contentDir, { schemaFor: accordionSchema });
    cleanup(root);
    assert.ok(!r.errors.some((e) => e.includes('missing its type field')), r.errors.join('\n'));
  });

  it('honors the schema-named typeField (not a hardcoded @type)', () => {
    // A field can name where the type lives; the check reads THAT key.
    const schemaFor = (t) =>
      t === 'facetgroup' ? { properties: { facets: { widget: 'object_list', typeField: 'type' } } } : null;
    const { root, contentDir } = buildFixture({
      pageA: {
        '@id': '/page-a', '@type': 'Document', id: 'page-a',
        UID: 'pageauid1234567', parent: { '@id': '/' },
        blocks: { fg: { '@type': 'facetgroup', facets: [{ label: 'no type key' }] } },
        blocks_layout: { items: ['fg'] },
      },
    });
    const r = checkIntegrity(contentDir, { schemaFor });
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
    const schemaFor = (t) =>
      t === 'facetgroup' ? { properties: { facets: { widget: 'object_list', typeField: 'type' } } } : null;
    const r = checkIntegrity(
      [{
        rel: '/p',
        data: {
          '@id': '/p', '@type': 'Document', id: 'p', UID: 'p-uid',
          blocks: { fg: { '@type': 'facetgroup', facets: [{ '@type': 'selectFacet' }] } },
          blocks_layout: { items: ['fg'] },
        },
      }],
      { schemaFor },
    );
    assert.deepEqual(r.errors.filter((e) => e.includes('type field')), []);
  });
});
