/**
 * The mock resolves redirects.json the way Plone does: its paths are PHYSICAL
 * (/Plone/old), as plone.exportimport writes and imports them, under the site
 * root's @id. The mock used to read them site-relative, so a distribution's
 * redirects passed every test against the mock and then never fired on a real
 * site — the importer stored "/old" where no request looks.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MODULE = path.join(__dirname, 'mock-plone-api.cjs');

/** A distribution whose site root is /Plone, holding /new, with `redirects`. */
function distribution(redirects) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-redirects-'));
  for (const name of ['discussions.json', 'portlets.json', 'principals.json']) {
    fs.writeFileSync(path.join(dist, name), '{}');
  }
  fs.writeFileSync(path.join(dist, 'redirects.json'), JSON.stringify(redirects));
  const content = path.join(dist, 'content');
  const item = (dir, data) => {
    fs.mkdirSync(path.join(content, dir), { recursive: true });
    fs.writeFileSync(path.join(content, dir, 'data.json'), JSON.stringify(data));
  };
  item('plone_site_root', { '@id': '/Plone', '@type': 'Plone Site', UID: 'redirects-root-0001', id: 'Plone', title: 'Site' });
  item('new', { '@id': '/new', '@type': 'Document', UID: 'redirects-new-0001', id: 'new', title: 'New' });
  return content;
}

/**
 * A markdown mount (a folder with index.md) holding /new, with `redirects` in
 * the mount's own redirects.json. Markdown has no physical path, so its
 * redirects are site-relative; the export makes them physical.
 */
function markdownMount(redirects) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-md-redirects-'));
  const page = (file, id, uid, title) => fs.writeFileSync(
    path.join(dir, file),
    `---\n"@type": Document\nid: ${id}\nUID: ${uid}\ntitle: ${title}\n---\n`,
  );
  page('index.md', 'site', 'md-redirects-root-0001', 'Site');
  page('new.md', 'new', 'md-redirects-new-0001', 'New');
  fs.writeFileSync(path.join(dir, 'redirects.json'), JSON.stringify(redirects));
  return dir;
}

/** Load the mock with `mounts` and print what `expr` (over its exports, awaited) gives. */
function evaluate(mounts, expr) {
  const run = spawnSync(
    process.execPath,
    ['-e', `const m = require(${JSON.stringify(MODULE)});
      m.ready.then(async () => {
        try { console.log('RESULT ' + JSON.stringify(await (${expr}))); process.exit(0); }
        catch (e) { console.log('THREW ' + e.message); process.exit(0); }
      });`],
    {
      env: { ...process.env, CONTENT_MOUNTS: mounts, PORT: '0', SKIP_CONTENT_VALIDATION: 'true' },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  assert.equal(run.status, 0, run.stderr.slice(-2000));
  const line = run.stdout.split('\n').find((l) => l.startsWith('RESULT ') || l.startsWith('THREW '));
  assert.ok(line, run.stdout.slice(-2000));
  return line.startsWith('RESULT ') ? { value: JSON.parse(line.slice(7)) } : { threw: line.slice(6) };
}

describe('mock API: redirects.json holds physical paths', () => {
  it('redirects /old to /new from {"/Plone/old": "/Plone/new"}', () => {
    const content = distribution({ '/Plone/old': '/Plone/new' });
    assert.deepEqual(evaluate(`/:${content}`, `m.getRedirectTarget('/old')`), { value: '/new' });
  });

  it('lists the alias site-relative in @aliases', () => {
    const content = distribution({ '/Plone/old': '/Plone/new' });
    assert.deepEqual(evaluate(`/:${content}`, `m.getAllRedirects()`), {
      value: [{ path: '/old', 'redirect-to': '/new' }],
    });
  });

  it('puts a mount prefix in front of the site-relative path', () => {
    const content = distribution({ '/Plone/old': '/Plone/new' });
    assert.deepEqual(evaluate(`/site:${content}`, `m.getRedirectTarget('/site/old')`), { value: '/site/new' });
  });

  it('serves a site-relative entry too, which is how the archive stores every other @id', () => {
    // Content ids in an exportimport archive are portal-relative (`/about`),
    // so the archive imports into a site of any id. Only redirects are keyed
    // physical, because plone.exportimport copies IRedirectionStorage verbatim
    // — which makes that one file non-portable. A distribution may therefore
    // hold either form, and the validator already accepts a wholly
    // site-relative file, reporting only a MIX. Serving it is this layer's
    // job; judging the form is the validator's.
    const content = distribution({ '/old': '/new' });
    assert.deepEqual(evaluate(`/:${content}`, `m.getRedirectTarget('/old')`), { value: '/new' });
  });
});

describe('mock API: redirects on a markdown mount', () => {
  it('reads the mount\'s own redirects.json, site-relative', () => {
    const dir = markdownMount({ '/old': '/new' });
    assert.deepEqual(evaluate(`/:${dir}`, `m.getRedirectTarget('/old')`), { value: '/new' });
  });
});

describe('@export writes redirects.json as Plone does: physical paths', () => {
  /** POST /@export with `body`; the redirects.json in the ZIP, or the error. */
  const exportRedirects = (dir, body) => {
    const zip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mock-export-')), 'export.zip');
    return evaluate(`/:${dir}`, `(async () => {
      const srv = m.app.listen(0);
      await require('events').once(srv, 'listening');
      const port = srv.address().port;
      const res = await fetch('http://localhost:' + port + '/@export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: ${JSON.stringify(JSON.stringify(body))},
      });
      if (!res.ok) return { status: res.status, body: await res.text() };
      require('fs').writeFileSync(${JSON.stringify(zip)}, Buffer.from(await res.arrayBuffer()));
      const out = require('child_process').execFileSync('unzip', ['-p', ${JSON.stringify(zip)}, 'redirects.json']);
      return JSON.parse(out);
    })()`);
  };

  it('prefixes the site path it is given', () => {
    const dir = markdownMount({ '/old': '/new' });
    assert.deepEqual(exportRedirects(dir, { format: 'json', sitePath: '/Plone' }), {
      value: { '/Plone/old': '/Plone/new' },
    });
  });

  it('refuses to export redirects without a site path', () => {
    const dir = markdownMount({ '/old': '/new' });
    const { value } = exportRedirects(dir, { format: 'json' });
    assert.equal(value.status, 400);
    assert.match(value.body, /sitePath/);
  });
});
