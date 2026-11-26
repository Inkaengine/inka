/**
 * A request never rescans the content tree.
 *
 * Locally the mock used to rescan, synchronously, whenever a request
 * missed — a page, a uid it couldn't resolve, an image it couldn't find — and
 * on EVERY search without a depth, hit or miss. A run of a frontend's tests
 * rescanned thousands of times. Each rescan holds the event loop; when it lets go, Node
 * runs its timers before reading sockets, so a keep-alive connection that timed
 * out meanwhile is closed with a request already sent down it — the client
 * gets ECONNRESET and the page it was rendering fails.
 *
 * Fixtures added after startup are the file watcher's job (setupContentWatchers),
 * which reloads when the tree changes, not when it is asked.
 *
 * Runs with CI unset: CI never rescanned, so the rescans only showed locally.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

function contentTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-no-rescan-'));
  fs.mkdirSync(path.join(dir, 'page'));
  fs.writeFileSync(
    path.join(dir, 'page', 'data.json'),
    JSON.stringify({ '@id': '/page', '@type': 'Document', UID: 'norescan-page-0001', id: 'page', title: 'Page' }),
  );
  return dir;
}

delete process.env.CI;
process.env.CONTENT_MOUNTS = `/:${contentTree()}`;

// Count the rescans by what each one logs.
let scans = 0;
const log = console.log;
console.log = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('Scanning content from')) scans += 1;
  log(...args);
};

const { app } = await import('./mock-api-server.js');

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  console.log = log;
  await new Promise((resolve) => server.close(resolve));
});

describe('requests and the content tree', () => {
  it('a search without a depth does not rescan', async () => {
    const before = scans;
    const res = await fetch(`${baseUrl}/@search?portal_type=Document`, {
      headers: { Accept: 'application/json' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).items.map((i) => i.title), ['Page']);
    assert.equal(scans, before);
  });

  it('a page that is not there does not rescan', async () => {
    const before = scans;
    const res = await fetch(`${baseUrl}/no-such-page`, { headers: { Accept: 'application/json' } });
    assert.equal(res.status, 404);
    assert.equal(scans, before);
  });

  it('an image that is not there does not rescan', async () => {
    const before = scans;
    const res = await fetch(`${baseUrl}/no-such-page/@@images/image`);
    assert.equal(res.status, 404);
    assert.equal(scans, before);
  });
});
