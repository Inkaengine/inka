import { expect, type Page } from '@playwright/test';
import type { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * Steps shared by the journey and the focused specs.
 *
 * They exist because the two DIVERGED: image-upload.spec.ts performed what
 * looked like the same sequence as the journey's image step and passed, while
 * the journey failed, and comparing them by eye cost several six-minute runs
 * and never explained it. Running one implementation from both places makes
 * that class of difference impossible rather than hard to spot.
 */

/** Rows in the contents listing, however slow the CMS. */
export async function waitForRows(page: Page, timeout = 60_000): Promise<void> {
  await expect
    .poll(() => page.locator('tbody tr').count(), { timeout })
    .toBeGreaterThan(0);
}

/**
 * Sign in to the CMS, if the proxy says nobody is.
 *
 * This is the REAL flow, not a fixture: the proxy frame offers a button, the
 * CMS's own login and consent pages take the password, and the credential
 * comes back to the frame. It replaces a mu-plugin that treated every request
 * as the admin — which made the suite pass while testing none of the
 * authentication the design depends on.
 *
 * A no-op where the adapter is already authenticated by other means (the Plone
 * and Drupal mocks), so every spec can call it unconditionally.
 */
/**
 * Sign in, REQUIRING the panel to appear.
 *
 * For the setup spec, whose entire job is to mint the credential: "no sign-in
 * panel" cannot mean "already signed in" there, because it starts with no
 * credential at all. It waits long enough for a cold CMS to answer whoami and
 * says so plainly if the panel never comes, instead of sailing on and failing
 * later against an Unauthorized page.
 */
export async function signIn(page: Page): Promise<void> {
  const signedIn = await signInIfNeeded(page, 90_000);
  if (!signedIn) {
    throw new Error(
      'the sign-in panel never appeared, so no credential could be minted. ' +
        'The proxy frame either failed to load or never got an answer from ' +
        'the CMS.',
    );
  }
}

export async function signInIfNeeded(
  page: Page,
  // How long to wait for the panel before concluding a credential is already
  // held. The short default is the fast path for specs that load a saved
  // session; it is NOT long enough to outlast a cold CMS, so anything that
  // must actually sign in passes a real budget (see signIn above).
  panelTimeout = 8_000,
): Promise<boolean> {
  const t0 = Date.now(); // TEMP TIMING
  const proxy = page.frameLocator('#hydraProxyFrame');
  const button = proxy.locator('#go');

  const needed = await button
    .waitFor({ state: 'visible', timeout: panelTimeout })
    .then(() => true)
    .catch(() => false);
  if (!needed) return false;

  // The popup is opened BY the proxy frame, so the credential returns straight
  // to it and never passes through the admin.
  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 30_000 }),
    button.click(),
  ]);

  await popup.waitForLoadState('domcontentloaded');

  // The CMS's own login page. Framing it is impossible — WordPress sends
  // X-Frame-Options: SAMEORIGIN and frame-ancestors 'self' — which is why this
  // is a popup and not an inline form.
  //
  // WAIT for the field rather than asking isVisible(): that check is immediate,
  // so against a CMS this slow it answered "no" before the page had rendered,
  // the login was skipped, and the step then waited out its timeout on an
  // approve button that could never appear.
  const username = popup.locator('#user_login');
  const needsLogin = await username
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);

  if (needsLogin) {
    await username.fill('admin');
    await popup.locator('#user_pass').fill('password');
    await Promise.all([
      popup.waitForNavigation({ timeout: 30_000 }).catch(() => {}),
      popup.locator('#wp-submit').click(),
    ]);
  }

  // The consent step: the user approves this application BY NAME. This is the
  // screen that makes the credential delegated rather than shared — WordPress
  // mints an application password scoped to "Hydra", revocable from the user's
  // own profile.
  const approve = popup
    .locator('#approve, input[name="approve"], button[name="approve"]')
    .first();
  await approve.waitFor({ state: 'visible', timeout: 30_000 });
  await approve.click();

  // The popup closes itself once the callback has handed the credential over.
  await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => {});

  // The frame goes back to being a transport once it has a user.
  await expect(button).toBeHidden({ timeout: 30_000 });

  // Signing in reloads the admin — everything it fetched while anonymous came
  // back empty and nothing would refetch it. Wait for that reload here rather
  // than letting the next step race it.
  await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {});
  // eslint-disable-next-line no-console
  console.log('[TIME] signIn', Date.now() - t0, 'ms');
  return true;
}

