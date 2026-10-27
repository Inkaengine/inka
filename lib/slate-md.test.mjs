/**
 * slate <-> markdown round-trip. A slate value written to markdown and read back
 * must equal what was stored (order-insensitive; empty text leaves that Slate
 * requires around inline elements are normalised away by the engine's semantic
 * view, so the cases here avoid them).
 */
import { describe, it, expect } from 'vitest';
import { slateToMd, mdToSlate } from './slate-md.mjs';

const roundTrips = (value) => expect(mdToSlate(slateToMd(value))).toEqual(value);

describe('slate <-> markdown round-trip', () => {
  it('round-trips a plain paragraph', () => {
    roundTrips([{ type: 'p', children: [{ text: 'Hello world.' }] }]);
  });

  it('round-trips a blockquote whose children are inline (text + em)', () => {
    roundTrips([{ type: 'blockquote', children: [
      { text: 'One consequence: text typed into an ' },
      { type: 'em', children: [{ text: 'existing' }] },
      { text: ' heading updates the nav.' },
    ] }]);
  });

  // A list item may hold a quote after its text (container-blocks.md's notes).
  // Markdown nests it as a block child of the item; flattening it to inline
  // text lost the quote.
  it('round-trips a list item that holds a blockquote', () => {
    roundTrips([{ type: 'ul', children: [
      { type: 'li', children: [
        { text: 'Item text.' },
        { type: 'blockquote', children: [{ text: 'A note on the item.' }] },
      ] },
    ] }]);
  });

  it('round-trips a nested list (a list item containing a sub-list)', () => {
    roundTrips([{ type: 'ul', children: [
      { type: 'li', children: [
        { text: 'Parent item' },
        { type: 'ul', children: [
          { type: 'li', children: [{ text: 'Child one' }] },
          { type: 'li', children: [{ text: 'Child two' }] },
        ] },
      ] },
      { type: 'li', children: [{ text: 'Second parent' }] },
    ] }]);
  });

  it('round-trips a list item with a strong lead-in and a code span', () => {
    roundTrips([{ type: 'ul', children: [
      { type: 'li', children: [
        { type: 'strong', children: [{ text: 'Blocks fields' }] },
        { text: ' — use ' },
        { type: 'code', children: [{ text: 'widget' }] },
        { text: ' here.' },
      ] },
    ] }]);
  });

  it('round-trips an empty paragraph (via the mdToSlate fallback)', () => {
    roundTrips([{ type: 'p', children: [{ text: '' }] }]);
  });

  it('round-trips an inline custom mark (style-* leaf mark <-> <mark name>)', () => {
    roundTrips([{ type: 'p', children: [
      { text: 'A ' },
      { text: 'highlighted', 'style-brand-x': true },
      { text: ' word.' },
    ] }]);
  });

  it('round-trips a custom mark wrapping bold text', () => {
    roundTrips([{ type: 'p', children: [
      { text: 'See ' },
      { type: 'strong', children: [{ text: 'this', 'style-callout': true }] },
      { text: '.' },
    ] }]);
  });
});

/**
 * A line break INSIDE a markdown paragraph is a soft break, and CommonMark
 * renders it as a space. remark leaves it as a literal "\n" in the text node's
 * value, and copying that into the slate leaf put a newline in the middle of
 * running prose — which block-sanity rejects, and which no editor would ever
 * produce. Authors hard-wrap markdown; that must not change the text.
 *
 * A HARD break (two trailing spaces, or a backslash) is a different node and
 * genuinely is a line break, so it must survive.
 */
describe('markdown line breaks -> slate', () => {
  it('reads a soft break as the space CommonMark renders it as', () => {
    expect(mdToSlate('one two\nthree four')).toEqual([
      { type: 'p', children: [{ text: 'one two three four' }] },
    ]);
  });

  it('reads a soft break inside a list item the same way', () => {
    const [list] = mdToSlate('- first line\n  continues here');
    expect(JSON.stringify(list)).not.toContain('\\n');
    expect(JSON.stringify(list)).toContain('first line continues here');
  });

  it('keeps a soft break inside marked text as a space too', () => {
    const [p] = mdToSlate('**bold across\na wrap** done');
    expect(JSON.stringify(p)).toContain('bold across a wrap');
  });

  it('still keeps a hard break as a line break', () => {
    expect(mdToSlate('one\\\ntwo')).toEqual([
      { type: 'p', children: [{ text: 'one\ntwo' }] },
    ]);
  });

  // <br> is how HTML — and anyone pasting it — writes a line break, and
  // markdown allows inline HTML. It was skipped with the other inline tags,
  // which ran the words either side together: "a<br>b" became "ab".
  it.each(['<br>', '<br/>', '<br />', '<BR>'])('reads %s as a line break', (br) => {
    expect(mdToSlate(`one${br}two`)).toEqual([
      { type: 'p', children: [{ text: 'one\ntwo' }] },
    ]);
  });

  it('writes a line break as a trailing backslash, which reads back', () => {
    const value = [{ type: 'p', children: [{ text: 'one\ntwo' }] }];
    expect(slateToMd(value)).toBe('one\\\ntwo');
    expect(mdToSlate(slateToMd(value))).toEqual(value);
  });
});

/**
 * The emitter must reproduce the markdown an author wrote, not merely something
 * that parses to the same slate: the markdown IS the source, so churn in it is
 * a change to the file under version control.
 */
describe('markdown -> slate -> markdown reproduces the source', () => {
  const reEmits = (md) => expect(slateToMd(mdToSlate(md))).toBe(md);

  // `object_list`, `blocks_layout`, `check_id` — identifiers in prose, not in
  // backticks. A single underscore inside a word cannot open emphasis in
  // CommonMark, so escaping it is unnecessary, and it rewrote the author's
  // `object_list` as `object\_list` on every re-emit.
  it('leaves an intraword underscore unescaped', () => {
    reEmits('every `blocks_layout` region and every object_list field');
  });

  it('still escapes an underscore that could open emphasis', () => {
    expect(slateToMd(mdToSlate('a \\_word\\_ here'))).toBe('a \\_word\\_ here');
  });
});

describe('a list item with content after a nested list', () => {
  // docs/architecture.md writes a numbered rule whose item has a sub-list and
  // then a closing sentence. Partitioning the item's children into "inline" and
  // "block" put the closing sentence back in the FIRST paragraph, before the
  // sub-list: the round-trip failed and the whole list fell back to raw slate.
  it('round-trips, keeping the order', () => {
    roundTrips([{ type: 'ol', children: [
      { type: 'li', children: [
        { text: 'The add rules decide, in this order:' },
        { type: 'ul', children: [
          { type: 'li', children: [{ text: 'a non-fixed slot neighbour;' }] },
          { type: 'li', children: [{ text: 'a fixed anchor facing the gap.' }] },
        ] },
        { text: 'If none apply, the position is outside every template.' },
      ] },
    ] }]);
  });
});
