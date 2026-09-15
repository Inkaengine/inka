const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { app } = require('./mock-api-server.cjs');

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

// Helper: POST to @querystring-search
async function querystringSearch(contextPath, body) {
  const res = await fetch(`${baseUrl}${contextPath}/@querystring-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 200);
  return res.json();
}

// Helper: GET content. Expands navigation so tests can assert on
// @components.navigation — a plain GET returns it as an unexpanded
// {@id} stub (nav.items would be undefined).
async function getContent(contentPath) {
  const sep = contentPath.includes('?') ? '&' : '?';
  const res = await fetch(`${baseUrl}${contentPath}${sep}expand=navigation`, {
    headers: { Accept: 'application/json' },
  });
  assert.equal(res.status, 200);
  return res.json();
}

describe('@querystring-search', () => {
  it('relativePath "." returns children of context path', async () => {
    const data = await querystringSearch('/_test_data', {
      query: [
        {
          i: 'path',
          o: 'plone.app.querystring.operation.string.relativePath',
          v: '.',
        },
      ],
      b_start: 0,
      b_size: 1000,
    });

    assert.ok(data.items_total > 0, 'should return items');
    // All items should be under /_test_data/
    for (const item of data.items) {
      const itemPath = new URL(item['@id']).pathname;
      assert.ok(
        itemPath.startsWith('/_test_data/'),
        `${itemPath} should be under /_test_data/`,
      );
    }
    // Should include known children
    const ids = data.items.map((i) => i.id);
    assert.ok(ids.includes('test-page'), 'should include test-page');
    assert.ok(ids.includes('another-page'), 'should include another-page');
  });

  it('getObjPositionInParent sort returns folder order (ascending)', async () => {
    const data = await querystringSearch('/_test_data', {
      query: [
        {
          i: 'path',
          o: 'plone.app.querystring.operation.string.relativePath',
          v: '.',
        },
      ],
      sort_on: 'getObjPositionInParent',
      sort_order: 'ascending',
      b_start: 0,
      b_size: 1000,
    });

    // Filter to direct children only (not nested template items etc.)
    const directChildren = data.items.filter((item) => {
      const itemPath = new URL(item['@id']).pathname;
      const rel = itemPath.replace('/_test_data/', '');
      return rel.length > 0 && !rel.includes('/');
    });

    assert.ok(directChildren.length > 0, 'should have direct children');

    // Filesystem scan order is alphabetical by directory name
    const ids = directChildren.map((i) => i.id);
    for (let k = 1; k < ids.length; k++) {
      assert.ok(
        ids[k - 1] <= ids[k],
        `Expected ascending folder order: "${ids[k - 1]}" should be <= "${ids[k]}"`,
      );
    }
  });

  it('getObjPositionInParent descending reverses the order', async () => {
    const asc = await querystringSearch('/_test_data', {
      query: [
        {
          i: 'path',
          o: 'plone.app.querystring.operation.string.relativePath',
          v: '.',
        },
      ],
      sort_on: 'getObjPositionInParent',
      sort_order: 'ascending',
      b_start: 0,
      b_size: 1000,
    });
    const desc = await querystringSearch('/_test_data', {
      query: [
        {
          i: 'path',
          o: 'plone.app.querystring.operation.string.relativePath',
          v: '.',
        },
      ],
      sort_on: 'getObjPositionInParent',
      sort_order: 'descending',
      b_start: 0,
      b_size: 1000,
    });

    const ascIds = asc.items.map((i) => i.id);
    const descIds = desc.items.map((i) => i.id);
    assert.deepStrictEqual(descIds, ascIds.toReversed());
  });

  it('absolutePath filter returns items under that path', async () => {
    const data = await querystringSearch('/', {
      query: [
        {
          i: 'path',
          o: 'plone.app.querystring.operation.string.absolutePath',
          v: '/_test_data',
        },
      ],
      b_start: 0,
      b_size: 50,
    });

    assert.ok(data.items_total > 0, 'should return items');
    for (const item of data.items) {
      const itemPath = new URL(item['@id']).pathname;
      assert.ok(
        itemPath.startsWith('/_test_data'),
        `${itemPath} should start with /_test_data`,
      );
    }
  });

  it('empty query returns all content', async () => {
    const data = await querystringSearch('/_test_data', {
      query: [],
      b_start: 0,
      b_size: 5,
    });

    assert.ok(data.items_total > 0, 'should return items with empty query');
    assert.equal(data.items.length, 5, 'b_size should limit results');
  });

  it('pagination works', async () => {
    const page1 = await querystringSearch('/_test_data', {
      query: [
        {
          i: 'path',
          o: 'plone.app.querystring.operation.string.relativePath',
          v: '.',
        },
      ],
      b_start: 0,
      b_size: 3,
    });
    const page2 = await querystringSearch('/_test_data', {
      query: [
        {
          i: 'path',
          o: 'plone.app.querystring.operation.string.relativePath',
          v: '.',
        },
      ],
      b_start: 3,
      b_size: 3,
    });

    assert.equal(page1.items.length, 3);
    assert.equal(page2.items.length, 3);
    // Pages should not overlap
    const page1Ids = page1.items.map((i) => i.id);
    const page2Ids = page2.items.map((i) => i.id);
    for (const id of page1Ids) {
      assert.ok(!page2Ids.includes(id), `${id} should not appear in both pages`);
    }
  });
});

describe('navigation', () => {
  it('returns children in folder order', async () => {
    const data = await getContent('/_test_data');

    const nav = data['@components']?.navigation;
    assert.ok(nav, 'should have navigation component');

    // _test_data itself should be in the nav tree
    const testDataNav = nav.items?.find(
      (i) => new URL(i['@id']).pathname === '/_test_data',
    );
    assert.ok(testDataNav, 'should have _test_data in navigation');
    assert.ok(testDataNav.items?.length > 0, 'should have children');

    // Children should be in alphabetical directory order
    const childIds = testDataNav.items.map(
      (i) => new URL(i['@id']).pathname.split('/').pop(),
    );
    for (let k = 1; k < childIds.length; k++) {
      assert.ok(
        childIds[k - 1] <= childIds[k],
        `Expected folder order: "${childIds[k - 1]}" should be <= "${childIds[k]}"`,
      );
    }
  });

  it('excludes Image type items from navigation', async () => {
    const data = await getContent('/_test_data');

    const nav = data['@components']?.navigation;
    const testDataNav = nav.items?.find(
      (i) => new URL(i['@id']).pathname === '/_test_data',
    );

    // _test_data contains test-image-1 and test-image-2 (type: Image)
    // These should be excluded from navigation
    const childIds = testDataNav.items.map(
      (i) => new URL(i['@id']).pathname.split('/').pop(),
    );
    assert.ok(!childIds.includes('test-image-1'), 'should exclude Image items');
    assert.ok(!childIds.includes('test-image-2'), 'should exclude Image items');
  });

  it('portal_type selection.none excludes the listed types', async () => {
    const data = await querystringSearch('/_test_data', {
      query: [
        {
          i: 'path',
          o: 'plone.app.querystring.operation.string.relativePath',
          v: '.',
        },
        {
          i: 'portal_type',
          o: 'plone.app.querystring.operation.selection.none',
          v: ['Image', 'File'],
        },
      ],
      b_start: 0,
      b_size: 50,
    });

    const ids = data.items.map((i) => i.id);
    assert.ok(ids.length > 0, 'should still return non-Image items');
    assert.ok(!ids.includes('test-image-1'), 'selection.none must drop Images');
    assert.ok(!ids.includes('test-image-2'), 'selection.none must drop Images');
    for (const item of data.items) {
      assert.notEqual(item['@type'], 'Image', `${item.id} should not be an Image`);
    }
  });

  it('portal_type selection.any keeps only the listed types', async () => {
    const data = await querystringSearch('/_test_data', {
      query: [
        {
          i: 'path',
          o: 'plone.app.querystring.operation.string.relativePath',
          v: '.',
        },
        {
          i: 'portal_type',
          o: 'plone.app.querystring.operation.selection.any',
          v: ['Image'],
        },
      ],
      b_start: 0,
      b_size: 50,
    });

    const ids = data.items.map((i) => i.id);
    assert.ok(ids.includes('test-image-1'), 'selection.any must keep Images');
    for (const item of data.items) {
      assert.equal(item['@type'], 'Image', `${item.id} should be an Image`);
    }
  });
});

describe('@site', () => {
  it('returns plone.default_language so Volto 19 SSR can resolve initialLang', async () => {
    // Volto 19's server.jsx reads
    // `state.site.data['plone.default_language']` as the middle fallback in
    // its language-resolution chain. If our mock omits this key, the
    // SSR's `toReactIntlLang(undefined)` crashes with a 500.
    // (Volto 18 used `config.settings.defaultLanguage` here instead — the
    // contract moved from frontend config to backend response.)
    const res = await fetch(`${baseUrl}/@site`, { headers: { Accept: 'application/json' } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(typeof data['plone.default_language'], 'string', '@site must include plone.default_language as a string');
    assert.ok(Array.isArray(data['plone.available_languages']), '@site must include plone.available_languages as an array (read by ManageTranslations)');
  });
});

describe('preview_image_link (volto.preview_image_link behaviour)', () => {
  // Plone's RelationChoiceFieldSerializer returns ISerializeToJsonSummary of the
  // LINKED object (plone.restapi serializer/relationfield.py:23), and plone.volto
  // registers a JSONSummarySerializerMetadata utility that adds image_field and
  // image_scales to every summary (plone.volto/src/plone/volto/summary.py).
  // So the field arrives as a summary of the Image, not a bare url string.
  it('serialises preview_image_link as a summary of the linked Image', async () => {
    const res = await fetch(`${baseUrl}/_test_data/preview-image-link`, {
      headers: { Accept: 'application/json' },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    const pil = data.preview_image_link;

    assert.equal(typeof pil, 'object', 'preview_image_link must be a summary object, not a string');
    assert.ok(pil['@id'].endsWith('/_test_data/images/test-image-1'), `got ${pil['@id']}`);
    assert.equal(pil['@type'], 'Image');
    // image_field is NULL on a relation summary — verified against real Plone
    // 6.1.5 (restapi 9.15.6) and 6.2.1 (10.0.2). The catalog BRAIN has 'image',
    // the relation summary does not. Consumers must key off image_scales.
    assert.equal(pil.image_field, null, 'real Plone leaves image_field null here');
    assert.ok(pil.image_scales, 'summary must carry image_scales');
    assert.deepEqual(Object.keys(pil.image_scales), ['image']);
    assert.equal(pil.image_scales.image[0].width, 400);
    assert.equal(pil.image_scales.image[0].height, 300);
    assert.equal(pil.image_scales.image[0].download, '@@images/image');
  });
});

describe('image blocks', () => {
  // Real Plone's serializer adds `image_scales` to an image block whose `url`
  // points at an Image object. Our content export stores only the resolveuid
  // reference, so the mock must synthesise the scales the same way — otherwise
  // frontends that read `block.image_scales` (og:image resolution, srcset)
  // silently see nothing and fixtures have to hand-embed the shape.
  //
  // Note: a real image block has NO `image_field` key; the scales are keyed
  // under `image` and `download` is RELATIVE to the image object.
  it('adds image_scales to an image block that references an Image by resolveuid', async () => {
    const res = await fetch(`${baseUrl}/_test_data/image-block-resolveuid`, {
      headers: { Accept: 'application/json' },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    const block = data.blocks['image-1'];

    assert.ok(
      block.url.endsWith('/_test_data/images/test-image-1'),
      `resolveuid should resolve to the image object, got ${block.url}`,
    );
    assert.ok(block.image_scales, 'image block must carry image_scales');

    const meta = block.image_scales.image[0];
    assert.equal(meta.width, 400, 'width comes from the referenced Image');
    assert.equal(meta.height, 300, 'height comes from the referenced Image');
    assert.equal(meta.download, '@@images/image', 'download is relative to the image object');
    assert.ok(meta.scales && Object.keys(meta.scales).length > 0, 'expected nested scales');
  });

  it('does not crash when the block url is an array of refs (Volto object-browser form)', async () => {
    // Real content stores `url` both ways: 70 blocks use a bare resolveuid
    // string, 5 use [{'@id': ...}] from the object-browser widget. A serializer
    // that assumes a string throws `url.startsWith is not a function` and takes
    // the whole content response down with it.
    const res = await fetch(`${baseUrl}/_test_data/image-block-arrayurl`, {
      headers: { Accept: 'application/json' },
    });
    assert.equal(res.status, 200, 'array-form url must not 500 the response');
    const data = await res.json();
    const block = data.blocks['image-1'];
    assert.ok(block.image_scales, 'array-form url should still resolve to image_scales');
    assert.equal(block.image_scales.image[0].width, 400);
  });

  it('leaves an image block with an external url untouched', async () => {
    const res = await fetch(`${baseUrl}/_test_data/image-block-resolveuid`, {
      headers: { Accept: 'application/json' },
    });
    const data = await res.json();
    // the title block must not sprout image_scales
    assert.equal(data.blocks['title-1'].image_scales, undefined);
  });
});

// A deployable export must bundle every referenced blob's bytes; the docs mount
// declares the generated screenshots/video (git-ignored, produced by
// record-doc-assets / cache-restore). On a fresh checkout / cache miss they are
// absent, so a full export legitimately fails on the missing bytes — skip then,
// like export-markdown-mount. This runs where the assets exist (locally, and the
// record job after `pnpm docs:assets`); the media gate is the presence check.
const HAVE_ASSETS = fs.existsSync(path.resolve(__dirname, '../../docs/images/accordion-edit.png'))
  && fs.existsSync(path.resolve(__dirname, '../../docs/static/hydra-demo.mp4'));

describe('/@export (tree export, json | markdown)', { skip: HAVE_ASSETS ? false : 'generated doc assets absent — run `pnpm docs:assets` first' }, () => {
  it('exports json as a gzipped tar distribution that validates clean', async () => {
    const res = await fetch(`${baseUrl}/@export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'json' }),
    });
    assert.equal(res.status, 200, 'export succeeded');
    // Same wire format as Plone's @@export-content: a gzipped tar.
    assert.equal(res.headers.get('content-type'), 'application/gzip');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf[0], 0x1f); assert.equal(buf[1], 0x8b); // gzip magic

    // Extract it and confirm it's a real, importable distribution.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-test-'));
    try {
      fs.writeFileSync(path.join(dir, 'export.tar.gz'), buf);
      execFileSync('tar', ['-xzf', 'export.tar.gz', '-C', dir], { cwd: dir });
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'content/__metadata__.json'), 'utf8'));
      assert.ok(meta._data_files_.length > 0, 'distribution lists data files');
      assert.ok(fs.existsSync(path.join(dir, 'content', meta._data_files_[0])), 'first data file present');
      // Blob files referenced by the tree must actually be in the tar.
      for (const blob of meta._blob_files_) {
        assert.ok(fs.existsSync(path.join(dir, 'content', blob)), `blob present: ${blob}`);
      }
      // And it passes the same validator the mounts are checked with.
      const { validate, checkIntegrity } = require('./plone-content-validator.cjs');
      const contentDir = path.join(dir, 'content');
      assert.deepEqual(validate(contentDir).errors, [], 'validate: no errors');
      assert.deepEqual(checkIntegrity(contentDir).errors, [], 'checkIntegrity: no errors');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exports markdown using the prototypes passed in the body (mock API needs no config)', async () => {
    const res = await fetch(`${baseUrl}/@export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: 'markdown',
        prototypes: { matched: '<block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />' },
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    // block-bearing items come back as markdown strings
    const md = Object.values(data).find((v) => typeof v === 'string' && v.length);
    assert.equal(typeof md, 'string');
    assert.ok(md.length > 0, 'produced markdown');
  });

  it('rejects an unknown format', async () => {
    const res = await fetch(`${baseUrl}/@export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'yaml' }),
    });
    assert.equal(res.status, 400);
  });
});
