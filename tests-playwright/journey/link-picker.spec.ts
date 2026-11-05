import { test, expect } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { fixtureFor } from './fixtures';
import { seedFor } from './seedFor';
import {
  auditCmsRequests,
  failOnProxyReload,
  findImageBlockUid,
  pickLinkTarget,
  waitForBlocks,
  waitForEditorSchema,
} from './steps';

/**
 * Journey step 3b, alone: choosing a link target by browsing.
 *
 * The reference must be stored by the target's stable id rather than its path
 * — that is what makes the move in step 5 survive — so the picker is the
 * interesting half, not typing a URL. It also exercised a routing bug nothing
 * else did: the object browser names the folder in path.query rather than in
 * the URL, and reading only the URL listed the site root no matter where the
 * editor navigated.
 */

test.beforeAll(async ({}, testInfo) => {
  await seedFor(testInfo);
});

test('a link target can be picked by browsing to it', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const { root: ROOT, target: TARGET, withImage } = fixtureFor(
    testInfo.project.name,
  );
  // Fails rather than skips: a target with no seeded fixture cannot exercise
  // this, and saying so is more useful than passing silently.
  expect(withImage, 'this target seeds no page with an image block').toBeTruthy();

  const helper = new AdminUIHelper(page);
  await auditCmsRequests(page);
  // This spec loads an authenticated session, so the proxy should load ONCE.
  const assertProxyStable = failOnProxyReload(page);
  await helper.login();

  // Straight to a seeded page that already HAS an image block. Everything this
  // test used to do first — sign in, create a page, add a block, upload a file
  // — was scaffolding, and against WordPress it cost minutes. The subject is
  // the picker.
  await page.goto(`${helper.adminUrl}${withImage}/edit`);
  await waitForBlocks(helper);
  await waitForEditorSchema(page);

  const imageBlock = await findImageBlockUid(helper);
  expect(imageBlock, `${withImage} renders no image block`).toBeTruthy();
  await helper.clickBlockInIframe(imageBlock!);

  await pickLinkTarget(page, helper, ROOT, TARGET);

  assertProxyStable();
});
