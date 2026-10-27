/**
 * Tests for arrow key block-to-block navigation.
 *
 * When the cursor is at the edge of a contenteditable field and an arrow key
 * is pressed in the direction matching the block's addDirection, the selection
 * should move to the adjacent block.
 *
 * For multi-field blocks, arrow keys navigate between fields first, only
 * crossing to adjacent blocks from the first/last field.
 *
 * For table mode, both vertical and horizontal directions work.
 */
import { test, expect } from './fixtures';

/**
 * Helper: select a specific block via mock parent's selectBlock API,
 * then wait for the block's editable field to become contenteditable.
 */
async function selectBlock(helper, page, blockId: string) {
  const iframe = helper.getIframe();
  await page.evaluate((id) => {
    window.mockParent.selectBlock(id);
  }, blockId);
  // Wait for the block's editable field to become contenteditable
  const blockEl = iframe.locator(`[data-block-uid="${blockId}"]`);
  await expect(blockEl).toBeAttached({ timeout: 5000 });
  await expect(
    blockEl
      .locator('[contenteditable="true"]')
      .first()
      .or(
        iframe.locator(`[data-block-uid="${blockId}"][contenteditable="true"]`),
      ),
  ).toBeAttached({ timeout: 5000 });
}

/**
 * Helper: get the block UID that currently has a contenteditable="true" field.
 * Returns the data-block-uid of the block containing the focused editable.
 */
async function getSelectedBlockId(helper): Promise<string | null> {
  const iframe = helper.getIframe();
  return await iframe
    .locator('[contenteditable="true"]')
    .first()
    .evaluate((el) => {
      // Walk up to find the data-block-uid
      let node = el as HTMLElement;
      while (node) {
        if (node.getAttribute?.('data-block-uid')) {
          return node.getAttribute('data-block-uid');
        }
        node = node.parentElement as HTMLElement;
      }
      return null;
    });
}

/**
 * Helper: get info about which field is currently focused in the iframe.
 */
async function getFocusedFieldInfo(helper): Promise<{
  blockUid: string | null;
  fieldName: string | null;
  cursorAtStart: boolean;
  cursorAtEnd: boolean;
  text: string;
}> {
  const iframe = helper.getIframe();
  return await iframe
    .locator('[contenteditable="true"]')
    .first()
    .evaluate(() => {
      const sel = window.getSelection();
      const activeEl = document.activeElement as HTMLElement;
      if (!activeEl)
        return {
          blockUid: null,
          fieldName: null,
          cursorAtStart: false,
          cursorAtEnd: false,
          text: '',
        };

      // Find the editable field
      const editableField = activeEl.closest?.('[data-edit-text]') || activeEl;
      const fieldName = editableField?.getAttribute('data-edit-text');

      // Find the block
      let blockEl = editableField;
      while (blockEl && !blockEl.getAttribute?.('data-block-uid')) {
        blockEl = blockEl.parentElement as HTMLElement;
      }
      const blockUid = blockEl?.getAttribute?.('data-block-uid') || null;

      // Get text content
      const text = editableField?.textContent || '';

      // Check cursor position
      let cursorAtStart = false;
      let cursorAtEnd = false;
      if (sel && sel.isCollapsed && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        // Check start: create range from field start to cursor
        const beforeRange = document.createRange();
        beforeRange.setStart(editableField, 0);
        beforeRange.setEnd(range.startContainer, range.startOffset);
        cursorAtStart =
          beforeRange.toString().replace(/[\u200B\u200C\u200D\uFEFF]/g, '') ===
          '';
        // Check end: create range from cursor to field end
        const afterRange = document.createRange();
        afterRange.setStart(range.endContainer, range.endOffset);
        afterRange.selectNodeContents(editableField);
        afterRange.setStart(range.endContainer, range.endOffset);
        cursorAtEnd =
          afterRange.toString().replace(/[\u200B\u200C\u200D\uFEFF]/g, '') ===
          '';
      }

      return { blockUid, fieldName, cursorAtStart, cursorAtEnd, text };
    });
}

/**
 * Helper: select a non-editable block (e.g., image) via mock parent's selectBlock API.
 * Unlike selectBlock(), does NOT wait for contenteditable fields.
 */
