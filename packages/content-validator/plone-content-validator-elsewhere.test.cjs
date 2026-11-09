// checkIntegrity over part of a site: the MCP validates a page's draft before
// it previews or saves it, with the same validator as the content in this
// repo, but the draft is one page of a live site. A link to another page is
// not broken because that page isn't among the items given: with `elsewhere`,
// such a reference is handed back, with its message, for the caller to look
// up on the site, instead of being reported broken.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { checkIntegrity } = require('./plone-content-validator.cjs');

const page = (blocks) => ({
  rel: '/news',
  data: {
    '@id': '/news', '@type': 'Document', id: 'news', UID: 'news-uid', title: 'News',
    blocks, blocks_layout: { items: Object.keys(blocks) },
  },
});
const linkingTo = (href) => page({ t: { '@type': 'teaser', href: [{ '@id': href }] } });
const SCHEMAS = { teaser: { blockSchema: { properties: { href: { widget: 'object_browser' } } } } };
const schemasFor = () => SCHEMAS;

describe('checkIntegrity elsewhere', () => {
  it('reports a link to a page not given as broken, by default', () => {
    const { errors } = checkIntegrity([linkingTo('/events')], { schemasFor });
    assert.ok(errors.some((e) => /path not in content: \/events/.test(e)), errors.join('\n'));
  });

  it('hands back a link to a page not given, with its message, for the caller to look up', () => {
    const { errors, elsewhere } = checkIntegrity([linkingTo('/events')], { schemasFor, elsewhere: true });
    assert.deepEqual(errors, []);
    assert.equal(elsewhere.length, 1);
    assert.equal(elsewhere[0].kind, 'path');
    assert.equal(elsewhere[0].value, '/events');
    assert.match(elsewhere[0].message, /\/news: block t \(teaser\) href: path not in content: \/events/);
  });

  it('hands back a resolveuid link to an item not given', () => {
    const { errors, elsewhere } = checkIntegrity([linkingTo('../resolveuid/abc123')], { schemasFor, elsewhere: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(elsewhere.map(({ kind, value }) => [kind, value]), [['uid', 'abc123'], ['uid', 'abc123']]);
    assert.ok(elsewhere.every(({ message }) => /broken resolveuid\/abc123/.test(message)));
  });

  it('resolves a link among the items given, without handing it back', () => {
    const events = { rel: '/events', data: { '@id': '/events', '@type': 'Document', id: 'events', UID: 'events-uid', title: 'Events', blocks: {}, blocks_layout: { items: [] } } };
    const { errors, elsewhere } = checkIntegrity([linkingTo('/events'), events], { schemasFor, elsewhere: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(elsewhere, []);
  });
});
