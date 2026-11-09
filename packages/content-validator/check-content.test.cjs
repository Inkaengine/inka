/**
 * checkContent / checkExport: the whole check, given the schemas the content is
 * written against, so a caller doesn't assemble it from the separate checks.
 *
 * Run: node --test packages/content-validator/check-content.test.cjs
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkContent, checkExport } = require('./plone-content-validator.cjs');

const SCHEMAS = {
  hero: { blockSchema: { properties: { heading: { type: 'string' }, description: { widget: 'slate' } } } },
};
const page = (hero) => [{
  rel: '/page',
  data: { '@id': '/page', '@type': 'Document', UID: 'page-uid', id: 'page', title: 'Page',
    blocks: { h: { '@type': 'hero', ...hero } }, blocks_layout: { items: ['h'] } },
}];

describe('checkContent', () => {
  it("checks field shapes and undeclared fields against the schemas", () => {
    const { errors } = checkContent(page({ description: 'plain text', url: '/x' }), { schemas: SCHEMAS });
    assert.ok(errors.some((e) => /field "description" is widget:slate but its value is string/.test(e)), errors.join('\n'));
    assert.ok(errors.some((e) => /hero\.url/.test(e)), errors.join('\n'));
  });

  it('runs only the structural checks without schemas', () => {
    const { errors } = checkContent(page({ description: 'plain text', url: '/x' }));
    assert.ok(!errors.some((e) => /widget:slate|hero\.url/.test(e)), errors.join('\n'));
  });

  it('passes content that matches its schemas', () => {
    const { errors } = checkContent(page({ heading: 'H', description: [{ type: 'p', children: [{ text: 'x' }] }] }), { schemas: SCHEMAS });
    assert.ok(!errors.some((e) => /hero/.test(e)), errors.join('\n'));
  });
});

describe('checkExport', () => {
  it("adds the export shape to the content checks", () => {
    // A tree with no __metadata__.json is not something plone.exportimport takes.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-export-'));
    try {
      const { errors } = checkExport(dir);
      assert.ok(errors.some((e) => /__metadata__/.test(e)), errors.join('\n'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
