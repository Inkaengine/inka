import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { isContainmentExempt } = require('../helpers/discover-blocks.cjs');

/**
 * Which containers may hold a block "that doesn't belong there" is a decision
 * only the consuming project can make, so discovery takes it as a rule rather
 * than hardcoding one.
 *
 * The case that forced this: a documentation site shows every component on its
 * own doc page, inside a showcase slot of a page template. A `header` or a
 * `contentLayout` is chrome — no ordinary page region lists it in allowedBlocks,
 * and it should stay that way, or the block chooser would offer site chrome on
 * every page. But the doc page must still SHOW one. The placement is deliberate,
 * and only the project that authored the template knows which slot means "an
 * example lives here".
 *
 * Structural types stay exempt unconditionally — those are hydra's own, not a
 * project's choice.
 */

const entry = (over: Record<string, unknown> = {}) => ({
  blockType: 'header',
  isTemplateInstance: false,
  isFixed: false,
  allowedSiblingTypes: ['slate', 'image'],
  ...over,
});

test.describe('containment exemptions', () => {
  test('a block outside its container\'s allowed set is NOT exempt by default', () => {
    expect(isContainmentExempt(entry(), { '@type': 'header' }, { slots: [] })).toBe(
      false,
    );
  });

  test('a block in a slot the project nominated IS exempt', () => {
    expect(
      isContainmentExempt(entry(), { '@type': 'header', slotId: 'example' }, {
        slots: ['example'],
      }),
    ).toBe(true);
  });

  test('a slot the project did NOT nominate is still checked', () => {
    expect(
      isContainmentExempt(entry(), { '@type': 'header', slotId: 'intro' }, {
        slots: ['example'],
      }),
    ).toBe(false);
  });

  test('no rules configured means nothing extra is exempt', () => {
    expect(
      isContainmentExempt(entry(), { '@type': 'header', slotId: 'example' }, {
        slots: [],
      }),
    ).toBe(false);
  });

  test('structural types are exempt regardless of the rules', () => {
    for (const blockType of ['empty', 'column', 'title', 'description']) {
      expect(
        isContainmentExempt(entry({ blockType }), { '@type': blockType }, { slots: [] }),
      ).toBe(true);
    }
  });

  test('template-placed and fixed blocks stay exempt', () => {
    expect(
      isContainmentExempt(entry({ isTemplateInstance: true }), {}, { slots: [] }),
    ).toBe(true);
    expect(isContainmentExempt(entry({ isFixed: true }), {}, { slots: [] })).toBe(true);
  });

  test('a container that allows the type is never a violation', () => {
    expect(
      isContainmentExempt(
        entry({ allowedSiblingTypes: ['header', 'slate'] }),
        {},
        { slots: [] },
      ),
    ).toBe(true);
  });

  test('a container with no declared allowed set is not judged', () => {
    expect(
      isContainmentExempt(entry({ allowedSiblingTypes: [] }), {}, { slots: [] }),
    ).toBe(true);
  });
});
