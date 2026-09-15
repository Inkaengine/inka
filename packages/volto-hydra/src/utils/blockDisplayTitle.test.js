/**
 * One name for a block, wherever it is listed.
 *
 * The failure this prevents is not a crash: it is the same question reading
 * "Text" in the child list and "Your name" in a picker, which nobody reports
 * and everybody has to work around.
 */
import { describe, test, expect, vi } from 'vitest';

vi.mock('@plone/volto/registry', () => ({
  default: {
    blocks: { blocksConfig: { text: { title: 'Text' } } },
  },
}));

import { blockDisplayTitle } from './blockDisplayTitle';

const slate = (text) => [{ type: 'p', children: [{ text }] }];

describe('blockDisplayTitle', () => {
  test('a nominated field wins — a form question is its label', () => {
    const data = { '@type': 'text', label: 'Your name', plaintext: 'ignored' };
    expect(blockDisplayTitle(data, { labelField: 'label' })).toBe('Your name');
  });

  test('title, then label, then the indexed text', () => {
    expect(blockDisplayTitle({ '@type': 'text', title: 'A' })).toBe('A');
    expect(blockDisplayTitle({ '@type': 'text', label: 'B' })).toBe('B');
    expect(blockDisplayTitle({ '@type': 'text', plaintext: 'C' })).toBe('C');
  });

  test('rich text being edited beats the plaintext left by the last save', () => {
    // Nothing in the editor writes `plaintext` — the backend serializer does,
    // at save time. Preferring it would name a heading by its previous wording
    // for as long as the author kept typing.
    const data = {
      '@type': 'text',
      plaintext: 'Old heading',
      value: slate('New heading'),
    };
    expect(blockDisplayTitle(data)).toBe('New heading');
  });

  test('the stored plaintext still names a block whose text is not slate', () => {
    expect(
      blockDisplayTitle({ '@type': 'text', plaintext: 'From the server' }),
    ).toBe('From the server');
  });

  test('an emptied rich-text field does not name a block', () => {
    const data = { '@type': 'text', value: slate('   ') };
    expect(blockDisplayTitle(data)).toBe('Text');
  });

  test('a block with no words of its own is named by its type', () => {
    expect(blockDisplayTitle({ '@type': 'text' })).toBe('Text');
    expect(blockDisplayTitle({ '@type': 'unregistered' })).toBe('unregistered');
  });

  test('blank is not a name', () => {
    // An empty heading would otherwise win and leave an unreadable entry.
    expect(blockDisplayTitle({ '@type': 'text', title: '   ' })).toBe('Text');
  });

  test('the fallback names what nothing else can', () => {
    expect(blockDisplayTitle({}, { fallback: 'Item 3' })).toBe('Item 3');
  });
});
