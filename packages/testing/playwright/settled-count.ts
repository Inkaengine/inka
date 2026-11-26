import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';

/**
 * How many elements a block's uid is on, once that has settled: three equal
 * reads in a row. A frontend can add an element for a block after the block
 * first shows — a part its own script builds and then tags with the block's
 * uid — so a count read once, the moment the block is visible, can say one
 * while the single-element checks that follow meet two.
 */
export async function settledCount(block: Locator): Promise<number> {
  let prev = -1;
  let streak = 0;
  await expect
    .poll(
      async () => {
        const n = await block.count();
        streak = n === prev ? streak + 1 : 0;
        prev = n;
        return streak >= 2;
      },
      { timeout: 15000, intervals: [200, 400, 800] },
    )
    .toBe(true);
  return prev;
}
