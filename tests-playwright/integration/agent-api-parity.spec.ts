/**
 * An agent edits as a person does: each case here is done twice, once through
 * the editor's own gestures (clicks, the chooser, the template lock) and once
 * through the agent API (window.__inkaAgent), each in its own session, and the
 * page each one saves must be the same. Where the editor offers no way to do
 * something, the agent API must refuse it.
 *
 * The agent API only calls the editor's handlers; these cases are what keeps
 * it that way. A new gap between them belongs here, as a case that fails.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

const PAGE = '/template-test-page';
const STORED = `/_test_data${PAGE}`;
const TEMPLATE = '/_test_data/templates/test-layout';

/** Run `fn` against window.__inkaAgent in the admin page; a refusal comes back as its message. */
const agent = <T>(page: Page, fn: (a: any, arg: any) => T | Promise<T>, arg?: any): Promise<T> =>
  page.evaluate(([src, a]: [string, any]) => {
    const run = new Function('agent', 'arg', `return (${src})(agent, arg);`);
    return run((window as any).__inkaAgent, a);
  }, [fn.toString(), arg]);
const refusal = (page: Page, fn: (a: any, arg: any) => Promise<unknown>, arg?: any) =>
  agent(page, (a, [src, x]) => new Function('a', 'x', `return (${src})(a, x);`)(a, x).then(() => null, (e: Error) => e.message),
    [fn.toString(), arg]);

