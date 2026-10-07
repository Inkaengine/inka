import { test, expect } from '@playwright/test';

import { wordsWithNowhereToGo } from '../helpers/elementless';

/**
 * A container may draw no element of its own — the editor finds it through its
 * children — only if it has nothing of its own to draw. Settings and children
 * need no element; words do. Words in a container with no element would land
 * inside whichever block does have one around them, and be edited as that
 * block's, so block sanity refuses them.
 */
const schema = {
  properties: {
    heading: { type: 'string', title: 'Heading' },
    intro: { widget: 'slate', title: 'Intro' },
    notes: { widget: 'textarea', title: 'Notes' },
    showToolbar: { type: 'boolean', title: 'Show toolbar' },
    layout: { type: 'string', title: 'Layout', choices: [['a', 'A'], ['b', 'B']] },
    source: { type: 'string', title: 'Source', vocabulary: { '@id': 'x' } },
  },
};

test('settings and children need no element', () => {
  expect(
    wordsWithNowhereToGo(schema, { showToolbar: true, layout: 'a', source: 'x', blocks: {} }),
  ).toEqual([]);
});

test('empty words need no element', () => {
  const emptySlate = [{ type: 'p', children: [{ text: '' }] }];
  expect(wordsWithNowhereToGo(schema, { heading: '', intro: emptySlate, notes: '  ' })).toEqual([]);
});

test('words do', () => {
  const slate = [{ type: 'p', children: [{ text: 'Hello' }] }];
  expect(wordsWithNowhereToGo(schema, { heading: 'Title', intro: slate, notes: 'n' })).toEqual([
    'heading',
    'intro',
    'notes',
  ]);
});
