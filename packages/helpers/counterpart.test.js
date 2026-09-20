import { describe, it, expect } from 'vitest';
import { counterpartBlockId } from './index.js';

/**
 * The same block, in the other language.
 *
 * A translation's blocks are copies, and each copy records `@canonical`: the
 * id of the block it came from. That is the only pairing there is — Volto
 * writes it and never reads it — and it works in both directions, because
 * either the page you are editing is the copy or the one beside it is.
 *
 * A block added after the copy has no counterpart. Saying so plainly is the
 * point: it tells the translator this block is new.
 */
const english = {
  t1: { '@type': 'title' },
  grid: {
    '@type': 'gridBlock',
    blocks: { c1: { '@type': 'teaser' } },
    blocks_layout: { items: ['c1'] },
  },
};
const german = {
  t1de: { '@type': 'title', '@canonical': 't1' },
  gridde: {
    '@type': 'gridBlock',
    '@canonical': 'grid',
    blocks: { c1de: { '@type': 'teaser', '@canonical': 'c1' } },
    blocks_layout: { items: ['c1de'] },
  },
  fresh: { '@type': 'slate' },
};

describe('counterpartBlockId', () => {
  it('follows @canonical from the copy to the page it came from', () => {
    expect(counterpartBlockId(german, 't1de', english)).toBe('t1');
  });

  it('finds the copy from the page it was copied from', () => {
    expect(counterpartBlockId(english, 't1', german)).toBe('t1de');
  });

  it('pairs blocks nested in containers, at any depth', () => {
    expect(counterpartBlockId(german, 'c1de', english)).toBe('c1');
    expect(counterpartBlockId(english, 'c1', german)).toBe('c1de');
  });

  it('has no answer for a block added after the copy', () => {
    expect(counterpartBlockId(german, 'fresh', english)).toBeNull();
  });

  it('has no answer for a block that is not there at all', () => {
    expect(counterpartBlockId(german, 'nonsense', english)).toBeNull();
  });
});