/** Open a folder's contents listing and wait for it to populate. */
export async function browseListing(
  page: Page,
  helper: AdminUIHelper,
  root: string,
): Promise<void> {
  const t0 = Date.now(); // TEMP TIMING
  await page.goto(`${helper.adminUrl}${root}/contents`);
  // Before anything can be listed there has to be someone to list it for.
  const signedIn = await signInIfNeeded(page);
  // A first run pays for the whole login round trip AND the reload after it,
  // against a CMS charging ~1.1s a request. A returning one has the credential
  // already and is quick.
  await waitForRows(page, signedIn ? 120_000 : 60_000);
  // eslint-disable-next-line no-console
  console.log('[TIME] browseListing', Date.now() - t0, 'ms');
}

/**
 * Create a page in `root` and land in its editor. Returns its path.
 *
 * Whatever addable type this CMS offers FIRST: the submenu ids encode the type
 * name (#toolbar-add-document on Plone, #toolbar-add-page elsewhere), so
 * naming one would quietly make every caller a single-CMS test.
 */
export async function createPage(
  page: Page,
  helper: AdminUIHelper,
  root: string,
  title: string,
): Promise<string> {
  const t0 = Date.now(); // TEMP TIMING
  await page.locator('#toolbar-add').click();
  await page.locator('[id^="toolbar-add-"]').first().click();
  await page.waitForURL(/\/add\?type=/, { timeout: 15_000 });

  // Wait for the FIELD, not for a sidebar predicate.
  //
  // The title lives in the sidebar, and isSidebarOpen() reports whether the
  // element exists — which on a slow CMS is true before the form inside it has
  // rendered. Asking the predicate first therefore skipped opening the sidebar
  // and then failed on a field that was never coming. Waiting for the field is
  // waiting for the actual precondition; the toggle is only reached for when
  // it does not appear on its own.
  //
  // Opened HERE, on the add form, rather than later in edit mode: doing it once
  // the editor had loaded remounted the preview iframe and the next block read
  // failed with "Failed to find frame".
  const titleField = page.locator('input[id="field-title"]').first();
  const appeared = await titleField
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    await helper.openSidebar();
    await expect(titleField).toBeVisible({ timeout: 25_000 });
  }
  await titleField.fill(title);

  await page.locator('#toolbar-save, button:has-text("Save")').first().click();

  // The CMS assigned the document its own address, which it can only do if the
  // write succeeded. Deliberately NOT asserting that address contains the
  // title: how an id is derived is CMS-specific.
  await page.waitForURL((url) => !url.pathname.includes('/add'), {
    timeout: 30_000,
  });
  await expect(page).toHaveURL(new RegExp(`${root}/[^/]+(/edit)?$`), {
    timeout: 25_000,
  });
  const createdPath = new URL(page.url()).pathname.replace(/\/edit$/, '');

  if (!page.url().endsWith('/edit')) {
    // Go to the edit route directly rather than via the toolbar's Edit button.
    //
    // Saving a new document sometimes lands on its view instead of its edit
    // form, and on that first render the toolbar has no Edit button to click —
    // it is built from the document's actions, which have not arrived yet for
    // something created a moment ago. Waiting for a button that is not coming
    // hung the whole spec; what this step actually needs is to BE on the edit
    // form. (That the toolbar is briefly incomplete is worth its own test, not
    // a dependency of every spec that creates a page.)
    //
    // CLIENT-SIDE, like the editor itself. A page.goto here would reload the
    // admin mid-session: the store resets, the adapter re-registers and the
    // whole route is refetched — the costs this work exists to remove, and the
    // reason a cut clipboard went missing when the move step tried the same
    // shortcut. Entry points may load cold; steps in the middle may not.
    await page.evaluate((url) => {
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, `${createdPath}/edit`);
    await page.waitForURL(/\/edit$/, { timeout: 20_000 });
  }

  // Assert the edit form actually loaded the document BEFORE anyone touches
  // it. Without this an empty form looks identical to a loaded one until a
  // save fails validation many steps later with "Title is required", which
  // says nothing about when the title went missing.
  await expect(page.locator('input[id="field-title"]').first()).toHaveValue(
    title,
    { timeout: 45_000 },
  );

  // And that the PREVIEW caught up, not just the form. They load separately:
  // the sidebar is rendered by the admin while the blocks come from the
  // frontend in the iframe, so the title can be right while the editing
  // surface is still empty. Every caller's next move is to click a block, so
  // "created" has to mean both halves are ready — otherwise the failure lands
  // in whatever that caller did next, which is where this was found.
  await waitForBlocks(helper);

  // eslint-disable-next-line no-console
  console.log('[TIME] createPage', Date.now() - t0, 'ms');
  return createdPath;
}

