import { test, expect } from '@playwright/test';
import { fixtureFor } from './fixtures';
import { publicFrontendUrl } from './frontends';
import { seedFor } from './seedFor';

/**
 * The PUBLIC site, on every CMS.
 *
 * Everything else in this directory drives the admin. Even view-mode-preview,
 * which says it renders "exactly as it does on the public site", loads the
 * frontend inside the admin's preview iframe with an editor signed in — so the
 * one thing it cannot tell you is what a VISITOR gets. And the contract suite's
 * public-read spec asks that of the CMS over HTTP, which proves the bytes are
 * readable without proving anything renders.
 *
 * This is the gap between them: a browser, a frontend, a CMS, and no
 * credential anywhere. It is also the configuration a real deployment serves
 * to the world, and the only one where "the adapter plays no part" is literally
 * true — the frontend reads its CMS itself.
 *
 * A FRESH context per test, built from `browser` rather than the project's
 * `page`, because the journey projects' storageState carries the editor's
 * session and the frontend origin's credential. Reusing it would make every
 * assertion here a statement about an editor, which is the mistake that made a
 * public-site test look unnecessary in the first place.
 */
test.describe('the public site', () => {
  test.beforeAll(async ({}, testInfo) => {
    await seedFor(testInfo);
  });

  /** A visitor's page: no cookies, no storage, no credential on the URL. */
  const visit = async (browser: import('@playwright/test').Browser, projectName: string, path: string) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(publicFrontendUrl(projectName, path), {
      waitUntil: 'domcontentloaded',
    });
    return { context, page };
  };

  test('serves a published page to a visitor', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const { published } = fixtureFor(testInfo.project.name);
    const { context, page } = await visit(
      browser,
      testInfo.project.name,
      published.path,
    );
    try {
      await expect(page.locator('#page-title')).toHaveText(published.title, {
        timeout: 60_000,
      });
      // The BODY, not just the title: a frontend that renders a heading from
      // the path and nothing else would pass a title-only check.
      await expect(
        page.locator('[data-block-uid]').filter({ hasText: published.text }),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await context.close();
    }
  });

  test('serves the menu to a visitor', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const { published, root } = fixtureFor(testInfo.project.name);
    const { context, page } = await visit(
      browser,
      testInfo.project.name,
      published.path,
    );
    try {
      // The navigation a visitor is served, rendered. The CMS half of this is
      // the contract suite's business (publicNavigation / publicMenuEntries);
      // what this adds is that the frontend turns it into links — on WordPress
      // that answer only exists because the fixture carries WPGraphQL, and
      // core WordPress serves a visitor no menu at all.
      const links = page.locator('#navigation a');
      await expect(links.first()).toBeVisible({ timeout: 60_000 });
      const hrefs = await links.evaluateAll((els) =>
        els.map((el) => new URL((el as HTMLAnchorElement).href).pathname),
      );
      expect(hrefs, `menu on ${testInfo.project.name}`).toContain(root);
    } finally {
      await context.close();
    }
  });

  test('does not serve a draft to a visitor', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const { draft } = fixtureFor(testInfo.project.name);
    const { context, page } = await visit(
      browser,
      testInfo.project.name,
      draft.path,
    );
    try {
      // Deliberately NOT asserting a particular failure shape: each CMS
      // refuses differently — Plone and WordPress answer 401, Strapi simply
      // has no published variant to find — and the frontend turns one into an
      // aborted init and the other into a not-found page. What must hold
      // everywhere is that the draft's own title never reaches the visitor.
      //
      // Given time to be wrong: a poll that settles immediately would pass
      // against a page that renders the draft a second later.
      await page.waitForTimeout(5_000);
      await expect(page.locator('#page-title')).not.toHaveText(draft.title);
    } finally {
      await context.close();
    }
  });
});
