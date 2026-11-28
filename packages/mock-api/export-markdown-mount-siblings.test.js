/**
 * A Markdown tree keeps its site's own files (principals.json, portlets.json,
 * redirects.json, …) in its own folder, beside its index.md, as it keeps its
 * redirects. An exportimport tree keeps them beside its content folder. An
 * export of either carries them.
 *
 * The export looked only beside each mount's folder, the exportimport layout.
 * For a Markdown tree that is whatever folder it sits in: a frontend's
 * `content/`, holding its test fixtures' redirects. So a Markdown site exported
 * with its groups missing, and someone else's redirects.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

// A Markdown site in a folder that also holds another tree's files.
const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-md-siblings-'));
const site = path.join(outer, 'site');
fs.mkdirSync(site);
fs.writeFileSync(path.join(site, 'index.md'), '---\n"@type": Plone Site\nUID: plone_site_root\nid: site\ntitle: Site\n---\n');
fs.writeFileSync(path.join(site, 'page.md'), '---\n"@type": Document\nUID: page-0001\nid: page\ntitle: Page\nreview_state: published\n---\n');
const GROUPS = { groups: [{ groupid: 'Editors', title: 'Editors', description: '', email: '', groups: [], principals: [], roles: ['Editor'] }], members: [] };
const PORTLETS = { 'page-0001': { left: [] } };
fs.writeFileSync(path.join(site, 'principals.json'), JSON.stringify(GROUPS));
fs.writeFileSync(path.join(site, 'portlets.json'), JSON.stringify(PORTLETS));
fs.writeFileSync(path.join(site, 'redirects.json'), JSON.stringify({ '/old-page': '/page' }));
// Not this site's.
fs.writeFileSync(path.join(outer, 'principals.json'), JSON.stringify({ groups: [], members: [] }));
fs.writeFileSync(path.join(outer, 'redirects.json'), JSON.stringify({ '/someone-elses': '/page' }));

process.env.CONTENT_MOUNTS = `/:${site}`;
const { app, ready } = await import('./mock-plone-api.js');

let server;
let baseUrl;
before(async () => {
  await ready;
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  fs.rmSync(outer, { recursive: true, force: true });
});

const exported = async (body) => {
  const res = await fetch(`${baseUrl}/@export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-md-siblings-out-'));
  fs.writeFileSync(path.join(dir, 'e.zip'), Buffer.from(await res.arrayBuffer()));
  execFileSync('unzip', ['-q', '-o', 'e.zip'], { cwd: dir });
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  return { read, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
};

describe("a Markdown site's own files", () => {
  it('come back with a Markdown export', async () => {
    const out = await exported({ format: 'markdown' });
    try {
      assert.deepEqual(out.read('principals.json'), GROUPS);
      assert.deepEqual(out.read('portlets.json'), PORTLETS);
      assert.deepEqual(out.read('redirects.json'), { '/old-page': '/page' });
    } finally {
      out.done();
    }
  });

  it('go into an exportimport export', async () => {
    const out = await exported({ format: 'json', sitePath: '/Plone' });
    try {
      assert.deepEqual(out.read('principals.json'), GROUPS);
      assert.deepEqual(out.read('portlets.json'), PORTLETS);
      assert.deepEqual(out.read('redirects.json'), { '/Plone/old-page': '/Plone/page' });
    } finally {
      out.done();
    }
  });
});
