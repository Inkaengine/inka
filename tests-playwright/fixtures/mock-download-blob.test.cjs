/**
 * `@@download/<field>` serves a File's BYTES.
 *
 * Nothing exercised this route until a WordPress import asked it for the site's
 * videos, and it answered 500 for every one of them: the handler calls
 * `sendScaledIfAsked`, a helper declared inside the SEPARATE `@@images`
 * handler, so every download died with `ReferenceError: sendScaledIfAsked is
 * not defined`. The import reported each file as missing, skipped it, and the
 * deployed site's every video and image was a 404.
 *
 * A download is the stored bytes — real Plone's `@@download/<field>/<filename>`
 * ends in a FILENAME, not a scale, and scaling belongs to `@@images`. So these
 * cover the two things a reader needs: the right bytes, and a content type it
 * can play.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VIDEO = Buffer.from('not really an mp4, but these exact bytes', 'utf8');

/** A markdown site holding one File (how the docs keep their demo clips). */
function site() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-download-'));
  fs.writeFileSync(path.join(dir, 'demo.mp4'), VIDEO);
  fs.writeFileSync(
    path.join(dir, 'index.md'),
    [
      '---',
      'title: Home',
      'blobs:',
      '  - file: ./demo.mp4',
      '    id: demo.mp4',
      '    title: A demo clip',
      '---',
      '',
    ].join('\n'),
  );
  return dir;
}

process.env.CONTENT_MOUNTS = `/:${site()}`;
process.env.SKIP_CONTENT_VALIDATION = 'true';
const { app, ready } = require('./mock-plone-api.cjs');

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
  if (server) await new Promise((resolve) => server.close(resolve));
});

describe('@@download', () => {
  it('serves the file a markdown mount keeps beside its page', async () => {
    const res = await fetch(`${baseUrl}/demo.mp4/@@download/file`);
    assert.equal(res.status, 200, 'a download answers 200');
    assert.equal(res.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), VIDEO, 'the stored bytes');
  });

  it('answers 404 for a file the site does not have', async () => {
    const res = await fetch(`${baseUrl}/nothing-here.mp4/@@download/file`);
    assert.equal(res.status, 404);
  });
});
