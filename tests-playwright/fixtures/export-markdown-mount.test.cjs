// End-to-end: a MARKDOWN mount exported through POST /@export?format=json must
// produce the same deployable .tar.gz as a JSON mount does. This is the case the
// default (JSON-only) config never exercises and the one that motivated exporting
// from memory: a markdown tree has no exportimport layout on disk, so the tar can
// only come from the decoded-in-memory content. CONTENT_MOUNTS is set BEFORE the
// api module loads (node --test isolates each file in its own process), mounting
// the real three-mount site: docs at '/docs' (the content's own absolute links
// are '/docs/...', and exported blob paths carry that prefix), the test-data
// fixtures at '/_test_data', and the test site root at '/' (home/search/templates
// — the target of the docs' cross-links to '/' and '/images/*').
const path = require('node:path');
const abs = (p) => path.resolve(__dirname, p);
process.env.CONTENT_MOUNTS = [
  '/docs:' + abs('../../docs'),
  '/_test_data:' + abs('content'),
  '/:' + abs('site-root'),
].join(',');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { app, ready } = require('./mock-plone-api.cjs');

// A deployable export must bundle every referenced blob's bytes — so this test
// needs the generated doc assets (editor screenshots, demo video) PRESENT. Those
// are git-ignored and regenerated/cache-restored (see docs/.gitignore), so on a
// fresh checkout / cache miss they are absent and export legitimately fails on
// the missing bytes. Skip then: this is an images-present test. It runs in the
// record-doc-assets CI job (after `pnpm docs:assets`) and locally where the
// images exist; the media gate `pnpm docs:assets:check` is the presence check.
const HAVE_ASSETS = fs.existsSync(abs('../../docs/images/accordion-edit.png'))
  && fs.existsSync(abs('../../docs/static/hydra-demo.mp4'));

let server, baseUrl;
before(async () => {
  await ready;
  await new Promise((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  });
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

describe('/@export json from a markdown mount', { skip: HAVE_ASSETS ? false : 'generated doc assets absent — run `pnpm docs:assets` first (images-present test)' }, () => {
  it('emits a deployable, validator-clean zip with markdown blobs bundled', async () => {
    const res = await fetch(`${baseUrl}/@export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'json' }),
    });
    assert.equal(res.status, 200, 'export succeeded');
    assert.equal(res.headers.get('content-type'), 'application/zip');
    const buf = Buffer.from(await res.arrayBuffer());

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-export-'));
    try {
      fs.writeFileSync(path.join(dir, 'e.zip'), buf);
      execFileSync('unzip', ['-q', '-o', 'e.zip'], { cwd: dir });
      const content = path.join(dir, 'content');
      const meta = JSON.parse(fs.readFileSync(path.join(content, '__metadata__.json'), 'utf8'));

      // A real tree came out of markdown-only content.
      assert.ok(meta._data_files_.length > 100, `whole tree exported (${meta._data_files_.length} items)`);
      assert.ok(meta._blob_files_.length > 0, 'blobs bundled');
      // Every referenced blob's bytes are present, normalised under its item dir.
      for (const blob of meta._blob_files_) {
        assert.ok(fs.existsSync(path.join(content, blob)), `blob present: ${blob}`);
        assert.match(blob, /\/(image|file)\//, `blob normalised under a field dir: ${blob}`);
      }
      // A leadimage (image field on a content item, not a blobs: child) rode along.
      const lead = 'docs/examples/content-types/copy_of_news-item/image/sergio-martinez-rhNJJ4eD2zk-unsplash.jpg';
      assert.ok(meta._blob_files_.includes(lead), 'content-item leadimage bytes exported');

      // Passes the same validator the JSON export is gated on.
      const { validate, checkIntegrity } = require('./plone-content-validator.cjs');
      assert.deepEqual(validate(content).errors, [], 'validate: no errors');
      assert.deepEqual(checkIntegrity(content).errors, [], 'checkIntegrity: no errors');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The markdown IS the source. `format: 'markdown'` re-emits every page, and the
// parent site runs that writeback over docs/ in CI, asserting the source comes
// back unchanged — decode(emit(source)) == source, byte for byte.
//
// Nothing in THIS repo asserted that, so prose the emitter cannot reproduce
// landed here and broke the consumer's gate instead of ours. The structural
// round-trip test (lib/prototype-roundtrip.test.mjs) does not catch it: the
// data-json escape hatch is structurally lossless, so a paragraph the emitter
// cannot write as markdown passes there while destroying the authored prose.
describe('/@export markdown re-emits docs/ unchanged', () => {
  it('every docs page comes back byte-identical to its source', async () => {
    const { DEFAULT_PROTOTYPES } = await import('../../lib/default-prototypes.mjs');
    const { restoreDirectives } = await import('../../lib/restore-directives.mjs');
    const res = await fetch(`${baseUrl}/@export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'markdown', prototypes: DEFAULT_PROTOTYPES }),
    });
    assert.equal(res.status, 200, `markdown export succeeded: ${res.status}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reemit-'));
    try {
      fs.writeFileSync(path.join(dir, 'e.zip'), Buffer.from(await res.arrayBuffer()));
      execFileSync('unzip', ['-q', '-o', 'e.zip'], { cwd: dir });

      const DOCS = abs('../../docs');
      const walk = (d, out = []) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p, out);
          else if (e.name.endsWith('.md')) out.push(p);
        }
        return out;
      };
      const exported = walk(path.join(dir, 'docs'));
      assert.ok(exported.length > 50, `the whole docs tree was emitted (${exported.length} pages)`);

      const changed = [];
      for (const file of exported) {
        const rel = path.relative(path.join(dir, 'docs'), file);
        const source = path.join(DOCS, rel);
        if (!fs.existsSync(source)) continue; // generated page with no source
        const src = fs.readFileSync(source, 'utf8');
        // The export ships directives expanded; the writeback splices the
        // authored ones back before overwriting, so compare what it would write.
        const baked = restoreDirectives(src, fs.readFileSync(file, 'utf8'), path.dirname(source));
        if (baked !== src) changed.push(rel);
      }
      assert.deepEqual(changed, [], `pages the emitter did not reproduce:\n  ${changed.join('\n  ')}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
