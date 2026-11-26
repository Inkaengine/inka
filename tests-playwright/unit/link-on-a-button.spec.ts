/**
 * A link edited on an element that isn't a link.
 *
 * A frontend can put a field's link annotation (data-edit-link) on whatever
 * stands for it: a search form's button stands for the page the form goes to.
 * Clicking it while editing selects that link for editing, so it must not also
 * do what the element does on the published page: a submit button would submit
 * its form and leave the page being edited.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test('clicking a submit button that carries a link edits the link, and submits nothing', async ({ page, urls }) => {
  const helper = new AdminUIHelper(page);
  await page.goto(`${urls.testFrontend}/mock-parent.html`);
  await helper.waitForIframeReady();
  await helper.waitForIframeBlockHandle('mock-block-1');
  const iframe = helper.getIframe();

  await iframe.locator('[data-block-uid="mock-block-1"]').evaluate((block) => {
    const form = document.createElement('form');
    form.id = 'search-form';
    form.action = '#submitted';
    form.innerHTML = '<input name="q" /><button type="submit" data-edit-link="searchPage">Search</button>';
    form.addEventListener('submit', () => form.setAttribute('data-submitted', 'yes'));
    block.appendChild(form);
  });

  await iframe.getByRole('button', { name: 'Search' }).click();

  // Selected for editing: the link toolbar works on the field that was clicked.
  await expect.poll(() => iframe.locator('body').evaluate(() => (window as any).bridge.focusedLinkableField)).toBe('searchPage');
  await expect(iframe.locator('#search-form')).not.toHaveAttribute('data-submitted', 'yes');
  expect(await iframe.locator('body').evaluate(() => location.hash)).toBe('');
});
