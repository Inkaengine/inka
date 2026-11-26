/**
 * A page made from a template stores copies of the template's locked blocks (the
 * admin's save writes the merged page). They are the template's: every reader merges
 * the template in, and the merge takes a locked block from the template. So a markdown
 * export leaves them out, and the page holds only what it says itself.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withoutTemplateOwnedBlocks } from './template-owned.js';

const slate = (text, extra) => ({ '@type': 'slate', value: [{ type: 'p', children: [{ text }] }], ...extra });
const locked = (slotId) => ({ templateId: '/templates/doc', templateInstanceId: 'i', slotId, fixed: true, readOnly: true });
const open = (slotId) => ({ templateId: '/templates/doc', templateInstanceId: 'i', slotId, fixed: false, readOnly: false });

const template = {
  '@id': '/templates/doc',
  blocks: {
    h: slate('What it is', { templateId: '/templates/doc', slotId: 'h-intro', fixed: true, readOnly: true }),
    s: slate('', { templateId: '/templates/doc', slotId: 'intro', fixed: false, readOnly: false }),
  },
  blocks_layout: { items: ['h', 's'] },
};
const templates = { '/templates/doc': template };
// Templates are referenced by path here; the mock resolves `resolveuid/…` too.
const templateFor = { pathOf: (id) => id, load: (path) => templates[path] };

describe('a markdown export leaves out the blocks a page\'s template owns', () => {
  it('drops a locked copy of the template\'s block; keeps the page\'s own', () => {
    const page = {
      '@id': '/page',
      blocks: { a: slate('What it is', locked('h-intro')), b: slate('This page says this.', open('intro')) },
      blocks_layout: { items: ['a', 'b'] },
    };
    const out = withoutTemplateOwnedBlocks(page, templateFor);
    assert.deepEqual(out.blocks_layout.items, ['b']);
    assert.deepEqual(Object.keys(out.blocks), ['b']);
  });

  it('keeps a locked container that holds the page\'s content', () => {
    const page = {
      '@id': '/page',
      blocks: {
        layout: {
          '@type': 'section', ...locked('h-intro'),
          blocks: { b: slate('Mine', open('intro')) }, blocks_layout: { items: ['b'] },
        },
      },
      blocks_layout: { items: ['layout'] },
    };
    assert.deepEqual(withoutTemplateOwnedBlocks(page, templateFor).blocks_layout.items, ['layout']);
  });

  it('keeps a locked block its template no longer has', () => {
    const page = { '@id': '/page', blocks: { a: slate('Gone', locked('removed-slot')) }, blocks_layout: { items: ['a'] } };
    assert.deepEqual(withoutTemplateOwnedBlocks(page, templateFor).blocks_layout.items, ['a']);
  });

  it('knows a template referenced by uid', () => {
    const page = { '@id': '/page', blocks: { a: slate('What it is', { ...locked('h-intro'), templateId: 'resolveuid/doc-uid' }) }, blocks_layout: { items: ['a'] } };
    const byUid = { pathOf: (id) => (id === 'resolveuid/doc-uid' ? '/templates/doc' : id), load: (path) => templates[path] };
    assert.deepEqual(withoutTemplateOwnedBlocks(page, byUid).blocks_layout.items, []);
  });

  it('leaves the template itself alone', () => {
    assert.deepEqual(withoutTemplateOwnedBlocks(template, templateFor), template);
  });

  it('fails loud on a template that isn\'t there', () => {
    const page = { '@id': '/page', blocks: { a: slate('x', { ...locked('h'), templateId: '/templates/missing' }) }, blocks_layout: { items: ['a'] } };
    assert.throws(() => withoutTemplateOwnedBlocks(page, templateFor), /\/templates\/missing/);
  });
});
