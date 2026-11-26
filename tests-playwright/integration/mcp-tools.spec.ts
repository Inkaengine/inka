/**
 * The MCP tools against a real (headless-style) admin: get_page reads the page
 * in the agent format; edit_blocks applies operations through the agent API,
 * as a dry run (nothing saved) or for real (saved against the version read).
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { freshPage, tokenFor, whileEditing } from '../helpers/otherUser';
import { agentOn, waitForAgent, discardEdits, createPage, siteOn, openAdmin } from '../../packages/inka-mcp/adminDriver.mjs';
import {
  getPage, editPage, listBlockTypes, describeBlock, search, listChildren, fillNewPage, movePage, copyPage, renamePage, deletePage, getTransitions, transitionPage, getHistory, revertPage, savedVersion,
  findUndeclaredFields,
} from '../../packages/inka-mcp/tools.mjs';
import { frontendUrlOf, previewDraft } from '../../packages/inka-mcp/preview.mjs';
import { draftCheck } from '../../packages/inka-mcp/checkDraft.mjs';

const mintId = () => crypto.randomUUID();

test.describe('MCP tools', () => {
  test('get_page, a dry run, then a real edit', async ({ page, urls }) => {
    // Loads the editor twice (the discard is a full reload) and saves.
    test.setTimeout(90000);
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await waitForAgent(page);
    const agent = agentOn(page);

    // get_page: the agent format — uids, markdown rich text.
    const read = await getPage(agent);
    expect(read.version).toBeTruthy();
    const first = read.blocks.find((b) => b['@uid'] === 'block-1-uuid');
    expect(first['@type']).toBe('slate');
    expect(typeof first.value.md).toBe('string');

    // A dry run shows the result without saving.
    const ops = [{ op: 'add', after: 'block-1-uuid', blocks: [{ '@uid': 'from-mcp', '@type': 'slate', value: 'Added *by the MCP*' }] }];
    const dry = await editPage(agent, { check: draftCheck(agent, siteOn(page)), ops, expectedVersion: read.version, dryRun: true, mintId });
    const added = dry.page.blocks.find((b) => b['@uid'] === dry.ids['from-mcp']);
    expect(added?.value.md).toBe('Added *by the MCP*');
    await expect(helper.getIframe().locator(`[data-block-uid="${dry.ids['from-mcp']}"]`)).toContainText('Added by the MCP');

    // Discard: a full reload, and the page is as it was.
    await discardEdits(page);
    const reread = await getPage(agent);
    expect(reread.blocks.map((b) => b['@uid'])).toEqual(read.blocks.map((b) => b['@uid']));

    // For real: saved against the version read.
    const done = await editPage(agent, { check: draftCheck(agent, siteOn(page)), ops, expectedVersion: reread.version, mintId });
    expect(done.version).not.toBe(reread.version);
    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')?.value;
    const stored = await (await page.request.get(`${urls.mockApi}/_test_data/test-page`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    expect(stored.blocks_layout.items[1]).toBe(done.ids['from-mcp']);
  });

  test('edit_blocks refuses a version the page has moved past', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await waitForAgent(page);
    const agent = agentOn(page);
    await expect(editPage(agent, { check: draftCheck(agent, siteOn(page)), ops: [], expectedVersion: 'an-old-version', mintId }))
      .rejects.toThrow(/changed since it was read/);
  });

  test('list_block_types: what the page takes, fields and regions', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await waitForAgent(page);
    const described = await listBlockTypes(agentOn(page), { media: false });

    const pageList = described.page.find((r) => r.field === 'blocks');
    expect(pageList.allowed).toContain('slate');
    expect(described.types.slate.fields.value).toMatchObject({ widget: 'slate', markdown: true });

    // A container's region, with the editor's limit.
    expect(described.types.columns.regions).toEqual([{ field: 'columns', allowed: ['column'], maxLength: 4 }]);
    // A list whose items have no types of their own holds the item type the admin registers.
    expect(described.types.accordion.regions).toEqual([{ field: 'panels', allowed: ['accordion:panels'], list: true }]);
    expect(Object.keys(described.types['accordion:panels'].fields)).toContain('title');
  });

  test('a dry run previewed as a visitor sees it, saving nothing', async ({ page, urls }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await waitForAgent(page);
    const agent = agentOn(page);
    const read = await getPage(agent);
    const frontendUrl = await frontendUrlOf(page);
    expect(new URL(frontendUrl).searchParams.get('_edit')).toBe('false');

    const ops = [{ op: 'add', after: 'block-1-uuid', blocks: [{ '@type': 'slate', value: 'Previewed *draft* text' }] }];
    const dry = await editPage(agent, { check: draftCheck(agent, siteOn(page)),
      ops, expectedVersion: read.version, dryRun: true, mintId,
      render: async (draft) => previewDraft(page.context(), { frontendUrl, draft, blockPathMap: await agent.blockPathMapOf(draft), maxChars: 100_000 }),
    });
    expect(dry.rendered.text).toContain('Previewed draft text');
    expect(dry.rendered.mimeType).toMatch(/^image\/(png|jpeg)$/);
    expect(dry.rendered.image.length).toBeLessThanOrEqual(100_000);

    // The view-mode frame is a visitor's: no editor, and the saved page is untouched.
    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')?.value;
    const stored = await (await fetch(`${urls.mockApi}/_test_data/test-page`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    expect(stored.blocks_layout.items).toEqual(read.blocks.map((b) => b['@uid']));
  });

  test('a preview is only for a dry run', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await waitForAgent(page);
    const agent = agentOn(page);
    const read = await getPage(agent);
    await expect(editPage(agent, { check: draftCheck(agent, siteOn(page)), ops: [], expectedVersion: read.version, mintId, render: async () => ({}) }))
      .rejects.toThrow(/for a dry run/);
  });

  test('search and list_children, through the admin\'s own @search', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}/contents`);
    await page.waitForFunction(() => !!(window as any).__inkaSite);
    const agent = siteOn(page);

    // By text: site-relative paths, with title and type.
    const found = await search(agent, { text: 'Accordion' });
    expect(found.total).toBeGreaterThan(0);
    expect(found.items).toContainEqual(expect.objectContaining({
      path: '/_test_data/accordion-test-page', title: 'Accordion Test Page', type: 'Document',
    }));

    // Narrowed by type: nothing of another type comes back.
    const events = await search(agent, { text: 'Test', types: ['Event'] });
    expect(events.items.length).toBeGreaterThan(0);
    expect(events.items.every((i) => i.type === 'Event')).toBe(true);

    // A section's children, one level down, paged.
    const children = await listChildren(agent, { path: '/_test_data', limit: 5 });
    expect(children.total).toBeGreaterThan(5);
    expect(children.items).toHaveLength(5);
    expect(children.items.every((i) => i.path.split('/').length === 3 && i.path.startsWith('/_test_data/'))).toBe(true);
    const next = await listChildren(agent, { path: '/_test_data', limit: 5, start: 5 });
    expect(next.items.map((i) => i.path)).not.toContain(children.items[0].path);

    await expect(search(agent, {})).rejects.toThrow(/needs "text", "types", "reviewState" or "hasDraft"/);
  });

  test('create_page: through the add form, then its first blocks, saved', async ({ page, urls }) => {
    test.setTimeout(90000);
    const helper = new AdminUIHelper(page);
    await helper.login();
    await openAdmin(page, { adminUrl: helper.adminUrl });

    const { path } = await createPage(page, { parent: '/_test_data', type: 'Document', title: 'Made by the MCP' });
    expect(path).toMatch(/^\/_test_data\/made-by-the-mcp/);

    const blocks = [{ '@uid': 'intro', '@type': 'slate', value: 'Written *by an agent*' }];
    const made = await fillNewPage(agentOn(page), { blocks, mintId, check: draftCheck(agentOn(page), siteOn(page)) });
    expect(made.path).toBe(path);
    // Whether visitors can see it: it says, as a save does.
    expect(made.reviewState).toBeTruthy();

    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')?.value;
    const stored = await (await fetch(`${urls.mockApi}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    expect(stored.title).toBe('Made by the MCP');
    // A new page starts empty (Inka adds no blocks of its own, #661); the
    // empty block the editor seeds to type in is gone: ours are what goes
    // there, and a post that starts with a blank line looks broken.
    expect(stored.blocks_layout.items).toEqual([made.ids.intro]);
    expect(stored.blocks[made.ids.intro]['@type']).toBe('slate');
  });

  test('create_page: a form the admin refuses says why', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await openAdmin(page, { adminUrl: helper.adminUrl });
    await expect(createPage(page, { parent: '/_test_data', type: 'Document', title: '' }))
      .rejects.toThrow(/add form refused it/);
  });

  test('transitions: what is on offer and what each can set, then taking them', async ({ page, urls }) => {
    test.setTimeout(90000);
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}/contents`);
    await page.waitForFunction(() => !!(window as any).__inkaSite);
    const site = siteOn(page);
    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')?.value;
    const stored = async (path: string) => (await fetch(`${urls.mockApi}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    const offered = (found: { transitions: { id: string }[] }) => found.transitions.map((t) => t.id);
    const path = '/_test_data/another-page';

    // Published to begin with: retracting is on offer and publishing is not.
    const published = await getTransitions(site, { path });
    expect(published.state.name).toBe('published');
    expect(offered(published)).toEqual(expect.arrayContaining(['retract', 'checkout', 'update']));
    expect(offered(published)).not.toContain('publish');
    expect(Object.keys(published.transitions.find((t) => t.id === 'update').takes)).toEqual(expect.arrayContaining(['Reader', 'id', 'inherit']));

    // Not on offer, and a setting it does not take: refused, nothing changes.
    await expect(transitionPage(site, { path, id: 'publish', expectedVersion: published.version })).rejects.toThrow(/no transition 'publish'/);
    await expect(transitionPage(site, { path, id: 'retract', data: { nonsense: 1 }, expectedVersion: published.version })).rejects.toThrow(/does not take nonsense/);
    expect((await stored(path)).review_state).toBe('published');

    // Retract, and then publish with a publishing date and an expiry.
    const retracted = await transitionPage(site, { path, id: 'retract', expectedVersion: published.version });
    expect(retracted).toMatchObject({ path, reviewState: 'private' });
    expect((await stored(path)).review_state).toBe('private');
    const privatePage = await getTransitions(site, { path });
    expect(offered(privatePage)).toContain('publish');
    expect(Object.keys(privatePage.transitions.find((t) => t.id === 'publish').takes)).toEqual(expect.arrayContaining(['effective', 'expires', 'comment', 'id']));
    const dates = { effective: '2027-01-01T09:00:00', expires: '2027-06-01T09:00:00' };
    const republished = await transitionPage(site, { path, id: 'publish', data: dates, expectedVersion: privatePage.version });
    expect(republished).toMatchObject({ path, reviewState: 'published' });
    expect(await stored(path)).toMatchObject({ review_state: 'published', ...dates });

    // Share it: a new reader, stated role by role.
    const before = await getTransitions(site, { path });
    const shared = await transitionPage(site, { path, id: 'update', data: { Reader: ['editors-of-news'] }, expectedVersion: before.version });
    expect(shared.path).toBe(path);
    const after = await getTransitions(site, { path });
    expect(after.transitions.find((t) => t.id === 'update').current.Reader).toEqual(['editors-of-news']);
    expect(after.state.name).toBe('published');

    // A draft copy: a transition that moves to the copy, and back when it is discarded.
    const copy = await transitionPage(site, { path, id: 'checkout', expectedVersion: after.version });
    expect(copy.path).toBe(path);
    expect(copy.reviewState).toBe('published');
    const draftAt = '/_test_data/copy_of_another-page';
    expect(copy.draft.url.endsWith(draftAt)).toBe(true);
    const withDraft = await getTransitions(site, { path });
    expect(withDraft.draft.url.endsWith(draftAt)).toBe(true);
    // Plone has locked the page: its own fields can't be offered, and a save is refused.
    expect(Object.keys(withDraft.transitions.find((t) => t.id === 'update').takes)).not.toContain('exclude_from_nav');
    await expect(site.rename({ path, title: 'On the locked page' })).rejects.toThrow(/locked/i);
    expect(offered(withDraft)).toEqual(expect.arrayContaining(['checkin', 'cancel-checkout']));
    expect(offered(withDraft)).not.toContain('checkout');
    await expect(movePage(site, { path, target: '/_test_data/accordion-test-page', expectedVersion: withDraft.version })).rejects.toThrow(/has a draft/);
    const live = (await stored(path)).title;
    await site.rename({ path: draftAt, title: 'Retitled on the copy' });
    expect((await stored(path)).title).toBe(live);
    const discarded = await transitionPage(site, { path, id: 'cancel-checkout', expectedVersion: (await getTransitions(site, { path })).version });
    expect(discarded.path).toBe(path);
    expect(discarded).not.toHaveProperty('draft');
    const gone = async (p: string) => (await fetch(`${urls.mockApi}${p}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).status;
    expect(await gone(draftAt)).toBe(404);
    expect((await stored(path)).title).toBe(live);

    // Again, and this time apply it: the original takes what the copy holds, and stays published.
    const original = await getTransitions(site, { path });
    expect(offered(original)).toContain('checkout');
    const second = await transitionPage(site, { path, id: 'checkout', expectedVersion: original.version });
    expect(second.draft.url.endsWith(draftAt)).toBe(true);
    expect((await stored(draftAt)).review_state).toBe('private');
    await site.rename({ path: draftAt, title: 'Retitled on the copy' });
    const applied = await transitionPage(site, { path, id: 'checkin', expectedVersion: (await getTransitions(site, { path })).version });
    expect(applied).toMatchObject({ path, reviewState: 'published' });
    expect((await stored(path)).title).toBe('Retitled on the copy');
    expect(applied).not.toHaveProperty('draft');
    expect(await gone(draftAt)).toBe(404);
  });

  test('move_page places a page among its section\'s pages, as the contents view orders them', async ({ page }) => {
    test.setTimeout(90000);
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}/contents`);
    await page.waitForFunction(() => !!(window as any).__inkaSite);
    const site = siteOn(page);
    const order = async () => (await listChildren(site, { path: '/_test_data', limit: 100 })).items.map((item: any) => item.path);

    const before = await order();
    expect(before.length, 'the section has pages to order').toBeGreaterThan(2);
    const last = before[before.length - 1];
    await movePage(site, { path: last, position: 'first', expectedVersion: (await site.status(last)).version });
    expect(await order()).toEqual([last, ...before.slice(0, -1)]);

    // …and next to a named page.
    await movePage(site, { path: last, position: { after: before[1] }, expectedVersion: (await site.status(last)).version });
    expect(await order()).toEqual([before[0], before[1], last, ...before.slice(2, -1)]);
  });

  test('delete_page names the pages it would leave with broken links, and deletes only when told to', async ({ page, urls }) => {
    test.setTimeout(90000);
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}/contents`);
    await page.waitForFunction(() => !!(window as any).__inkaSite);
    const site = siteOn(page);
    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')?.value;
    const status = async (path: string) => (await fetch(`${urls.mockApi}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).status;
    const target = '/_test_data/target-page';

    await expect(deletePage(site, { path: target, expectedVersion: (await site.status(target)).version }))
      .rejects.toThrow(/would break links on 3 pages: .*\(\/_test_data\/test-page\)/);
    expect(await status(target)).toBe(200);

    const deleted = await deletePage(site, { path: target, expectedVersion: (await site.status(target)).version, breakLinks: true });
    expect(deleted.brokenLinksOn.map((p: any) => p.path).sort()).toEqual([
      '/_test_data/field-rules-page', '/_test_data/optional-fields-page', '/_test_data/test-page',
    ]);
    expect(await status(target)).toBe(404);
  });

  test('get_history lists a page\'s saves, and revert_page puts it back to one', async ({ page }) => {
    test.setTimeout(90000);
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}/contents`);
    await page.waitForFunction(() => !!(window as any).__inkaSite);
    const site = siteOn(page);
    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')!.value;
    const path = await freshPage(token);
    const titleOf = async () => (await site.get(path)).title;
    const versionOf = async () => (await site.status(path)).version;

    await renamePage(site, { path, title: 'Second title', expectedVersion: await versionOf() });
    await renamePage(site, { path, title: 'Third title', expectedVersion: await versionOf() });
    const saves = (await getHistory(site, { path })).history.filter((entry: any) => 'version' in entry);
    expect(saves.map((entry: any) => entry.version)).toEqual([2, 1, 0]);
    expect(saves[0].current).toBe(true);
    // What each save held, as Compare shows it.
    expect((await savedVersion(site, { path, version: 0 })).title).toBe('A page of its own');
    expect((await savedVersion(site, { path, version: 1 })).title).toBe('Second title');
    await expect(savedVersion(site, { path, version: 9 })).rejects.toThrow(/has no version 9/);

    const reverted = await revertPage(site, { path, version: 0, expectedVersion: await versionOf() });
    expect(reverted).toMatchObject({ path, restored: 0 });
    expect(await titleOf()).toBe('A page of its own');

    // What it held until now is a version too, so the revert can be undone.
    const after = (await getHistory(site, { path })).history.filter((entry: any) => 'version' in entry);
    expect(after.map((entry: any) => entry.version)).toEqual([3, 2, 1, 0]);
    await revertPage(site, { path, version: 2, expectedVersion: reverted.version });
    expect(await titleOf()).toBe('Third title');
  });

  test('copy_page copies a page beside itself, or into another section named and placed', async ({ page }) => {
    test.setTimeout(90000);
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}/contents`);
    await page.waitForFunction(() => !!(window as any).__inkaSite);
    const site = siteOn(page);
    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')!.value;
    const original = await freshPage(token);
    const id = original.split('/').pop();

    const beside = await copyPage(site, { path: original });
    expect(beside.path).toBe(`/_test_data/copy_of_${id}`);
    expect((await site.get(beside.path)).title).toBe('A page of its own');
    expect((await site.get(original)).title).toBe('A page of its own');

    const section = '/_test_data/accordion-test-page';
    const named = await copyPage(site, { path: original, target: section, id: 'its-copy', title: 'Its copy', position: 'first' });
    expect(named.path).toBe(`${section}/its-copy`);
    expect((await site.get(named.path)).title).toBe('Its copy');
    expect((await listChildren(site, { path: section })).items[0].path).toBe(named.path);
  });

  test('move_page, rename_page and delete_page, version-checked', async ({ page, urls }) => {
    test.setTimeout(90000);
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}/contents`);
    await page.waitForFunction(() => !!(window as any).__inkaSite);
    const site = siteOn(page);
    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')?.value;
    const status = async (path: string) => (await fetch(`${urls.mockApi}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).status;
    const versionOf = async (path: string) => (await site.status(path)).version;

    // Move another-page into the accordion test page's section.
    const from = '/_test_data/another-page';
    const moved = await movePage(site, { path: from, target: '/_test_data/accordion-test-page', expectedVersion: await versionOf(from) });
    expect(moved.path).toBe('/_test_data/accordion-test-page/another-page');
    expect(await status(from)).toBe(404);
    expect(await status(moved.path)).toBe(200);

    // Rename it: a new short name and title.
    const renamed = await renamePage(site, { path: moved.path, id: 'moved-page', title: 'Moved page', expectedVersion: await versionOf(moved.path) });
    expect(renamed.path).toBe('/_test_data/accordion-test-page/moved-page');
    const stored = await (await fetch(`${urls.mockApi}${renamed.path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    expect(stored.title).toBe('Moved page');

    // A version the page has moved past is refused, and nothing is deleted.
    await expect(deletePage(site, { path: renamed.path, expectedVersion: 'an-old-version' })).rejects.toThrow(/changed since it was read/);
    expect(await status(renamed.path)).toBe(200);

    // Delete it.
    await deletePage(site, { path: renamed.path, expectedVersion: await versionOf(renamed.path) });
    expect(await status(renamed.path)).toBe(404);
  });

  test('find_undeclared_fields: a field stored where no schema declares it, and where it belongs', async ({ page, urls }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    // Stored before the save check refused such fields: straight through the CMS.
    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')?.value;
    const at = '/_test_data/teaser-image-test-page';
    const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
    const stored = await (await page.request.get(`${urls.mockApi}${at}`, { headers })).json();
    const patched = await page.request.patch(`${urls.mockApi}${at}`, {
      headers, data: { blocks: { ...stored.blocks, 'teaser-withimg': { ...stored.blocks['teaser-withimg'], align: 'center' } } },
    });
    expect(patched.ok()).toBe(true);

    await helper.navigateToEdit(at);
    await waitForAgent(page);
    const found = await findUndeclaredFields(agentOn(page), siteOn(page), { path: at });
    expect(found.fields).toEqual([{ block: 'teaser', field: 'align', belongsIn: ['styles.align'], pages: [at] }]);
    expect(found.checked).toBe(1);
  });

  test('describe_block: the type in full, with a real example from the site', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await waitForAgent(page);
    const [agent, site] = [agentOn(page), siteOn(page)];

    const teaser = await describeBlock(agent, site, { type: 'teaser', media: false });
    expect(teaser.fields.href).toMatchObject({ widget: 'object_browser', required: true });
    expect(teaser.allowedIn).toContain("the page's blocks");
    // The example is a real teaser from a page on the site: the link's shape is there to copy.
    expect(teaser.siteExample.block['@type']).toBe('teaser');
    expect(teaser.siteExample.from).toMatch(/^\//);
    expect(teaser.siteExample.block.href[0]['@id']).toBeTruthy();

    // A block's display variants, as its variation field offers them.
    const callout = await describeBlock(agent, site, { type: 'callout', media: false });
    expect(callout.variations).toContainEqual({ id: 'note', title: 'Note', isDefault: true });
    expect(callout.variations.map((v) => v.id)).toEqual(['note', 'tip', 'warning', 'important']);
  });

  test("describe_block: the front end's guidance and examples, each rendered on its own", async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await waitForAgent(page);
    const [agent, site] = [agentOn(page), siteOn(page)];
    const frontendUrl = await frontendUrlOf(page);

    const callout = await describeBlock(agent, site, {
      type: 'callout',
      media: false,
      render: async (draft, uid) => previewDraft(page.context(), { frontendUrl, draft, blockPathMap: await agent.blockPathMapOf(draft), focus: uid, maxChars: 50_000 }),
    });
    expect(callout.guidance).toMatch(/aside/);
    // Declared by the front end as stored blocks, given in the agent format.
    const tip = callout.examples.find((e) => e.block.variation === 'tip');
    expect(tip.block.blocks[0].value.md).toBeTruthy();
    // Each rendered alone: the picture and text are the block's, not the page's.
    for (const example of callout.examples) {
      expect(example.rendered.mimeType).toMatch(/^image\/(png|jpeg)$/);
      expect(example.rendered.text).toContain(example.block.blocks[0].value.md.replace(/[*_`]/g, ''));
      expect(example.rendered.text).not.toContain('Test Page');
    }
  });

  test("a save the CMS refuses says why: here, another user's lock", async ({ page, urls }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    // A page of its own: the lock is seen by every session, and other tests save the fixtures.
    const own = await freshPage(helper.authToken);
    await page.goto(`${helper.adminUrl}${own}/edit`);
    await waitForAgent(page);
    const agent = agentOn(page);
    const { version } = await agent.getPage();
    await agent.insert({ refId: 'para', block: { '@type': 'slate' } });
    // jane takes the page over (Volto's "unlock" of the editor's lock, then her own).
    await fetch(`${urls.mockApi}${own}/@lock`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor('jane')}` },
      body: JSON.stringify({ force: true }),
    });
    await whileEditing('jane', own, async () => {
      await expect(agent.save({ expectedVersion: version })).rejects.toThrow(/Resource is locked/);
    });
  });
});
