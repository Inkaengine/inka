import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * Reordering in the Contents view.
 *
 * The order of pages in a folder IS the order of the menu, so this gesture is
 * the one behind "the pages ARE the menu". Nothing covered it, and it did not
 * work: Volto's Contents table is a dnd-kit sortable, and a mouse-driven drag
 * never starts one — the rows look draggable, nothing reorders, and no @order
 * request is sent at all. A demo clip drove it that way for months and failed
 * somewhere else entirely, on a menu that had correctly not changed.
 *
 * Asserted on the ORDER, not on the drag: what matters is that the folder now
 * lists its children differently and says so to the backend, which is what the
 * menu reads.
 */
const FOLDER = '/_test_data';

async function rowPaths(page: any): Promise<string[]> {
  // `tbody tr`, and poll for a count — the same idiom contents-cut-paste uses.
  // The table renders empty first and fills in.
  await expect
    .poll(() => page.locator('tbody tr').count(), { timeout: 30000 })
    .toBeGreaterThan(0);
  return (await page.locator('tbody tr').allTextContents()).map((t: string) => t.trim());
}

test.describe('Contents view — reorder', () => {
  test('moving a row down reorders the folder, and it sticks', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();

    await page.goto(`${helper.adminUrl}${FOLDER}/contents`, { timeout: 60000 });
    const before = await rowPaths(page);
    expect(before.length, 'the folder has rows to reorder').toBeGreaterThan(1);

    await helper.reorderFirstContentsRow(1);

    // The table itself reordered.
    await expect
      .poll(async () => (await rowPaths(page))[0], { timeout: 10000 })
      .not.toBe(before[0]);

    // …and it was PERSISTED, not just moved in the DOM. Reload and read again:
    // a reorder the backend never heard about is not a reorder.
    await page.reload();
    const after = await rowPaths(page);
    expect(after, 'the new order survives a reload').not.toEqual(before);
  });
});