/**
 * Return to a folder's listing WITHOUT a page load.
 *
 * pushState + popstate is this codebase's in-SPA idiom (see AdminUIHelper): a
 * full load is served under a different session by the mock and would land in
 * a world that never saw the create — verified, not assumed (49 rows, none of
 * them the new page). Browser history is deliberately not used either; that is
 * its own question, asked in back-navigation.spec.ts.
 */
export async function returnToListing(
  page: Page,
  root: string,
): Promise<void> {
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `${root}/contents`);
  await expect(page).toHaveURL(new RegExp(`${root}/contents$`), {
    timeout: 25_000,
  });
  await waitForRows(page);
}

/**
 * Cut a document from the listing and paste it into another folder.
 *
 * The final match is on the page's own id SEGMENT, not a rewritten full path:
 * Plone moves the object and its path follows, while Drupal and WordPress
 * build hierarchy from menu links and parent ids and deliberately leave the
 * alias alone (design spec §8b). We are looking at the target folder's own
 * listing, so a match means it is under the new parent whichever way that CMS
 * models it.
 */
export async function moveViaCutPaste(
  page: Page,
  createdPath: string,
  targetFolder: string,
  /**
   * The TITLE the page was created with. Listings show titles, and a CMS is
   * free to derive an id that looks nothing like one — Plone gave a page
   * titled "Move probe 1788…" the id "untitled-document-1788…", so matching
   * the id's last segment found no row at all.
   */
  title?: string,
): Promise<void> {
  const rowName = title
    ? new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    : nameLike(createdPath.split('/').filter(Boolean).pop()!);
  const created = page.locator('tbody tr').filter({ hasText: rowName });
  await expect(created).toHaveCount(1, { timeout: 30_000 });

  await created.locator('td').nth(1).locator('button').click();
  const cut = page.getByRole('button', { name: 'Cut', exact: true });
  await expect(cut).toBeEnabled();
  await cut.click();

  // Navigate to the destination CLIENT-SIDE, rather than clicking its row.
  //
  // Clicking required the destination to be a SIBLING of the thing being cut,
  // and folderish enough that its link opened a listing rather than a view —
  // neither of which a move requires. But it cannot be a page.goto either: the
  // cut clipboard lives in the store, and a full load resets it, leaving Paste
  // disabled forever. This is the same SPA hop the back-navigation spec uses.
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `${targetFolder}/contents`);
  await expect(page).toHaveURL(new RegExp(`${targetFolder}/contents$`), {
    timeout: 20_000,
  });
  // Nothing to wait for in the listing itself: a destination folder is often
  // EMPTY — that is the normal case for somewhere you are moving things into —
  // so it renders no rows and no table body. The Paste button becoming
  // enabled is both the readiness signal and the thing this step needs.
  const paste = page.getByRole('button', { name: 'Paste', exact: true });
  await expect(paste).toBeEnabled({ timeout: 30_000 });
  await paste.click();

  // It arrived: the same row, now in the destination listing.
  await expect(page.locator('tbody tr').filter({ hasText: rowName })).toHaveCount(
    1,
    { timeout: 30_000 },
  );
}

/** Wait until the editing surface has rendered the document's blocks. */
export async function waitForBlocks(
  helper: AdminUIHelper,
  timeout = 60_000,
): Promise<string[]> {
  await expect
    .poll(
      async () => {
        try {
          return (await helper.getBlockOrder()).length;
        } catch {
          // Reading the iframe mid-navigation throws "Execution context was
          // destroyed". That is the poll catching the route in transit, not a
          // failure — returning 0 lets it retry, and it still fails for real
          // if blocks never arrive.
          return 0;
        }
      },
      { timeout },
    )
    .toBeGreaterThan(0);
  return helper.getBlockOrder();
}

