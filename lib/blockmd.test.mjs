/**
 * slate <-> markdown round-trip. A slate value written to markdown and read back
 * must equal what was stored (order-insensitive; empty text leaves that Slate
 * requires around inline elements are normalised away by the engine's semantic
 * view, so the cases here avoid them).
 */
import { describe, it, expect } from 'vitest';
import { slateToMd, mdToSlate } from './blockmd.mjs';

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
});