/** A stored document as this page's session has it. */
async function stored(mockApi: string, page: Page, path: string) {
  const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')!.value;
  const res = await page.request.get(`${mockApi}${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `GET ${path}`).toBeTruthy();
  return res.json();
}

/** What a page holds, in order, without the ids a new block is minted: type, slot, and text. */
function shape(doc: any) {
  const text = (v: any): string => (Array.isArray(v) ? v.map((n) => (n.text ?? '') + text(n.children)).join('') : '');
  return doc.blocks_layout.items.map((id: string) => {
    const b = doc.blocks[id];
    return { type: b['@type'], slot: b.slotId ?? null, fixed: !!b.fixed, text: text(b.value) };
  });
}

/** A signed-in editor on the page, in a session of its own. */
async function editing(page: Page) {
  const helper = new AdminUIHelper(page);
  await helper.login();
  await helper.navigateToEdit(PAGE);
  await helper.waitForBlockByContent('Template Header - From Template');
  return helper;
}

test.describe('Agent API parity with the editor', () => {
  test('adding a block after a slot block', async ({ page, browser, urls }) => {
    const person = await editing(page);
    await person.addBlockOnCanvas('user-content-2', 'slate');
    await person.saveContent();

    const agentPage = await browser.newPage();
    await editing(agentPage);
    const { version } = await agent(agentPage, (a) => a.getPage());
    await agent(agentPage, (a) => a.insert({ refId: 'user-content-2', action: 'after', block: { '@type': 'slate' } }));
    await agent(agentPage, (a, v) => a.save({ expectedVersion: v }), version);

    expect(shape(await stored(urls.mockApi, agentPage, STORED))).toEqual(shape(await stored(urls.mockApi, page, STORED)));
  });

  test("removing a slot's block", async ({ page, browser, urls }) => {
    const person = await editing(page);
    await person.clickBlockInIframe('user-content-2');
    await person.waitForBlockSelectedInAdmin('user-content-2');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('hydra-delete-blocks', { detail: { blockIds: ['user-content-2'] } })));
    await person.saveContent();

    const agentPage = await browser.newPage();
    await editing(agentPage);
    const { version } = await agent(agentPage, (a) => a.getPage());
    await agent(agentPage, (a) => a.remove('user-content-2'));
    await agent(agentPage, (a, v) => a.save({ expectedVersion: v }), version);

    expect(shape(await stored(urls.mockApi, agentPage, STORED))).toEqual(shape(await stored(urls.mockApi, page, STORED)));
  });

  test("changing the page's summary: the sidebar's page fields, and an update on the page block", async ({ page, browser, urls }) => {
    const summary = 'Where our templates are tried out';
    const person = await editing(page);
    const field = page.locator('#sidebar-metadata .field-wrapper-description textarea');
    await expect(field).toBeVisible();
    await field.fill(summary);
    await person.saveContent();

    const agentPage = await browser.newPage();
    await editing(agentPage);
    const { version } = await agent(agentPage, (a) => a.getPage());
    await agent(agentPage, (a, s) => a.update({ id: '_page', fields: { description: s } }), summary);
    await agent(agentPage, (a, v) => a.save({ expectedVersion: v }), version);

    const [byPerson, byAgent] = [await stored(urls.mockApi, page, STORED), await stored(urls.mockApi, agentPage, STORED)];
    expect(byPerson.description).toBe(summary);
    expect(byAgent.description).toBe(byPerson.description);
    expect(shape(byAgent)).toEqual(shape(byPerson));
  });

  test('a locked template block: the editor offers no Remove, and the agent is refused', async ({ page }) => {
    const person = await editing(page);
    await person.clickBlockInIframe('template-header');
    await person.waitForBlockSelectedInAdmin('template-header');
    await person.openQuantaToolbarMenu('template-header');
    const offered = await person.getQuantaToolbarMenuOptions('template-header');
    expect(offered.length, 'the menu opened').toBeGreaterThan(0);
    expect(offered.map((o) => o.toLowerCase())).not.toContain('remove');

    expect(await refusal(page, (a) => a.remove('template-header'))).toMatch(/cannot be removed/);
    expect(await refusal(page, (a) => a.update({ id: 'template-header', fields: {} }))).toMatch(/is locked/);
  });

  test('"Change on all pages", then save the page: the page keeps its own content in the slot', async ({ page, browser, urls }) => {
    // An agent changed a template's heading with changeTemplates and saved the
    // page; the page's own blocks in the template's slot were gone, and every
    // save after reset the slot to empty again.
    const slotText = ['User content - different from template default', 'Second user content block in placeholder'];
    const slotOf = (doc: any) => shape(doc).filter((b: any) => b.slot === 'primary').map((b: any) => b.text);
    // The template keeps a place for each page's own content: without its
    // primary slot, no page using it can show what it put there.
    const templateSlots = async (p: Page) => shape(await stored(urls.mockApi, p, TEMPLATE)).map((b: any) => b.slot);

    const person = await editing(page);
    await person.unlockTemplate('template-header');
    await person.clickBlockInIframe('template-header');
    await person.waitForBlockSelectedInAdmin('template-header');
    const header = await person.getEditorLocator('template-header');
    await person.selectAllTextInEditor(header);
    await header.pressSequentially('Header for every page');
    await person.lockTemplate('template-header', 'commit');
    await person.saveContent();
    expect(slotOf(await stored(urls.mockApi, page, STORED)), 'the page by a person').toEqual(slotText);
    expect(await templateSlots(page), 'the template by a person').toContain('primary');

    const agentPage = await browser.newPage();
    await editing(agentPage);
    const { version } = await agent(agentPage, (a) => a.getPage());
    await agent(agentPage, (a) => a.unlockTemplateOf('template-header'));
    await agent(agentPage, (a) => a.update({ id: 'template-header', fields: { value: [{ type: 'h1', children: [{ text: 'Header for every page' }] }] } }));
    await agent(agentPage, (a) => a.lockTemplates());
    await agent(agentPage, (a, v) => a.save({ expectedVersion: v }), version);
    expect(slotOf(await stored(urls.mockApi, agentPage, STORED)), 'the page by the agent').toEqual(slotText);
    expect(await templateSlots(agentPage), 'the template by the agent').toEqual(await templateSlots(page));
  });

  test('"Change on all pages": unlock, remove the footer, lock', async ({ page, browser, urls }) => {
    const person = await editing(page);
    const { blockId: footer } = await person.waitForBlockByContent('Template Footer - From Template');
    await person.unlockTemplate('template-header');
    await person.clickBlockInIframe(footer);
    await person.waitForBlockSelectedInAdmin(footer);
    await page.evaluate((id) => document.dispatchEvent(new CustomEvent('hydra-delete-blocks', { detail: { blockIds: [id] } })), footer);
    await person.lockTemplate('template-header', 'commit');
    await expect.poll(async () => shape(await stored(urls.mockApi, page, TEMPLATE)).some((b: any) => b.slot === 'footer')).toBe(false);

    const agentPage = await browser.newPage();
    await editing(agentPage);
    await agent(agentPage, (a) => a.unlockTemplateOf('template-header'));
    const agentFooter = await agent(agentPage, (a) => Object.entries(a.getPage().formData.blocks as Record<string, any>)
      .find(([, b]) => b.slotId === 'footer')![0]);
    await agent(agentPage, (a, id) => a.remove(id), agentFooter);
    expect(await agent(agentPage, (a) => a.lockTemplates())).toEqual([TEMPLATE]);

    expect(shape(await stored(urls.mockApi, agentPage, TEMPLATE))).toEqual(shape(await stored(urls.mockApi, page, TEMPLATE)));
  });
});
