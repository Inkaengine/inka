import { test, expect } from '@playwright/test';

import { settledCount } from '../helpers/settled-count';

/**
 * How many elements a block maps to is read once its rendering has settled.
 *
 * Block sanity checks a block one way when its uid is on one element and
 * another when it is on several (a multi-element block). A frontend can add
 * an element for a block after the block first shows — a part built by its
 * own script, then tagged with the block's uid — so a count read the moment
 * the block is visible says "one", and the single-element checks that follow
 * meet two and fail on Playwright's strict mode.
 */
test('a block that gains an element after it first shows is counted with it', async ({ page }) => {
  await page.setContent(`
    <div data-block-uid="b1">the block</div>
    <script>
      setTimeout(() => {
        const part = document.createElement('div');
        part.setAttribute('data-block-uid', 'b1');
        part.textContent = 'a part built later';
        document.body.append(part);
      }, 300);
    </script>`);
  const block = page.locator('[data-block-uid="b1"]');
  await expect(block.first()).toBeVisible();
  expect(await settledCount(block)).toBe(2);
});

test('a single-element block settles at one', async ({ page }) => {
  await page.setContent(`<div data-block-uid="b1">the block</div>`);
  expect(await settledCount(page.locator('[data-block-uid="b1"]'))).toBe(1);
});
