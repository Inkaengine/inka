import { test, expect } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { fixtureFor } from './fixtures';
import { seedWordPress } from './seedWordPress';

/**
 * The editing surface renders the document's blocks.
 *
 * Everything the journey does after creating a page depends on this: selecting
 * a block, adding one, uploading into it. When it fails, the journey reports
 * only that a block count stayed at zero, thirty seconds later, three steps in.
 * Asked against SEEDED content it needs no create step and answers in about a
 * minute.
 */

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'journey-wordpress') return;
  testInfo.setTimeout(240_000);
  await seedWordPress();
});

test('the editor renders the blocks of a seeded document', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const { target: TARGET } = fixtureFor(testInfo.project.name);

  const helper = new AdminUIHelper(page);
  await helper.login();
  await page.goto(`${helper.adminUrl}${TARGET}/edit`);

  await expect
    .poll(
      async () => {
        try {
          return (await helper.getBlockOrder()).length;
        } catch {
          // Reading the iframe mid-navigation throws; retry rather than fail.
          return 0;
        }
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
});
