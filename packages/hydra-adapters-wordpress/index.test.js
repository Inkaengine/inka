import { describe, it, expect } from 'vitest';
import { serializeBlocks, parseBlocks } from './index.js';

/**
 * Blocks ride in post_content, and what carries them decides whether the
 * PUBLIC site can render at all.
 *
 * The block comment we used first is stripped twice over: kses removes HTML
 * comments on save for anyone without `unfiltered_html`, and `do_blocks`
 * removes an unregistered block type on render. Measured against a real
 * WordPress, a published page came back to an anonymous reader with
 * `content.rendered` EMPTY — the editor looked perfect and the site served
 * nothing. An element survives both.
 *
 * The frontend reads the CMS directly, with no adapter and no session, so this
 * has to work for a client holding no credentials.
 */
describe('blocks in post_content', () => {
  const roundTrip = (blocks, blocksLayout = { items: Object.keys(blocks) }) =>
    parseBlocks(serializeBlocks(blocks, blocksLayout));

  it('carries blocks in an element, not a comment', () => {
    const html = serializeBlocks({ a: { '@type': 'slate' } }, { items: ['a'] });
    expect(html).not.toContain('<!--');
    expect(html).toContain('data-hydra-blocks');
  });

  it('round-trips an apostrophe, which is what breaks a naive attribute', () => {
    // The sharp edge of this carrier. Quoting the attribute with single quotes
    // and dropping the JSON in works until someone types "don't", at which
    // point the attribute ends early and the JSON is truncated.
    const blocks = { a: { '@type': 'slate', plaintext: "don't stop" } };
    expect(roundTrip(blocks).blocks).toEqual(blocks);
  });

  it('round-trips the characters HTML itself reserves', () => {
    const blocks = {
      a: {
        '@type': 'slate',
        plaintext: 'a < b && c > d, "quoted", \'single\', ümlaut',
      },
    };
    expect(roundTrip(blocks).blocks).toEqual(blocks);
  });

  it('round-trips a nested structure with a link', () => {
    const blocks = {
      a: {
        '@type': 'slate',
        value: [
          {
            type: 'p',
            children: [
              { text: 'see ' },
              { type: 'link', data: { url: '/about' }, children: [{ text: 'about' }] },
            ],
          },
        ],
      },
    };
    expect(roundTrip(blocks)).toMatchObject({
      blocks,
      blocksLayout: { items: ['a'] },
    });
  });

  it('keeps content authored elsewhere, rather than destroying it', () => {
    const html = `<p>written in Gutenberg</p>${serializeBlocks({ a: {} }, { items: ['a'] })}`;
    const parsed = parseBlocks(html);
    expect(parsed.blocks).toEqual({ a: {} });
    expect(parsed.legacy).toBe('<p>written in Gutenberg</p>');
  });

  it('still reads the comment form a previous version wrote', () => {
    // Someone's site was edited before this changed. Refusing to open it would
    // turn a storage change into data loss.
    const legacyComment =
      '<!-- wp:hydra-blocks/document {"v":1,"blocks":{"a":{"@type":"slate"}},"blocksLayout":{"items":["a"]}} /-->';
    expect(parseBlocks(legacyComment).blocks).toEqual({ a: { '@type': 'slate' } });
  });

  it('treats content with no blocks as empty, not an error', () => {
    expect(parseBlocks('<p>just a page</p>')).toMatchObject({
      blocks: {},
      blocksLayout: { items: [] },
      legacy: '<p>just a page</p>',
    });
  });
});
