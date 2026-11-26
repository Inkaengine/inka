/**
 * Capture a real Plone's `@querystring` as the mock's fixture.
 *
 * The mock's query vocabulary used to be hand-written, and it drifted: it
 * advertised 11 of plone.app.querystring's 22 indexes, offered `string.is` on
 * Creator (an operation Plone has never had), and claimed Title was sortable
 * when Plone says it is not. The admin builds its query builder, rearrange menu
 * and contents columns from this answer, so each gap is a feature tested
 * against a fiction — and each invention is an adapter that passes its contract
 * and fails against the CMS.
 *
 * Structure comes from Plone; VALUES do not. Every selection index carries a
 * `values` map that is the site's own vocabulary — the portal types it has, the
 * review states its workflows define, the subjects its authors used. Those
 * belong to whoever is answering, so they are stripped here and the mock fills
 * them from its own content.
 *
 *   node scripts/capture-querystring.mjs https://<plone>/++api++
 *
 * Needs no credential: `@querystring` is readable by anonymous.
 */
import fs from 'node:fs';
import path from 'node:path';

// Only `values` is the site's own. `vocabulary` (WHICH vocabulary an index
// draws on) and `fetch_vocabulary` (whether the server inlines its terms or
// expects the client to go and get them) are plone.app.querystring's registry
// — the same on every stock site, and the shape a consumer has to cope with.
//
// Stripping them is what hid a user-visible bug. Without them the mock said
// "no values, no vocabulary", which reads as "this index has no terms"; a real
// Plone says "fetch_vocabulary: true, vocabulary: ...Keywords, values: {}" and
// then refuses that vocabulary to an anonymous visitor. A facet UI that reads
// `index.values` therefore worked here and rendered one empty strip in
// production. Keep them.
const PER_SITE = ['values'];
const OUT = path.resolve(
  import.meta.dirname,
  '../packages/mock-api/api/querystring.json',
);

const base = process.argv[2]?.replace(/\/$/, '');
if (!base) {
  throw new Error('Usage: node scripts/capture-querystring.mjs https://<plone>/++api++');
}

const res = await fetch(`${base}/@querystring`, {
  headers: { Accept: 'application/json' },
});
if (!res.ok) {
  throw new Error(`${base}/@querystring answered ${res.status}`);
}
const live = await res.json();
if (!live.indexes || !Object.keys(live.indexes).length) {
  throw new Error('that @querystring carries no indexes');
}

const strip = (entry) =>
  Object.fromEntries(Object.entries(entry).filter(([k]) => !PER_SITE.includes(k)));

const fixture = {
  _source: `the @querystring of a real Plone, captured from ${new URL(base).host}`,
  _regenerate: 'node scripts/capture-querystring.mjs https://<plone>/++api++',
  _why:
    'The admin builds its query builder, rearrange menu and contents columns ' +
    'from this. A hand-written copy drifts, and an index or operation it ' +
    'invents is one an adapter can pass its contract against and fail on the CMS.',
  _per_site_fields_stripped: PER_SITE,
  _captured_at: new Date().toISOString().slice(0, 10),
  indexes: Object.fromEntries(
    Object.entries(live.indexes).sort(([a], [b]) => a.localeCompare(b)).map(([name, e]) => [name, strip(e)]),
  ),
  sortable_indexes: Object.fromEntries(
    Object.entries(live.sortable_indexes ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, e]) => [name, strip(e)]),
  ),
};

fs.writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(
  `wrote ${path.relative(process.cwd(), OUT)}: ` +
    `${Object.keys(fixture.indexes).length} indexes, ` +
    `${Object.keys(fixture.sortable_indexes).length} sortable`,
);
