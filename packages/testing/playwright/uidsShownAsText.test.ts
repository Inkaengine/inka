/**
 * A block's uid is an internal key; a reader never sees one. When it shows in a
 * page's text, something drew the block's raw data (a fallback dumping its JSON,
 * an error naming it) instead of the block. That's the sign, whatever a frontend
 * does when it can't render a block.
 */
import { describe, test, expect } from 'vitest';
import { uidsShownAsText } from './uidsShownAsText';

describe('uids shown as text', () => {
  test('none in a page that drew its blocks', () => {
    expect(uidsShownAsText('Welcome\nOur services\nRead more', ['hero-1', 'a1b2c3d4-e5f6'])).toEqual([]);
  });

  test("a block's raw data dumped on the page", () => {
    const text = 'Unimplemented block:\n{ "@type": "listing", "@uid": "listing-7f3a" }';
    expect(uidsShownAsText(text, ['listing-7f3a', 'hero-1'])).toEqual(['listing-7f3a']);
  });

  test('whole words only: card-1 is not shown by card-10', () => {
    expect(uidsShownAsText('card-10', ['card-1', 'card-10'])).toEqual(['card-10']);
  });

  test("a uid that is an ordinary word can't be told from prose, so it isn't judged", () => {
    expect(uidsShownAsText('Read the intro first', ['intro', 'title'])).toEqual([]);
  });
});
