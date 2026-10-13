import { test, expect } from '@playwright/test';
import { fixtureFor } from './fixtures';
import { frontendFor, publicFrontendUrl } from './frontends';
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

  /**
   * A visitor's page: no storage, no credential on the URL, and no SESSION.
   *
   * A fresh context is not enough against WordPress. The Playground CLI mints
   * a logged-in admin session for any new client on first contact — the
   * contract target says the same and keeps a separate `publicCookie` for it —
   * so a context that merely started empty had full editor rights the moment
   * the frontend made its first request. That did not only weaken the draft
   * assertion: it made the published-page and menu checks statements about an
   * EDITOR, which is the exact confusion this spec exists to end.
   *
   * So: make contact, then drop WordPress's auth cookies and keep the rest.
   * Playground's own cookie is TRANSPORT — without it the server 302s a
   * cookie-less client to the same URL forever — while anything named
   * `wordpress_*` or `wp-settings*` is the session. A no-op against a CMS that
   * mints nothing, which is every other target here.
   */
  const visit = async (
    browser: import('@playwright/test').Browser,
    projectName: string,
    path: string,
  ) => {
    // An EXPLICITLY empty storage state, because a bare newContext() is not
    // empty: Playwright Test applies the project's `use` options to contexts
    // made from the `browser` fixture, so this inherited
    // storage-authed-wordpress.json — the editor's session AND, decisively,
    // the frontend origin's localStorage credential, which is exactly how the
    // WordPress frontend authenticates. Measured: the context arrived holding
    // auth_token and iframe_url_3001 for the admin's origin.
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const { cms } = frontendFor(projectName);
    // A REQUEST, not a navigation. It shares the context's cookie jar, which
    // is all we came for — navigating there instead left the Drupal mock's
    // unservable root as a chrome-error page that then interrupted the real
    // navigation.
    await context.request.get(`${cms}/`).catch(() => {});
    const kept = (await context.cookies()).filter(
      (c) => !/^(wordpress_|wp-settings)/.test(c.name),
    );
    await context.clearCookies();
    if (kept.length) await context.addCookies(kept);

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
      // Wait for the frontend to SETTLE, not for a fixed number of seconds.
      //
      // A flat wait passed locally for the wrong reason: WordPress-on-PHP-WASM
      // answers in about a second per request, the page was still showing
      // "Loading..." when the five seconds were up, and the assertion read
      // that as "no draft". CI was faster, rendered the draft, and failed —
      // which is the correct answer arriving by luck rather than by design.
      //
      // The title leaving "Loading..." is the frontend having DECIDED
      // something: it either rendered a page or gave up. Staying on
      // "Loading..." for the whole budget is itself the refusal — the read
      // threw and init never completed — so that is a pass, not a timeout.
      const title = () => page.locator('#page-title').textContent();
      const deadline = Date.now() + 25_000;
      let text = await title();
      while (text?.trim() === 'Loading...' && Date.now() < deadline) {
        await page.waitForTimeout(250);
        text = await title();
      }
      expect(text?.trim(), 'a visitor was served the draft').not.toBe(
        draft.title,
      );
    } finally {
      await context.close();
    }
  });
});