/**
 * Add an image block after the last one and drop a file into it.
 *
 * Returns the new block's uid. The drop target is the picker in the ADMIN's
 * overlay, not the <img> in the iframe: dragDropImageFile resolves coordinates
 * in the admin document, so iframe coordinates would land on the <iframe>
 * element and the drop would never reach the block.
 */
export async function addImageBlock(
  page: Page,
  helper: AdminUIHelper,
): Promise<string> {
  const before = await waitForBlocks(helper);

  await helper.clickBlockInIframe(before[before.length - 1]);
  await helper.clickAddBlockButton();
  await helper.selectBlockType('image');
  await helper.waitForBlockCountToBe(before.length + 1);

  const after = await helper.getBlockOrder();
  const imageBlock = after.find((uid) => !before.includes(uid));
  expect(imageBlock).toBeTruthy();

  // Assert the block is what we asked for rather than inferring it later from
  // a screenshot: a count that went up only proves SOMETHING was added, and
  // when this once inserted a slate block the failure surfaced eight steps
  // later as "no img with that src".
  await expect(
    page
      .locator('#sidebar-properties, .sidebar-container')
      .locator('.parent-nav')
      .first(),
  ).toContainText(/image/i, { timeout: 15_000 });

  return imageBlock!;
}

/**
 * Drop a file into the selected image block.
 *
 * The drop target is the picker in the ADMIN's overlay, not the <img> in the
 * iframe: dragDropImageFile resolves coordinates in the admin document, so
 * iframe coordinates would land on the <iframe> element and never reach the
 * block.
 */
export async function uploadIntoImageBlock(
  page: Page,
  helper: AdminUIHelper,
  filename = 'journey-upload.png',
  /** The block the image is going into; scopes the assertion below. */
  blockUid?: string,
): Promise<void> {
  const overlay = page.locator('.empty-image-overlay');
  await expect(overlay).toBeVisible({ timeout: 20_000 });
  const dropzone = overlay.locator('.hydra-image-picker-inline');
  await expect(dropzone).toBeVisible({ timeout: 15_000 });

  // hover() before dropping, not just toBeVisible().
  //
  // dragDropImageFile synthesises the drop at the element's CENTRE via
  // elementFromPoint. Visible is not the same as ready to receive events: while
  // the overlay was still settling the coordinates resolved to whatever was
  // underneath, the drop went nowhere, and NO upload request was made at all —
  // which then looked like a slow or broken upload rather than a missed click.
  // hover() runs Playwright's actionability checks (visible, stable, receives
  // events), so the drop lands on something that will accept it.
  await dropzone.scrollIntoViewIfNeeded();
  await dropzone.hover();

  await helper.dragDropImageFile(dropzone, filename);

  // Scoped to the BLOCK, not matched by filename.
  //
  // A CMS is free to name what it stores: the Plone mock calls every upload
  // "uploaded-image-<timestamp>" whatever filename was sent, so looking for
  // the sent name found nothing and read as "the upload never rendered". What
  // this step actually claims is narrower and CMS-agnostic — the block we just
  // added now renders a real image rather than its empty placeholder.
  //
  // Generous because this is a real upload to a real CMS — WordPress on
  // PHP-WASM costs about 1.1s per request.
  const rendered = blockUid
    ? `[data-block-uid="${blockUid}"] img:not([src^="data:"])`
    : `img:not([src^="data:"])`;
  await expect
    .poll(
      async () => {
        try {
          return await helper.getIframe().locator(rendered).count();
        } catch {
          return 0; // preview remounting
        }
      },
      { timeout: 90_000 },
    )
    .toBeGreaterThan(0);
  // The overlay closes once the upload lands — the editor's own signal that it
  // finished, rather than us deciding it must have.
  await expect(overlay).not.toBeVisible({ timeout: 15_000 });
}

/** Add an image block and upload into it: the journey's step 3a. */
export async function addImageBlockAndUpload(
  page: Page,
  helper: AdminUIHelper,
  filename = 'journey-upload.png',
): Promise<string> {
  const imageBlock = await addImageBlock(page, helper);
  await uploadIntoImageBlock(page, helper, filename, imageBlock);
  return imageBlock;
}

