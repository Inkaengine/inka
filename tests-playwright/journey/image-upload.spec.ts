import { test } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { fixtureFor } from './fixtures';
import { seedFor } from './seedFor';
import { addImageBlockAndUpload, browseListing, createPage } from './steps';

/**
 * Journey step 3a, alone: dropping a file into an image block.
 *
 * The contract already proves asset.upload against all three CMSes, but it
 * calls the adapter directly — no browser, no bridge. What only a browser test
 * covers is an editor dropping a file and that upload travelling
 * admin -> bridge -> adapter -> CMS, then coming back as something the
 * frontend can render.
 */

test.beforeAll(async ({}, testInfo) => {
  await seedFor(testInfo);
});

test('an uploaded image renders in the editing surface', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const { root: ROOT } = fixtureFor(testInfo.project.name);

  const helper = new AdminUIHelper(page);
  await helper.login();
  await browseListing(page, helper, ROOT);
  await createPage(page, helper, ROOT, `Upload probe ${Date.now()}`);

  await addImageBlockAndUpload(page, helper);
});
