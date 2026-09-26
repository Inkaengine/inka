import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { paragraphShapeOf } = require('../helpers/discover-blocks.cjs');

/**
 * What block-sanity may reject in a slate text leaf.
 *
 * A single "\n" is a LINE BREAK, and Volto's own editor stores one exactly like
 * that: Shift+Enter is editor.insertText('\n'), rendered as <br/>. The rule used
 * to reject every newline, which failed that along with the content it was
 * actually aimed at — paragraphs or bullets pasted into one leaf.
 */
test.describe('slate text leaf: line breaks vs paragraph-shaped content', () => {
  test('a line break is valid slate', () => {
    expect(paragraphShapeOf('line one\nline two')).toBeNull();
  });

  test('several line breaks are still just lines', () => {
    expect(paragraphShapeOf('Street\nTown\nPostcode')).toBeNull();
  });

  test('a trailing line break is valid', () => {
    expect(paragraphShapeOf('line one\n')).toBeNull();
  });

  test('text with no newline is valid', () => {
    expect(paragraphShapeOf('just prose')).toBeNull();
  });

  test('a blank line is a paragraph break stuffed into one leaf', () => {
    expect(paragraphShapeOf('first paragraph\n\nsecond paragraph')).toMatch(/paragraph/);
  });

  test('a blank line holding only spaces is still a paragraph break', () => {
    expect(paragraphShapeOf('first\n   \nsecond')).toMatch(/paragraph/);
  });

  for (const [kind, text] of [
    ['dashes', '- one\n- two'],
    ['asterisks', '* one\n* two'],
    ['numbers', '1. one\n2. two'],
    ['bullets', '• one\n• two'],
    ['a list after a lead-in line', 'Includes:\n- one\n- two'],
  ]) {
    test(`lines that start like list items (${kind}) are a list stuffed into one leaf`, () => {
      expect(paragraphShapeOf(text)).toMatch(/list/);
    });
  }
});
