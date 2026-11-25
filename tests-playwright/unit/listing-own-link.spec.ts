/**
 * A listing's own link field, edited on its results.
 *
 * A listing's results carry the listing's uid, so expandListingBlocks registers
 * the listing read-only: what a result shows (a found page's title and address)
 * is not the listing's to edit. A link field the listing's own schema declares
 * is, and its results can be where it's edited: search shortcuts' links all go
 * to its search page. That link stays editable on them; everything else stays
 * locked.
 *
 * The mock page's hero stands in for the listing: registered read-only as
 * expandListingBlocks registers one, with a link field of its own (buttonLink)
 * drawn on its button, beside text fields that are not links.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

const HERO = 'mock-multi-field-block';

test("a read-only listing's own link field is still edited where it is drawn", async ({ page, urls }) => {
  const helper = new AdminUIHelper(page);
  await page.goto(`${urls.testFrontend}/mock-parent.html`);
  await helper.waitForIframeReady();
  await helper.waitForIframeBlockHandle(HERO);
  const iframe = helper.getIframe();
  await iframe.locator('body').evaluate((_, uid) => (window as any).bridge.setBlockReadonly(uid, true), HERO);

  await iframe.locator(`[data-block-uid="${HERO}"] [data-edit-link="buttonLink"]`).click();

  await expect.poll(() => iframe.locator('body').evaluate(() => (window as any).bridge.focusedLinkableField)).toBe('buttonLink');
  // Its other fields are what results show, and stay locked.
  expect(await iframe.locator('body').evaluate((_, uid) => (window as any).bridge.isFieldReadonly('heading', uid), HERO)).toBe(true);
});
