/**
 * The pages exempt from the containment check come from the project running
 * discovery (CONTAINMENT_EXEMPT_PAGES), not from the harness. Inka's own suite
 * passes its drag-and-drop apparatus page, /_test_data/dnd-convert-page, that
 * way (tests-playwright/global-setup.ts), alongside whatever the launcher gives.
 */
import { describe, test, expect } from 'vitest';
import { isContainmentExempt, readContainmentRules } from './discover-blocks.cjs';

// A block whose container doesn't allow its type: a containment violation
// unless an exemption applies.
const misplaced = { blockType: 'convAlien', allowedSiblingTypes: ['slate'] };

describe('pages exempt from the containment check', () => {
  test('the harness names no page of its own', () => {
    expect(readContainmentRules({}).pages).toEqual([]);
  });

  test("Inka's apparatus page, given as configuration, is exempt", () => {
    const rules = readContainmentRules({ CONTAINMENT_EXEMPT_PAGES: '/_test_data/dnd-convert-page' });
    expect(isContainmentExempt(misplaced, {}, rules, '/_test_data/dnd-convert-page')).toBe(true);
    expect(isContainmentExempt(misplaced, {}, rules, '/_test_data/another-page')).toBe(false);
  });

  test("a launcher's own pages and Inka's apply together", () => {
    const rules = readContainmentRules({
      CONTAINMENT_EXEMPT_PAGES: '/dev/blocks/header, /dev/blocks/breadcrumbs,/_test_data/dnd-convert-page',
    });
    expect(rules.pages).toEqual(['/dev/blocks/header', '/dev/blocks/breadcrumbs', '/_test_data/dnd-convert-page']);
    for (const page of rules.pages) expect(isContainmentExempt(misplaced, {}, rules, page)).toBe(true);
  });
});