/**
 * The uid of the first IMAGE block on the page.
 *
 * Selecting blocks[0] only works on a fixture built for it. Real content puts a
 * heading or text first — no page in the docs tree leads with an image — so an
 * index made this spec unrunnable against anything but the seeded fixture.
 *
 * There is no data-block-type in the rendered DOM, so this keys off the one
 * thing an image block always renders: an <img>. Innermost wins, since a
 * container block wrapping an image also matches.
 */
/**
 * Log every CMS query the adapter issues, across all frames.
 *
 * Off unless HYDRA_AUDIT is set. The bridge turns admin intents into CMS
 * requests inside the proxy frame, so when a listing comes back wrong the only
 * way to tell "the admin asked for the wrong thing" from "the CMS answered
 * wrongly" is to read the requests themselves.
 */
/**
 * Fail if the proxy frame loads more than it should.
 *
 * The proxy hosts the adapter for the whole session and must never navigate:
 * every reload re-registers the adapter, which re-runs init() and whoami(),
 * throws away the adapter's path cache, and makes a DIFFERENT window announce
 * itself — which the admin treats as the peer being replaced, re-sending every
 * read that was in flight. On WordPress each of those is about a second.
 *
 * It is deliberately a hard failure rather than a warning: the cost is
 * invisible in a passing test, so nothing else would ever catch it.
 *
 * `allowed` is 1 for a spec that starts already signed in. Signing in reloads
 * the admin once by design, so the setup spec allows 2.
 */
export function failOnProxyReload(page: Page, allowed = 1): () => void {
  const loads: string[] = [];
  page.on('framenavigated', (frame) => {
    if (!frame.url().includes('hydra-proxy.html')) return;
    loads.push(frame.url());
    if (process.env.HYDRA_AUDIT) {
      // Visible even when the spec fails before the check runs.
      // eslint-disable-next-line no-console
      console.log(`[AUDIT] proxy load #${loads.length}: ${frame.url()}`);
    }
  });
  return () => {
    if (loads.length > allowed) {
      throw new Error(
        `the proxy frame loaded ${loads.length} times (allowed ${allowed}). ` +
          `Every load re-registers the adapter and discards its caches. ` +
          `Loads:\n  ${loads.join('\n  ')}`,
      );
    }
  };
}

export async function auditCmsRequests(page: Page): Promise<void> {
  if (!process.env.HYDRA_AUDIT) return;
  // Switches on the admin-side intent log in BridgeApi, so the CMS requests
  // below can be read next to the intent that produced them.
  await page.addInitScript(() => {
    (window as any).__HYDRA_AUDIT = true;
  });
  page.on('request', (r) => {
    // Decode FIRST: WordPress addresses the REST API as `?rest_route=/wp/v2/...`,
    // which arrives percent-encoded, so matching the raw URL silently logged
    // nothing but the admin's own traffic.
    const url = decodeURIComponent(r.url());
    if (/\/wp\/v2\/|\/jsonapi\/|\+\+api\+\+|@search|@querystring/.test(url)) {
      // eslint-disable-next-line no-console
      console.log(`[AUDIT] ${r.method()} ${url}\n         from frame: ${r.frame()?.url() ?? '?'}`);
    }
  });
  // A refused or aborted request never produces a response, so without this a
  // connection failure shows up only as an opaque console message with no URL.
  page.on('requestfailed', (r) => {
    // eslint-disable-next-line no-console
    console.log(
      `[AUDIT] FAILED ${r.method()} ${r.url()} — ${r.failure()?.errorText ?? '?'}`,
    );
  });
  page.on('response', async (res) => {
    const url = decodeURIComponent(res.url());
    if (/\/wp\/v2\/|\/jsonapi\/|\+\+api\+\+|@search|@querystring/.test(url)) {
      let size = '';
      // A listing that answers 200 but with nothing in it looks identical to a
      // listing that never arrived, so record how much came back.
      const body = await res.text().catch(() => '');
      if (body) size = ` len=${body.length} head=${body.slice(0, 120)}`;
      // eslint-disable-next-line no-console
      console.log(`[AUDIT] <- ${res.status()} ${url}${size}`);
    }
  });
}

