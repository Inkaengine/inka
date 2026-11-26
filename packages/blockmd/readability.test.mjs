/**
 * How readable a page's markdown is, measured from the markdown alone. A count of
 * `data-json` blocks finds only the worst case: prose in an attribute, a tag around
 * every paragraph, or a long attribute list read badly with no JSON at all.
 */
import { describe, it, expect } from 'vitest';
import { pageReadability } from './readability.mjs';

const page = (body, protos = '<block type="slate" value="${p,h*,ul,ol,strong,em,a/slate}" />') =>
  `---\n"@type": Document\nid: p\nblocks-matched: |\n  ${protos}\n---\n\n${body}\n`;

describe('words in markdown', () => {
  it('all of a page of prose', () => {
    const r = pageReadability(page('# Title\n\nA paragraph of plain words.\n\n- a list item'));
    expect(r.words).toEqual({ markdown: 9, tags: 0 });
    expect(r.prose).toBe(1);
  });

  it('prose in an attribute counts against it', () => {
    const r = pageReadability(page('Plain words here.\n\n<block type="hero" heading="A heading written in an attribute" />'));
    expect(r.words).toEqual({ markdown: 3, tags: 6 });
    expect(r.prose).toBeCloseTo(3 / 9);
  });

  it('prose in JSON counts against it; a token or a path is not prose', () => {
    const json = JSON.stringify({ description: 'Words hidden in JSON', size: 'full', url: '/a/path' });
    const r = pageReadability(page(`<block type="video" data-json='${json}' />`));
    expect(r.words).toEqual({ markdown: 0, tags: 4 });
  });
});

describe('how each block is written', () => {
  it('bare, a light tag, a fields tag, raw JSON', () => {
    const r = pageReadability(page([
      'Bare paragraph.',
      '<block type="callout">\n\nInside a light tag.\n\n</block>',
      '<fields align="left">\n\nUnder a fields tag.\n\n</fields>',
      `<block type="video" data-json='{"url":"/v.mp4"}' />`,
    ].join('\n\n'), '<block type="slate" value="${p/slate}" />\n  <block type="callout">\n    <region name="items" widget="blocks_layout">\n      <block type="slate" value="${p/slate}" />\n    </region>\n  </block>'));
    expect(r.blocks).toMatchObject({ light: 1, fields: 1, raw: 1 });
    expect(r.byType.video).toEqual({ light: 0, fields: 0, raw: 1 });
    expect(r.byType.callout).toEqual({ light: 1, fields: 0, raw: 0 });
  });
});

describe('markup overhead', () => {
  it('none on plain prose; the share of characters in tags otherwise', () => {
    expect(pageReadability(page('Just words.')).overhead).toBe(0);
    const tagged = pageReadability(page('Words.\n\n<block type="hero" heading="Heading" />'));
    expect(tagged.overhead).toBeGreaterThan(0.5);
  });
});
