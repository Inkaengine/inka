/**
 * inka#231: a template made from a container must save the container's children
 * as the template's own (templateId). The merge takes a template's blocks by
 * their templateId: unlabelled ones are dropped from the template on "Change on
 * all pages" and from every published page using it.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test('a template made from a section saves its children as the template\'s own', async ({ page, urls }) => {
  const helper = new AdminUIHelper(page);
  await helper.login();
  await helper.navigateToEdit('/section-test-page');

  const posts: any[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'POST' || !req.url().startsWith(urls.mockApi)) return;
    let body: any = null;
    try { body = req.postDataJSON(); } catch { /* not JSON */ }
    if (body?.['@type'] === 'Template') posts.push(body);
  });

  // A section's body is its children: select one, then Escape up to the section.
  await helper.clickBlockInIframe('section-child-1');
  await helper.waitForIframeBlockHandle('section-child-1');
  await helper.escapeFromEditing();
  await page.keyboard.press('Escape');
  await helper.waitForIframeBlockHandle('section-1');
  await helper.openQuantaToolbarMenu('section-1');
  await page.locator('.volto-hydra-dropdown-menu .volto-hydra-dropdown-item')
    .filter({ hasText: /make.*template/i })
    .click();
  await helper.waitForSidebarOpen();

  await helper.saveContent();

  await expect.poll(() => posts.length, { message: 'the new template is saved' }).toBeGreaterThanOrEqual(1);
  const saved = posts[posts.length - 1];
  const sections = Object.values(saved.blocks).filter((b: any) => b['@type'] === 'section') as any[];
  expect(sections).toHaveLength(1);
  const section = sections[0];
  const children = section.blocks_layout.items.map((id: string) => section.blocks[id]);
  expect(children.map((c: any) => c.plaintext)).toEqual(['Inside the section']);
  expect(children.map((c: any) => c.templateId), 'each child is the template\'s own').toEqual([section.templateId]);
});

// inka#693: what the author sets on a new template before its first save is
// saved with it. Its kind ("Fixed, read-only") was set on the page's copy only,
// and the template was saved as Make template left it.
test('a new template saves the kind chosen before its first save', async ({ page, urls }) => {
  const helper = new AdminUIHelper(page);
  await helper.login();
  await helper.navigateToEdit('/section-test-page');

  const posts: any[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'POST' || !req.url().startsWith(urls.mockApi)) return;
    let body: any = null;
    try { body = req.postDataJSON(); } catch { /* not JSON */ }
    if (body?.['@type'] === 'Template') posts.push(body);
  });

  await helper.clickBlockInIframe('section-child-1');
  await helper.waitForIframeBlockHandle('section-child-1');
  await helper.escapeFromEditing();
  await page.keyboard.press('Escape');
  await helper.waitForIframeBlockHandle('section-1');
  await helper.openQuantaToolbarMenu('section-1');
  await page.locator('.volto-hydra-dropdown-menu .volto-hydra-dropdown-item')
    .filter({ hasText: /make.*template/i })
    .click();
  await helper.waitForSidebarOpen();

  const kindField = page.locator('#sidebar-template-settings .field-wrapper-kind').last();
  await kindField.scrollIntoViewIfNeeded();
  await kindField.locator('.react-select__control').click();
  await page.locator('.react-select__menu .react-select__option', { hasText: 'Fixed, read-only' }).click();
  await expect(kindField.locator('.react-select__single-value')).toContainText('Fixed, read-only');

  await helper.saveContent();

  await expect.poll(() => posts.length, { message: 'the new template is saved' }).toBeGreaterThanOrEqual(1);
  const saved = posts[posts.length - 1];
  const sections = Object.values(saved.blocks).filter((b: any) => b['@type'] === 'section') as any[];
  expect(sections).toHaveLength(1);
  expect(sections[0]).toMatchObject({ fixed: true, readOnly: true });
  const children = sections[0].blocks_layout.items.map((id: string) => sections[0].blocks[id]);
  expect(children.map((c: any) => c.plaintext)).toEqual(['Inside the section']);
});