/**
 * Wait until the editor has its CONTENT-TYPE schema, not just its blocks.
 *
 * The schema is dispatched only once the content request settles, so on a slow
 * CMS it arrives seconds after the blocks are on screen. When it lands the form
 * re-initialises, and anything mounted inside it — an open object browser, for
 * one — is torn down with it. Acting before that point races a teardown that
 * has nothing to do with what is being tested.
 *
 * The document's own title field is the observable proof: it is rendered from
 * that schema, so it cannot exist before the schema does.
 */
export async function waitForEditorSchema(page: Page): Promise<void> {
  // Addressed inside the page's own metadata form, not by accessible name.
  //
  // The first block is selected on load, and when it is an image — whose schema
  // also has a `title` — two inputs claim id="field-title". Both labels then
  // resolve to the page's input, which is announced as "Title Title", and the
  // block's own title input gets no name at all. A name query failed on that
  // while the schema had loaded perfectly well. That duplicate id is a real
  // accessibility bug in its own right; this wait just must not depend on it.
  //
  // Attached, not visible: what proves the schema landed is that the field
  // exists. Whether the page form is scrolled into view is a different question.
  await expect(
    page.locator('#sidebar-metadata #field-title'),
  ).toBeAttached({ timeout: 30_000 });
}

/**
 * Match a fixture's id against the TITLE an admin listing shows.
 *
 * Fixtures name paths and ids ("first-post", "_test_data"); every listing in
 * the admin — the object browser, the contents table — renders titles ("First
 * Post", "Test Data"). Leading underscores are dropped and separators made
 * optional so one matcher covers both, without any test having to know how a
 * given CMS derives one from the other.
 */
export const nameLike = (slug: string): RegExp =>
  new RegExp(slug.replace(/^[_-]+/, '').replace(/[-_]/g, '[ _-]?'), 'i');

export async function findImageBlockUid(
  helper: AdminUIHelper,
): Promise<string | null> {
  const iframe = helper.getIframe();
  return await iframe
    .locator('main [data-block-uid]')
    .evaluateAll((elements) => {
      const withImage = elements.filter((el) => el.querySelector('img'));
      const leaf = withImage.find(
        (el) => el.querySelectorAll('[data-block-uid] img').length === 0,
      );
      return (leaf ?? withImage[0])?.getAttribute('data-block-uid') ?? null;
    });
}

export async function pickLinkTarget(
  page: Page,
  helper: AdminUIHelper,
  root: string,
  targetPath: string,
): Promise<RegExp> {
  const linkField = page
    .locator('#sidebar-properties')
    .locator('.field-wrapper-href, #field-href')
    .first();
  await expect(linkField).toBeVisible({ timeout: 20_000 });

  const objectBrowser = await helper.openObjectBrowserFromField(linkField);

  // The browser lists TITLES ("First Post") while fixtures name paths
  // ("first-post"). Match either: how an id relates to a title is the CMS's
  // business, and pinning one shape would tie this to a single CMS.
  const targetName = nameLike(targetPath.split('/').pop()!);

  // Start from HOME, then walk down. The browser opens at the current page's
  // context — the page just created, which has no children — so the target is
  // never in that first listing.
  //
  // Going home first rather than relying on the walk-up fallback: that
  // fallback hunts for breadcrumb sections by a selector this browser does not
  // use, finds none, and silently navigates nowhere. On WordPress that left an
  // empty listing and a target that could not be found; the Home button is
  // part of the browser's own chrome and always there.
  await helper.objectBrowserNavigateHome(objectBrowser);

  // Also title-tolerant: passing the raw id matched no row, and this helper
  // treats "folder not found" as "already inside it" and navigates nowhere, so
  // the mismatch surfaced later as a missing target rather than a failed hop.
  const containingFolder = nameLike(root.split('/').filter(Boolean).pop()!);
  await helper.objectBrowserNavigateToFolder(objectBrowser, containingFolder);

  // Straight to selecting: objectBrowserSelectItem waits for the NAMED row, the
  // same shape navigateIntoItem uses in the object-browser integration specs.
  // Waiting for "a listing" in between is what went wrong before — the previous
  // folder's rows satisfy it, so the wait passes on stale content.
  await helper.objectBrowserSelectItem(objectBrowser, targetName);
  await expect(linkField).toContainText(targetName, { timeout: 10_000 });

  return targetName;
}
