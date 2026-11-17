/** Each check's summary line says what that check counted. */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatReport, checkFieldsetCoverage } = require('./plone-content-validator.cjs');

describe('formatReport', () => {
  it("summarises the fieldset check with its own counts, not the integrity check's", () => {
    const schemas = { card: { blockSchema: { fieldsets: [{ id: 'default', fields: ['title'] }], properties: { title: {}, hidden: {} } } } };
    const out = formatReport('fieldsets', checkFieldsetCoverage(schemas));
    assert.doesNotMatch(out, /undefined/);
    assert.match(out, /^Fieldsets: 2 fields, 1 not in any fieldset/m);
  });

  it('refuses a report kind it has no summary for', () => {
    assert.throws(() => formatReport('nonsense', { errors: [], stats: {} }), /nonsense/);
  });
});