async function selectNonEditableBlock(helper, page, blockId: string) {
  const iframe = helper.getIframe();
  await page.evaluate((id) => {
    window.mockParent.selectBlock(id);
  }, blockId);
  // Wait for the block element to exist in DOM
  const blockEl = iframe.locator(`[data-block-uid="${blockId}"]`);
  await expect(blockEl).toBeAttached({ timeout: 5000 });
  // Wait for the BLOCK_SELECTED round-trip to complete: iframe must have
  // received the selection AND echoed BLOCK_SELECTED back to mock-parent,
  // which updates lastSelectedBlockUid. Condition-based — replaces a
  // historical fixed 200ms sleep that flaked on slow CI runners and on
  // Astro (where the renderEndpoint POST adds a network round-trip
  // before the bridge can fire BLOCK_SELECTED).
  await expect
    .poll(
      async () => {
        return await page.evaluate(
          () => window.mockParent.lastSelectedBlockUid || null,
        );
      },
      { timeout: 5000, intervals: [50, 100, 200] },
    )
    .toBe(blockId);
}

/**
 * Helper: get the last selected block UID as reported by BLOCK_SELECTED messages.
 * Works for both editable and non-editable blocks.
 */
async function getLastSelectedBlockUid(page): Promise<string | null> {
  return await page.evaluate(
    () => window.mockParent.lastSelectedBlockUid || null,
  );
}

