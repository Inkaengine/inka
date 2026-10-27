/**
 * `plone-content … --json <file>`: the report as data, for a program that
 * acts on it — a site conversion that fails on errors and puts each warning
 * on its page's review list. The printed report is for people; parsing it
 * would tie that program to its wording.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', '..', 'bin', 'plone-content.cjs');

const SCHEMAS = {
  _page: {
    blockSchema: { properties: { items: { widget: 'blocks_layout', allowedBlocks: ['teaser'] } } },
  },
  banner: { group: 'common', blockSchema: { properties: {} } },
  teaser: {
    group: 'common',
    blockSchema: { properties: { title: { title: 'Title' }, image: { title: 'Image' } } },
    schemaEnhancer: {
      fieldRules: {
        image: { when: { image: { isSet: false } }, warning: 'A teaser reads better with an image.' },
      },
    },
  },
};

function run(blocks, items, mutateSchemas = null) {
  const schemas = JSON.parse(JSON.stringify(SCHEMAS));
  if (mutateSchemas) mutateSchemas(schemas);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plone-content-json-'));
  fs.mkdirSync(path.join(dir, 'content', 'x'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'content', 'x', 'data.json'),
    JSON.stringify({ '@id': '/x', '@type': 'Document', UID: 'x1', blocks, blocks_layout: { items } }),
  );
  fs.writeFileSync(path.join(dir, 'schemas.json'), JSON.stringify(schemas));
  const out = path.join(dir, 'report.json');
  const proc = spawnSync(
    process.execPath,
    [CLI, 'schema', path.join(dir, 'content'), '--schemas', path.join(dir, 'schemas.json'), '--json', out],
    { encoding: 'utf8' },
  );
  return { status: proc.status, stderr: proc.stderr, report: JSON.parse(fs.readFileSync(out, 'utf8')) };
}

describe('plone-content --json', () => {
  it('writes each check it ran: its errors, warnings and stats', () => {
    const { status, report } = run(
      { b: { '@type': 'banner', bogus: 1 }, t: { '@type': 'teaser', title: 'ok' } },
      ['b', 't'],
    );
    assert.equal(status, 1);
    assert.deepEqual(Object.keys(report).sort(), ['chooser', 'rules', 'schema']);
    assert.equal(report.schema.errors.length, 1);
    assert.match(report.schema.errors[0], /banner\.bogus/);
    assert.equal(report.rules.errors.length, 1);
    assert.match(report.rules.errors[0], /"banner" block \(b\)/);
    assert.equal(report.rules.warnings.length, 1);
    assert.match(report.rules.warnings[0], /^\s*x: a "teaser" block \(t\), image: A teaser reads better/);
    assert.equal(report.rules.stats.misplaced, 1);
  });

  it('writes a clean report, and exits 0, when nothing is wrong', () => {
    const { status, report } = run({ t: { '@type': 'teaser', title: 'ok', image: 'i' } }, ['t']);
    assert.equal(status, 0);
    assert.deepEqual(report.rules.errors, []);
    assert.deepEqual(report.rules.warnings, []);
    assert.deepEqual(report.schema.errors, []);
    assert.deepEqual(report.chooser.errors, []);
  });

  it('fails on a block the chooser cannot offer, though every page is clean', () => {
    const { status, report } = run({ t: { '@type': 'teaser', title: 'ok', image: 'i' } }, ['t'], (schemas) => {
      delete schemas.teaser.group;
    });
    assert.equal(status, 1);
    assert.deepEqual(report.rules.errors, []);
    assert.deepEqual(report.schema.errors, []);
    assert.equal(report.chooser.errors.length, 1);
    assert.match(report.chooser.errors[0], /teaser: no `group`/);
  });
});
