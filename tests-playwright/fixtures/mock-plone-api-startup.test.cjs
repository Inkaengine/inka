/**
 * The mock API must LOAD with a content mount that has a __metadata__.json.
 *
 * Startup content validation runs at module load for every mount that is an
 * exportimport tree (it has __metadata__.json) — and it read `mdRuntime`
 * seventy lines before `let mdRuntime` was declared. A `let` read before its
 * declaration throws (the temporal dead zone), so the server died with
 * "Cannot access 'mdRuntime' before initialization" before serving a request.
 *
 * Only mounts WITH __metadata__.json reach that line, and this repo's own test
 * mounts had none, so every CI job stayed green while a consumer whose content
 * is an exportimport distribution could not start the mock at all. Loading in a
 * fresh process is the point: the crash happens at require time, and the
 * in-process tests load the module once with the default mounts.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MODULE = path.join(__dirname, 'mock-plone-api.cjs');
const TREE = path.resolve(__dirname, '../../docs/content/content/content');

describe('mock API startup', () => {
  it('loads with a mount that is an exportimport tree (has __metadata__.json)', () => {
    const run = spawnSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(MODULE)}); process.exit(0);`],
      {
        env: {
          ...process.env,
          CONTENT_MOUNTS: `/:${TREE}`,
          SKIP_CONTENT_VALIDATION: '',
        },
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    assert.doesNotMatch(run.stderr, /before initialization/);
    assert.equal(run.status, 0, `module failed to load:\n${run.stderr.slice(-2000)}`);
  });
});
