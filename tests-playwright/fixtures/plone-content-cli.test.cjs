const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.join(__dirname, '..', '..', 'bin', 'plone-content.cjs');

/**
 * A content export with one File whose bytes are not on disk — generated media
 * (a recorded clip) that CI makes after the change that lists it is merged.
 */
function exportWithAMissingClip() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plone-content-cli-'));
  const content = path.join(root, 'content');
  fs.mkdirSync(content);
  for (const sib of ['discussions.json', 'portlets.json', 'principals.json', 'redirects.json']) {
    fs.writeFileSync(path.join(root, sib), '{}');
  }
  fs.writeFileSync(path.join(content, '__metadata__.json'), JSON.stringify({
    _data_files_: ['plone_site_root/data.json', 'clip/data.json'],
    _blob_files_: ['clip/file/clip.mp4'],
    local_roles: {
      rootuid1234567: { local_roles: { admin: ['Owner'] } },
      clipuid12345678: { local_roles: { admin: ['Owner'] } },
    },
  }));
  fs.mkdirSync(path.join(content, 'plone_site_root'));
  fs.writeFileSync(path.join(content, 'plone_site_root', 'data.json'),
    JSON.stringify({ '@id': '/', '@type': 'Plone Site', id: 'plone_site_root', UID: 'rootuid1234567' }));
  fs.mkdirSync(path.join(content, 'clip'));
  fs.writeFileSync(path.join(content, 'clip', 'data.json'), JSON.stringify({
    '@id': '/clip.mp4', '@type': 'File', id: 'clip.mp4', UID: 'clipuid12345678', parent: { '@id': '/' },
    file: { blob_path: 'clip/file/clip.mp4', filename: 'clip.mp4', 'content-type': 'video/mp4' },
  }));
  return { root, content };
}

describe('plone-content validate --allow-missing-blobs', () => {
  it('fails on a File with no bytes, and passes — still reporting it — with the flag', () => {
    const { root, content } = exportWithAMissingClip();
    const strict = spawnSync(process.execPath, [CLI, 'validate', content], { encoding: 'utf8' });
    const allowed = spawnSync(process.execPath, [CLI, 'validate', content, '--allow-missing-blobs'], { encoding: 'utf8' });
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(strict.status, 1, strict.stdout + strict.stderr);
    assert.match(strict.stdout, /clip\/file\/clip\.mp4/);
    assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
    assert.match(allowed.stdout, /clip\/file\/clip\.mp4/);
  });
});
