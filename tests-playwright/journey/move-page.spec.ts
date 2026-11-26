import { test } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { fixtureFor } from './fixtures';
import { seedFor } from './seedFor';
import {
  browseListing,
  createPage,
  moveViaCutPaste,
  returnToListing,
} from './steps';

/**
 * Journey steps 4 and 5, alone: finding a page in its parent's listing and
 * moving it elsewhere with cut and paste.
 *
 * These had no focused spec at all, which is why the journey's intermittent
 * failures kept landing here with nothing cheaper to reproduce them in.
 */

test.beforeAll(async ({}, testInfo) => {
  await seedFor(testInfo);
});

test('a page can be moved to another folder', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const { root: ROOT, moveTarget: TARGET_FOLDER } = fixtureFor(
    testInfo.project.name,
  );

  const helper = new AdminUIHelper(page);
  await helper.login();
  await browseListing(page, helper, ROOT);
  const title = `Move probe ${Date.now()}`;
  const createdPath = await createPage(page, helper, ROOT, title);

  await returnToListing(page, ROOT);
  await moveViaCutPaste(page, createdPath, TARGET_FOLDER, title);
});
