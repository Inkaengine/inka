import { test, expect } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { fixtureFor } from './fixtures';
import { seedFor } from './seedFor';
import { browseListing, createPage, waitForBlocks } from './steps';

/**
 * Journey step 2, alone: creating a page.
 *
 * One question, answered in about a minute instead of six. Everything after it
 * in the journey — selecting a block, uploading, linking, moving — depends on
 * this working, so when it breaks there it breaks everything downstream and
 * says very little about which part failed.
 */

test.beforeAll(async ({}, testInfo) => {
  await seedFor(testInfo);
});

test('a created page comes back with its title and something to edit', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const { root: ROOT } = fixtureFor(testInfo.project.name);

  const helper = new AdminUIHelper(page);
  await helper.login();
  await browseListing(page, helper, ROOT);

  const title = `Probe ${Date.now()}`;
  await createPage(page, helper, ROOT, title);

  // A NEW document must arrive with something to edit. Seeded documents render
  // their blocks fine, so this is specifically about what a create produces:
  // config.blocks.initialBlocks is keyed by content type, and every key was
  // once a Plone type name, leaving a new page on any other CMS with nothing.
  const blocks = await waitForBlocks(helper);
  expect(blocks.length).toBeGreaterThan(0);
});