test.describe('Arrow key block-to-block navigation', () => {
  // ── Vertical Layout Tests (addDirection: 'bottom') ────────────────────

  test.describe('Vertical layout', () => {
    test('ArrowDown at end of field navigates to next block', async ({
      helper,
      page,
    }) => {
      // Start in mock-block-1 (auto-selected by fixture), move cursor to end
      const editable = await helper.getEditorLocator('mock-block-1');
      await editable.click();
      await page.keyboard.press('End');

      // Verify cursor is at end
      const infoBefore = await getFocusedFieldInfo(helper);
      expect(infoBefore.blockUid).toBe('mock-block-1');
      expect(infoBefore.cursorAtEnd).toBe(true);

      // Press ArrowDown — should navigate to next block
      await page.keyboard.press('ArrowDown');

      // Verify mock-text-block is now selected with cursor at start
      await expect(async () => {
        const info = await getFocusedFieldInfo(helper);
        expect(info.blockUid).toBe('mock-text-block');
        expect(info.cursorAtStart).toBe(true);
      }).toPass({ timeout: 5000 });
    });

    test('ArrowUp at start of field navigates to previous block', async ({
      helper,
      page,
    }) => {
      // Select mock-text-block (second block)
      await selectBlock(helper, page, 'mock-text-block');
      const editable = await helper.getEditorLocator('mock-text-block');
      await editable.click();
      await page.keyboard.press('Home');

      // Verify cursor is at start
      const infoBefore = await getFocusedFieldInfo(helper);
      expect(infoBefore.blockUid).toBe('mock-text-block');
      expect(infoBefore.cursorAtStart).toBe(true);

      // Press ArrowUp — should navigate to previous block
      await page.keyboard.press('ArrowUp');

      // Verify mock-block-1 is now selected with cursor at end
      await expect(async () => {
        const info = await getFocusedFieldInfo(helper);
        expect(info.blockUid).toBe('mock-block-1');
        expect(info.cursorAtEnd).toBe(true);
      }).toPass({ timeout: 5000 });
    });

    test('ArrowDown at end of last block stays in same block', async ({
      helper,
      page,
    }) => {
      // Select mock-hero-block (last block)
      await selectBlock(helper, page, 'mock-hero-block');
      const iframe = helper.getIframe();

      // Focus the last editable field in hero block and move to end
      // Hero has: heading, subheading, description, buttonText
      // The last field in DOM order depends on renderer
      // Use combined selector for both mock (descendant) and nuxt (same-element) patterns
      const editables = iframe
        .locator('[data-block-uid="mock-hero-block"] [contenteditable="true"]')
        .or(
          iframe.locator(
            '[data-block-uid="mock-hero-block"][contenteditable="true"]',
          ),
        );
      const count = await editables.count();
      const lastEditable = editables.nth(count - 1);
      await lastEditable.click();
      await page.keyboard.press('End');

      // Press ArrowDown — should stay in same block
      await page.keyboard.press('ArrowDown');

      // Small delay to ensure no async navigation happens
      await page.waitForTimeout(200);

      const info = await getFocusedFieldInfo(helper);
      expect(info.blockUid).toBe('mock-hero-block');
    });

    test('ArrowUp at start of first block stays in same block', async ({
      helper,
      page,
    }) => {
      // mock-block-1 is the first block (auto-selected by fixture)
      const editable = await helper.getEditorLocator('mock-block-1');
      await editable.click();
      await page.keyboard.press('Home');

      // Verify at start
      const infoBefore = await getFocusedFieldInfo(helper);
      expect(infoBefore.blockUid).toBe('mock-block-1');
      expect(infoBefore.cursorAtStart).toBe(true);

      // Press ArrowUp — should stay in same block
      await page.keyboard.press('ArrowUp');

      await page.waitForTimeout(200);

      const info = await getFocusedFieldInfo(helper);
      expect(info.blockUid).toBe('mock-block-1');
    });

    test('ArrowDown in middle of text moves cursor but does not navigate', async ({
      helper,
      page,
    }) => {
      const editable = await helper.getEditorLocator('mock-block-1');
      await editable.click();
      // Position cursor in the middle
      await page.keyboard.press('Home');
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('ArrowRight');
      }

      const infoBefore = await getFocusedFieldInfo(helper);
      expect(infoBefore.blockUid).toBe('mock-block-1');
      expect(infoBefore.cursorAtEnd).toBe(false);

      // ArrowDown on single-line text should move to end of line (first press)
      await page.keyboard.press('ArrowDown');

      // Should still be in mock-block-1
      const info = await getFocusedFieldInfo(helper);
      expect(info.blockUid).toBe('mock-block-1');
    });

    test('ArrowRight at end does not navigate (wrong direction for bottom layout)', async ({
      helper,
      page,
    }) => {
      const editable = await helper.getEditorLocator('mock-block-1');
      await editable.click();
      await page.keyboard.press('End');

      // ArrowRight at end of single-line text — cursor can't move further
      // But ArrowRight should NOT trigger block navigation for addDirection: 'bottom'
      await page.keyboard.press('ArrowRight');

      await page.waitForTimeout(200);

      const info = await getFocusedFieldInfo(helper);
      expect(info.blockUid).toBe('mock-block-1');
    });
  });

  // ── Multi-field Block Tests ───────────────────────────────────────────

  test.describe('Multi-field blocks', () => {
    test('ArrowDown at end of first field moves to next field in same block', async ({
      helper,
      page,
    }) => {
      // Select mock-multi-field-block (hero type: heading, subheading, description, buttonText)
      await selectBlock(helper, page, 'mock-multi-field-block');
      const iframe = helper.getIframe();

      // Focus the heading field (first field) and move to end
      const headingField = iframe.locator(
        '[data-block-uid="mock-multi-field-block"] [data-edit-text="heading"]',
      );
      await headingField.click();
      await page.keyboard.press('End');

      const infoBefore = await getFocusedFieldInfo(helper);
      expect(infoBefore.fieldName).toBe('heading');
      expect(infoBefore.cursorAtEnd).toBe(true);

      // ArrowDown should move to subheading field, not next block
      await page.keyboard.press('ArrowDown');

      await expect(async () => {
        const info = await getFocusedFieldInfo(helper);
        expect(info.blockUid).toBe('mock-multi-field-block');
        expect(info.fieldName).toBe('subheading');
      }).toPass({ timeout: 5000 });
    });

    test('ArrowDown at end of last field navigates to next block', async ({
      helper,
      page,
    }) => {
      // Select mock-multi-field-block and focus the buttonText field (last)
      await selectBlock(helper, page, 'mock-multi-field-block');
      const iframe = helper.getIframe();

      const btnField = iframe.locator(
        '[data-block-uid="mock-multi-field-block"] [data-edit-text="buttonText"]',
      );
      await btnField.click();
      // Press End twice to ensure cursor reaches end (handles any initial position)
      await page.keyboard.press('End');
      await page.keyboard.press('End');

      // ArrowDown from last field should navigate to next block
      // Press twice: first moves cursor to end of line, second triggers edge navigation
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');

      await expect(async () => {
        const info = await getFocusedFieldInfo(helper);
        expect(info.blockUid).toBe('mock-textarea-block');
      }).toPass({ timeout: 5000 });
    });

    test('ArrowUp at start of second field moves to previous field in same block', async ({
      helper,
      page,
    }) => {
      await selectBlock(helper, page, 'mock-multi-field-block');
      const iframe = helper.getIframe();

      // Focus subheading field (second) and move to start
      const subField = iframe.locator(
        '[data-block-uid="mock-multi-field-block"] [data-edit-text="subheading"]',
      );
      await subField.click();
      await page.keyboard.press('Home');
      await page.keyboard.press('Home');

      // ArrowUp should move to heading field, not previous block
      // Press twice: first moves cursor to start of line, second triggers edge navigation
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');

      await expect(async () => {
        const info = await getFocusedFieldInfo(helper);
        expect(info.blockUid).toBe('mock-multi-field-block');
        expect(info.fieldName).toBe('heading');
      }).toPass({ timeout: 5000 });
    });

    test('ArrowUp at start of first field navigates to previous block', async ({
      helper,
      page,
    }) => {
      await selectBlock(helper, page, 'mock-multi-field-block');
      const iframe = helper.getIframe();

      // Focus heading field (first) and move to start
      const headingField = iframe.locator(
        '[data-block-uid="mock-multi-field-block"] [data-edit-text="heading"]',
      );
      await headingField.click();
      await page.keyboard.press('Home');
      await page.keyboard.press('Home');

      // ArrowUp from first field should navigate to previous block
      // Press twice: first moves cursor to start of line, second triggers edge navigation
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');

      await expect(async () => {
        const info = await getFocusedFieldInfo(helper);
        expect(info.blockUid).toBe('mock-text-block');
      }).toPass({ timeout: 5000 });
    });
  });

  // ── Table Mode Tests ──────────────────────────────────────────────────
  // These require table mock data: mock-table with 2 rows x 2 cells
  // mock-row-1: [mock-cell-1a, mock-cell-1b]
  // mock-row-2: [mock-cell-2a, mock-cell-2b]

  test.describe('Table mode (2D navigation)', () => {
    test('ArrowRight at end of cell navigates to next cell in same row', async ({
      helper,
      page,
    }) => {
      await selectBlock(helper, page, 'mock-cell-1a');
      const editable = await helper.getEditorLocator('mock-cell-1a');
      await editable.click();
      await page.keyboard.press('End');

      await page.keyboard.press('ArrowRight');

      await expect(async () => {
        const info = await getFocusedFieldInfo(helper);
        expect(info.blockUid).toBe('mock-cell-1b');
        expect(info.cursorAtStart).toBe(true);
      }).toPass({ timeout: 5000 });
    });

    test('ArrowLeft at start of cell navigates to previous cell in same row', async ({
      helper,
      page,
    }) => {
      await selectBlock(helper, page, 'mock-cell-1b');
      const editable = await helper.getEditorLocator('mock-cell-1b');
      await editable.click();
      await page.keyboard.press('Home');

      await page.keyboard.press('ArrowLeft');

      await expect(async () => {
        const info = await getFocusedFieldInfo(helper);
        expect(info.blockUid).toBe('mock-cell-1a');
        expect(info.cursorAtEnd).toBe(true);
      }).toPass({ timeout: 5000 });
    });

    test('ArrowDown at end of cell navigates to same-column cell in next row', async ({
      helper,
      page,
    }) => {
      await selectBlock(helper, page, 'mock-cell-1a');
      const editable = await helper.getEditorLocator('mock-cell-1a');
      await editable.click();
      await page.keyboard.press('End');

      await page.keyboard.press('ArrowDown');

      await expect(async () => {
        const info = await getFocusedFieldInfo(helper);
        expect(info.blockUid).toBe('mock-cell-2a');
        expect(info.cursorAtStart).toBe(true);
      }).toPass({ timeout: 5000 });
    });

    test('ArrowUp at start of cell navigates to same-column cell in previous row', async ({
      helper,
      page,
    }) => {
      await selectBlock(helper, page, 'mock-cell-2a');
      const editable = await helper.getEditorLocator('mock-cell-2a');
      await editable.click();
      await page.keyboard.press('Home');

      await page.keyboard.press('ArrowUp');

      await expect(async () => {
        const info = await getFocusedFieldInfo(helper);
        expect(info.blockUid).toBe('mock-cell-1a');
        expect(info.cursorAtEnd).toBe(true);
      }).toPass({ timeout: 5000 });
    });
  });

  // ── Non-editable Block Navigation ──────────────────────────────────────
  // Layout: ..., mock-textarea-block, mock-image-block, mock-columns, mock-hero-block, ...
  // mock-image-block has no editable fields (type: image)

  test.describe('Non-editable block navigation', () => {
    test('ArrowDown on selected non-editable block navigates to next block', async ({
      helper,
      page,
    }) => {
      // Select image block (no editable fields)
      await selectNonEditableBlock(helper, page, 'mock-image-block');

      // Press ArrowDown — should navigate to next sibling (mock-columns)
      await page.keyboard.press('ArrowDown');

      await expect(async () => {
        const selectedId = await getLastSelectedBlockUid(page);
        expect(selectedId).toBe('mock-columns');
      }).toPass({ timeout: 5000 });
    });

    test('ArrowUp on selected non-editable block navigates to previous block', async ({
      helper,
      page,
    }) => {
      // Select image block (no editable fields)
      await selectNonEditableBlock(helper, page, 'mock-image-block');

      // Press ArrowUp — should navigate to previous sibling (mock-textarea-block)
      await page.keyboard.press('ArrowUp');

      await expect(async () => {
        const selectedId = await getLastSelectedBlockUid(page);
        expect(selectedId).toBe('mock-textarea-block');
      }).toPass({ timeout: 5000 });
    });
  });

  // ── Container Boundary Navigation ──────────────────────────────────────
  // mock-columns has: mock-col-1 (with mock-col1-slate), mock-col-2 (with mock-col2-slate)
  // Columns are laid out with addDirection: 'right'
  // Blocks inside columns have addDirection: 'bottom'

  test.describe('Container boundary navigation', () => {
    test('ArrowUp at start of first block in container navigates to parent', async ({
      helper,
      page,
    }) => {
      // Select the only block inside col-1
      await selectBlock(helper, page, 'mock-col1-slate');
      const editable = await helper.getEditorLocator('mock-col1-slate');
      await editable.click();
      await page.keyboard.press('Home');

      // Verify at start of field
      const infoBefore = await getFocusedFieldInfo(helper);
      expect(infoBefore.blockUid).toBe('mock-col1-slate');
      expect(infoBefore.cursorAtStart).toBe(true);

      // ArrowUp — no previous sibling in col-1, should navigate to parent (mock-col-1)
      await page.keyboard.press('ArrowUp');

      await expect(async () => {
        const selectedId = await getLastSelectedBlockUid(page);
        expect(selectedId).toBe('mock-col-1');
      }).toPass({ timeout: 5000 });
    });

    test('ArrowDown at end of last block in container navigates to parent', async ({
      helper,
      page,
    }) => {
      // Select the only block inside col-1
      await selectBlock(helper, page, 'mock-col1-slate');
      const editable = await helper.getEditorLocator('mock-col1-slate');
      await editable.click();
      await page.keyboard.press('End');

      // Verify at end of field
      const infoBefore = await getFocusedFieldInfo(helper);
      expect(infoBefore.blockUid).toBe('mock-col1-slate');
      expect(infoBefore.cursorAtEnd).toBe(true);

      // ArrowDown — no next sibling in col-1, should navigate to parent (mock-col-1)
      await page.keyboard.press('ArrowDown');

      await expect(async () => {
        const selectedId = await getLastSelectedBlockUid(page);
        expect(selectedId).toBe('mock-col-1');
      }).toPass({ timeout: 5000 });
    });
  });

  // ── Focus-driven block selection ───────────────────────────────────────
  // When focus moves to an element in a different block (e.g., via Tab),
  // the block selection should update to match.

  test.describe('Focus change selects block', () => {
    test('Tab moves the selection to the next block in editing order', async ({
      helper,
      page,
    }) => {
      // Start in mock-block-1 (auto-selected by fixture)
      const editable = await helper.getEditorLocator('mock-block-1');
      await editable.click();

      // Wait for the click's BLOCK_SELECTED round-trip before pressing Tab.
      // Without this the assertion below is vacuous: lastSelectedBlockUid is
      // null until the first message lands, so any "is not mock-block-1" test
      // passes while proving nothing.
      await expect
        .poll(() => getLastSelectedBlockUid(page), { timeout: 5000 })
        .toBe('mock-block-1');

      await page.keyboard.press('Tab');

      // The EDITING order, not the page's tab order: mock-block-1's only
      // editable is its last, so the step moves to the next block. The page's
      // own tab order would have gone to a link inside mock-multi-field-block.
      await expect
        .poll(() => getLastSelectedBlockUid(page), { timeout: 5000 })
        .toBe('mock-text-block');
    });

    test("Tab between a block's own editables moves focus, not selection", async ({
      helper,
      page,
    }) => {
      await selectBlock(helper, page, 'mock-multi-field-block');
      await expect
        .poll(() => getLastSelectedBlockUid(page), { timeout: 5000 })
        .toBe('mock-multi-field-block');

      const fieldNow = () =>
        helper
          .getIframe()
          .locator('body')
          .evaluate(
            () =>
              document.activeElement?.getAttribute('data-edit-text') ?? null,
          );

      const before = await fieldNow();
      expect(
        before,
        'started in one of the block\u2019s editables',
      ).not.toBeNull();

      await page.keyboard.press('Tab');

      // Focus steps to the block's next editable...
      await expect.poll(fieldNow, { timeout: 5000 }).not.toBe(before);
      // ...and the author is still editing the same block, so selection stands.
      expect(await getLastSelectedBlockUid(page)).toBe(
        'mock-multi-field-block',
      );
    });
  });
});
