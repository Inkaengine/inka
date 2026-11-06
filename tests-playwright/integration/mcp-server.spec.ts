/**
 * The MCP server end to end: an MCP client starts it over stdio, as an agent's
 * host would, and it drives its own headless admin against the mock API.
 */
import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { test, expect } from '../fixtures';
import { mintToken } from '../fixtures/mock-tokens.cjs';
import { connect, CALL } from '../helpers/mcpClient';

const PAGE = '/_test_data/test-page';

/**
 * A result the conversation keeps: claude.ai writes one of more than about
 * 150,000 characters to a file, and then no one sees its picture.
 */
const KEPT_IN_CONVERSATION = 150_000;
const PICTURE = { type: 'image', mimeType: expect.stringMatching(/^image\/(png|jpeg)$/) };

/** A PNG's or JPEG's width, from its header. */
function widthOf({ data, mimeType }: { data: string; mimeType: string }): number {
  const bytes = Buffer.from(data, 'base64');
  if (mimeType === 'image/png') return bytes.readUInt32BE(16);
  // JPEG: walk the segments to the frame header (SOF0-SOF2).
  for (let at = 2; at < bytes.length;) {
    const marker = bytes[at + 1];
    if (marker >= 0xc0 && marker <= 0xc2) return bytes.readUInt16BE(at + 7);
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  throw new Error('no frame header in the JPEG');
}

test.describe('MCP server', () => {
  let client: Client;
  // The mock keys its state by token, so this test has the page to itself.
  const token = mintToken('admin');

  test.beforeEach(async () => {
    client = await connect({ INKA_TOKEN: token });
  });

  test.afterEach(async () => {
    await client.close();
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }, undefined, CALL);
    const text = (result.content as { text: string }[])[0].text;
    return { isError: !!result.isError, text, json: () => {
      if (result.isError) throw new Error(`${name} failed: ${text}`);
      return JSON.parse(text);
    } };
  };

  test('a page with a draft: reading and editing it reach the draft, visitors keep the page', async () => {
    test.setTimeout(180000);
    const path = '/_test_data/another-page-2';
    const before = (await call('get_page', { path })).json();
    expect(before).not.toHaveProperty('draft');
    const made = (await call('transition_page', { path, id: 'checkout', expectedVersion: before.version })).json();
    expect(made.path).toBe(path);

    // Same page, same path: the edit lands on the draft.
    const reading = (await call('get_page', { path })).json();
    expect(reading).toMatchObject({ path, draft: { path: '/_test_data/copy_of_another-page-2' } });
    expect(reading.draft.url).toMatch(/^http.*\/_test_data\/copy_of_another-page-2$/);

    // Found by what it is, not by going through the site: it names its page.
    const waiting = (await call('search', { reviewState: ['private'], path: '/_test_data' })).json();
    expect(waiting.items.find((i: { path: string }) => i.path === reading.draft.path).draftOf).toBe(path);
    const edited = (await call('edit_blocks', {
      path,
      expectedVersion: reading.version,
      ops: [{ op: 'update', id: '_page', set: { title: 'Title on the draft' } }],
    })).json();
    expect(edited.draft).toEqual(reading.draft);
    expect((await call('get_page', { path })).json().title).toBe('Title on the draft');

    // Visitors still see the page as it was, unless the draft is asked for.
    expect((await call('view_page', { path })).json().renderedText).not.toContain('Title on the draft');
    const shown = (await call('view_page', { path, draft: true })).json();
    expect(shown).toMatchObject({ path, draft: reading.draft });
    expect(shown.renderedText).toContain('Title on the draft');

    // An emergency: an edit can choose the live page, and is told the draft hasn't got it.
    const live = (await call('get_page', { path, live: true })).json();
    expect(live).toMatchObject({ path, live: true });
    expect(live.title).not.toBe('Title on the draft');
    const fixed = (await call('edit_blocks', {
      path,
      live: true,
      expectedVersion: live.version,
      ops: [{ op: 'update', id: '_page', set: { description: 'Fixed on the live page' } }],
    })).json();
    expect(fixed.live).toBe(true);
    expect(fixed.warning).toMatch(/draft does not have this change/);
    expect((await call('get_page', { path, live: true })).json().description).toBe('Fixed on the live page');
    expect((await call('get_page', { path })).json().description).not.toBe('Fixed on the live page');

    // Published: the page takes it, at the same path, and has no draft now.
    const offered = (await call('get_transitions', { path })).json();
    const done = (await call('transition_page', { path, id: 'checkin', expectedVersion: offered.version })).json();
    expect(done.path).toBe(path);
    expect(done).not.toHaveProperty('draft');
    const after = (await call('get_page', { path })).json();
    expect(after.title).toBe('Title on the draft');
    // What the warning said: publishing the draft replaces the live page, the fix included.
    expect(after.description).not.toBe('Fixed on the live page');
    expect(after).not.toHaveProperty('draft');
    expect((await call('view_page', { path, draft: true })).text).toMatch(/has no draft/);
    // With no draft, there is only the live page to edit, and nothing to warn of.
    const plain = (await call('get_page', { path, live: true })).json();
    const edited2 = (await call('edit_blocks', {
      path, live: true, expectedVersion: plain.version, ops: [{ op: 'update', id: '_page', set: { description: 'Plain' } }],
    })).json();
    expect(edited2).not.toHaveProperty('warning');
  });

  test('lists its tools', async () => {
    const { tools } = await client.listTools();
    // `picture` and `stage_dropped` are for the views alone: a client lists them to a view, not the model.
    expect(tools.map((t) => t.name).sort()).toEqual(['ask_for_files', 'create_page', 'delete_page', 'describe_block', 'edit_blocks', 'get_page', 'get_transitions', 'list_block_types', 'list_children', 'move_page', 'picture', 'preview_layout', 'rename_page', 'search', 'stage_dropped', 'stage_media', 'transition_page', 'view_page']);
    // Those that change nothing say so, so a client need not ask the person every time.
    expect(tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name).sort())
      .toEqual(['ask_for_files', 'describe_block', 'get_page', 'get_transitions', 'list_block_types', 'list_children', 'picture', 'preview_layout', 'search', 'stage_dropped', 'stage_media', 'view_page']);
    expect(tools.find((t) => t.name === 'delete_page')!.annotations).toMatchObject({ destructiveHint: true });
  });

  test('tells a client about the site: what a person never says, and nothing about how to behave', async () => {
    const instructions = client.getInstructions();
    // Facts about the site and its tools, filling in what a person never says.
    expect(instructions).toMatch(/view_page/);
    expect(instructions).toMatch(/preview_layout/);
    expect(instructions).toMatch(/saves anything|saves nothing/);
    expect(instructions).toMatch(/a change to the template, and so to every page that uses it/);
    expect(instructions).toMatch(/visitors of a published page see the change straight away/);
    // A new page may be private: an agent told there was no publishing step
    // said a post was live when no visitor could see it.
    expect(instructions).not.toMatch(/no separate publishing step/);
    expect(instructions).toMatch(/reviewState/);
    expect(instructions).toMatch(/get_transitions/);
    expect(instructions).toMatch(/"live"/);
    expect(instructions).toMatch(/Publish only when the person has asked/);
    expect(instructions).toMatch(/search finds pages by their title, their summary and the text of their Text blocks/);
    // Never how to behave: that is the agent's and its host's, not the site's.
    expect(instructions).not.toMatch(/\b(Never|Do not|only when asked|tell the person|Talk the way)\b/);
  });

  test('preview_layout: a whole proposed layout rendered, and the page left as it was', async () => {
    test.setTimeout(120000);
    const before = (await call('get_page', { path: PAGE })).json();
    const result = await client.callTool({
      name: 'preview_layout',
      arguments: { path: PAGE, blocks: [{ '@type': 'slate', value: 'An *alternative* opening' }] },
    }, undefined, CALL);
    const [text, image] = result.content as any[];
    expect(result.isError, text.text).toBeFalsy();
    expect(JSON.parse(text.text).renderedText).toContain('An alternative opening');
    expect(image).toMatchObject(PICTURE);
    expect(JSON.stringify(result).length).toBeLessThan(KEPT_IN_CONVERSATION);
    const after = (await call('get_page', { path: PAGE })).json();
    expect(after.version).toBe(before.version);
    expect(after.blocks.map((b: any) => b['@uid'])).toEqual(before.blocks.map((b: any) => b['@uid']));
  });

  test('view_page: a picture of the page as visitors see it, and its text', async () => {
    // An agent asked "what does it look like?" answered from the block data
    // with a guessed wireframe: nothing showed it the page.
    test.setTimeout(120000);
    const result = await client.callTool({ name: 'view_page', arguments: { path: PAGE, viewport: 'mobile' } }, undefined, CALL);
    const [text, image] = result.content as any[];
    expect(result.isError, text.text).toBeFalsy();
    const viewed = JSON.parse(text.text);
    expect(viewed).toMatchObject({ path: PAGE, viewport: 'mobile' });
    expect(viewed.renderedText).toContain('This is a test paragraph');
    expect(image).toMatchObject(PICTURE);
    expect(JSON.stringify(result).length).toBeLessThan(KEPT_IN_CONVERSATION);
    // Mobile width: the picture is the phone's (or smaller, to fit), not the desktop's.
    expect(widthOf(image)).toBeLessThanOrEqual(390);
  });

  test('describe_block with preview: a picture of each example, after the text', async () => {
    test.setTimeout(120000);
    const result = await client.callTool({
      name: 'describe_block', arguments: { path: PAGE, type: 'callout', preview: 'desktop' },
    }, undefined, CALL);
    const [text, ...images] = result.content as any[];
    expect(result.isError, text.text).toBeFalsy();
    const described = JSON.parse(text.text);
    expect(images).toEqual(described.examples.map(() => expect.objectContaining(PICTURE)));
    expect(JSON.stringify(result).length).toBeLessThan(KEPT_IN_CONVERSATION);
    // The pictures are not repeated in the text.
    expect(described.examples[0].rendered).toEqual({ renderedOn: expect.any(String), cropped: null, text: expect.any(String) });
  });

  test("templates: a locked block is refused, naming its template; with changeTemplates the template, and every page using it, changes", async () => {
    test.setTimeout(240000);
    const USES = '/_test_data/template-test-page';
    const ALSO_USES = '/_test_data/template-test-page-2';
    const headerOf = (page: any) => page.blocks.find((b: any) => b.slotId === 'header').value.md;
    const read = (await call('get_page', { path: USES })).json();
    expect(headerOf(read)).toBe('# Template Header - From Template');
    const ops = [{ op: 'update', id: 'template-header', set: { value: { md: '# New header' } } }];

    // Locked, as in the editor: the refusal names the template to change.
    const refused = await call('edit_blocks', { path: USES, expectedVersion: read.version, ops });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/locked.*\/_test_data\/templates\/test-layout/);

    // Changing the template: saved to the template, so another page using it shows it too.
    const saved = (await call('edit_blocks', { path: USES, expectedVersion: read.version, ops, changeTemplates: true })).json();
    expect(saved.templatesChanged).toEqual(['/_test_data/templates/test-layout']);
    expect(headerOf((await call('get_page', { path: USES })).json())).toBe('# New header');
    expect(headerOf((await call('get_page', { path: ALSO_USES })).json())).toBe('# New header');
  });

  test('the page is a block of its content type: read, listed and changed as any block', async () => {
    // A page's summary had no way in: get_page left the page's own fields out,
    // and list_block_types had no type for the page.
    test.setTimeout(240000);
    const read = (await call('get_page', { path: PAGE })).json();
    expect(read).toMatchObject({ '@uid': '_page', '@type': 'Document', title: 'Test Page' });
    expect(read).toHaveProperty('description');
    expect(read.blocks.length).toBeGreaterThan(0);

    const listed = (await call('list_block_types', { path: PAGE })).json();
    expect(listed.contentType).toBe('Document');
    expect(listed.types.Document).toMatchObject({ title: 'Page', contentType: true });
    expect(listed.types.Document.fields).toHaveProperty('description');

    (await call('edit_blocks', {
      path: PAGE, expectedVersion: read.version,
      ops: [{ op: 'update', id: '_page', set: { description: 'A summary set by the agent' } }],
    })).json();
    expect((await call('get_page', { path: PAGE })).json().description).toBe('A summary set by the agent');
  });

  test("templates: a dry run, then the change for every page, leaves the page's own slot content", async () => {
    // As an agent did it: try the template change (dry run), then make it. The
    // page's own blocks in the template's slot were replaced by an empty
    // placeholder, and stayed lost through every save after.
    test.setTimeout(240000);
    const USES = '/_test_data/template-test-page';
    const slotOf = (page: any) => page.blocks.filter((b: any) => b.slotId === 'primary').map((b: any) => b.value?.md);
    const read = (await call('get_page', { path: USES })).json();
    const before = slotOf(read);
    expect(before).toEqual(['User content - different from template default', 'Second user content block in placeholder']);
    const ops = [{ op: 'update', id: 'template-header', set: { value: { md: '# Welcome to Riverside' } } }];
    (await call('edit_blocks', { path: USES, expectedVersion: read.version, ops, changeTemplates: true, dryRun: true })).json();
    (await call('edit_blocks', { path: USES, expectedVersion: read.version, ops, changeTemplates: true })).json();
    const after = (await call('get_page', { path: USES })).json();
    expect(slotOf(after)).toEqual(before);
  });

  test('get_page opens the home page', async () => {
    // Its editor is at /edit, which the agent API named "" rather than "/":
    // the server waited for "/" until it timed out, and an agent told the
    // person it had checked the home page when it never could.
    test.setTimeout(120000);
    expect((await call('get_page', { path: '/' })).json()).toMatchObject({ path: '/', '@uid': '_page' });
  });

  test('list_children runs without an editor', async () => {
    test.setTimeout(90000);
    const listed = (await call('list_children', { path: '/_test_data', limit: 3 })).json();
    expect(listed.items).toHaveLength(3);
    expect(listed.items[0].path).toMatch(/^\/_test_data\//);
  });

  test('refuses a change the content validator would refuse, saying why, and saves nothing', async () => {
    // The validator the content in this repo goes through: an agent's change
    // is checked with it before it is previewed or saved.
    test.setTimeout(120000);
    const read = (await call('get_page', { path: PAGE })).json();
    const ops = [{ op: 'add', after: read.blocks[0]['@uid'], blocks: [{ '@type': 'teaser', href: [{ '@id': '/_test_data/no-such-page' }] }] }];
    const refused = await call('edit_blocks', { path: PAGE, expectedVersion: read.version, ops, dryRun: true });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/path not in content: \/_test_data\/no-such-page/);
    expect((await call('get_page', { path: PAGE })).json().version).toBe(read.version);
  });

  test('stage_media: a picture added to a page change, previewed, and uploaded beside the page when it is saved', async ({ urls }) => {
    test.setTimeout(180000);
    // Where the test front end sets deferImageUploads.
    const DEFERRED = '/_test_data/deferred-images-page';
    const viewed = (await call('view_page', { path: DEFERRED })).json();
    const held = (await call('stage_media', { files: [{ picture: viewed.pictures[0], name: 'from-the-agent.png' }] })).json();
    // Said plainly: staged here, not on the site, and for how long.
    expect(held).toMatchObject({ staged: true, onSite: false });
    expect(Date.parse(held.keptUntil) - Date.now()).toBeGreaterThan(110 * 60_000);
    const [added] = held.files;
    expect(added).toMatchObject({ media: expect.stringMatching(/^media:/), name: 'from-the-agent.png', type: expect.stringMatching(/^image\/(png|jpeg)$/) });
    // If any file can't be had, none are staged.
    const refused = await call('stage_media', { files: [{ picture: viewed.pictures[0] }, { picture: 'made-up' }] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/file 2 \(made-up\).*Nothing was staged/);

    const read = (await call('get_page', { path: DEFERRED })).json();
    const ops = [{ op: 'update', id: 'image', set: { url: added.media } }];

    // A preview shows the new file: the front end is handed it as a data: URL.
    const previewed = await client.callTool({
      name: 'edit_blocks', arguments: { path: DEFERRED, expectedVersion: read.version, ops, dryRun: true, preview: 'desktop' },
    }, undefined, CALL);
    expect(previewed.isError, JSON.stringify(previewed.content).slice(0, 300)).toBeFalsy();
    const [, picture] = previewed.content as any[];
    expect(picture).toMatchObject(PICTURE);
    // MCP_PREVIEW_PNG=<file> keeps the screenshot to look at.
    if (process.env.MCP_PREVIEW_PNG) writeFileSync(process.env.MCP_PREVIEW_PNG, Buffer.from(picture.data, 'base64'));
    expect((await call('get_page', { path: DEFERRED })).json().version, 'a preview saves nothing').toBe(read.version);
    // A dry run without one shows the change, naming the file by the agent's id.
    const dry = (await call('edit_blocks', { path: DEFERRED, expectedVersion: read.version, ops, dryRun: true })).json();
    expect(JSON.stringify(dry.page.blocks.find((b: any) => b['@uid'] === 'image'))).toContain(added.media);
    expect(JSON.stringify(dry.page)).not.toContain('inka-pending:');

    const saved = (await call('edit_blocks', { path: DEFERRED, expectedVersion: read.version, ops })).json();
    const item = saved.media[added.media];
    expect(item, 'the save says which item the file became').toMatch(/uploaded-image-\d+$/);
    const stored = await (await fetch(`${urls.mockApi}${DEFERRED}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    const block = JSON.stringify(stored.blocks.image);
    expect(block).toContain(new URL(item).pathname);
    expect(block).toContain('"image_scales"');
    expect(block).not.toContain('media:');

    // The id names that item from then on: used again, it is not uploaded again.
    const again = (await call('edit_blocks', { path: DEFERRED, expectedVersion: saved.version, ops: [{ op: 'update', id: 'image', set: { url: added.media } }] })).json();
    expect(again.media[added.media]).toBe(item);

    // A file no one added is refused, and so is one in a new page, for now.
    const unknown = await call('edit_blocks', { path: DEFERRED, expectedVersion: again.version, ops: [{ op: 'update', id: 'image', set: { url: 'media:made-up' } }] });
    expect(unknown.text).toMatch(/add it again/);
    const newPage = await call('create_page', { parent: '/_test_data', title: 'With a file', blocks: [{ '@type': 'image', url: added.media }] });
    expect(newPage.isError).toBe(true);
    expect(newPage.text).toMatch(/create the page first/);
  });

  test('create_page: an Image or a File item made from a staged file, as the add form makes one', async ({ urls }) => {
    test.setTimeout(180000);
    const viewed = (await call('view_page', { path: PAGE })).json();
    const { files: [photo, report, spare] } = (await call('stage_media', { files: [
      { picture: viewed.pictures[0], name: 'team.png' },
      { picture: viewed.pictures[0], name: 'report.png' },
      { picture: viewed.pictures[0], name: 'spare.png' },
    ] })).json();
    const stored = async (path: string) => (await fetch(`${urls.mockApi}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();

    const image = (await call('create_page', { parent: '/_test_data', type: 'Image', title: 'Team photo', file: photo.media })).json();
    expect(image.version).toBeTruthy();
    expect(image.reviewState).toBeTruthy();
    const madeImage = await stored(image.path);
    expect(madeImage['@type']).toBe('Image');
    expect(madeImage.title).toBe('Team photo');
    expect(madeImage.image_scales.image[0]).toMatchObject({ filename: 'team.png', 'content-type': photo.type });
    // The id names the item from then on.
    expect(new URL(image.media[photo.media]).pathname).toBe(image.path);

    const file = (await call('create_page', { parent: '/_test_data', type: 'File', title: 'Annual report', file: report.media })).json();
    const madeFile = await stored(file.path);
    expect(madeFile['@type']).toBe('File');
    expect(madeFile.file).toMatchObject({ filename: 'report.png', 'content-type': report.type });

    // A file already on the site is that item: a second one is not made of it.
    const twice = await call('create_page', { parent: '/_test_data', type: 'Image', title: 'Again', file: photo.media });
    expect(twice.isError).toBe(true);
    expect(twice.text).toMatch(/is already on the site, as .*: use that item/);
    // A type whose add form has no file to fill takes none.
    const page = await call('create_page', { parent: '/_test_data', title: 'A page', file: spare.media });
    expect(page.isError).toBe(true);
    expect(page.text).toMatch(/a Document has no file field/);
  });

  test("edit_blocks: a staged file in a page's own lead image is kept in the page, as the edit form keeps it", async ({ urls }) => {
    test.setTimeout(180000);
    const NEWS = '/_test_data/news-test-page';
    const viewed = (await call('view_page', { path: NEWS })).json();
    const { files: [lead] } = (await call('stage_media', { files: [{ picture: viewed.pictures[0], name: 'lead.png' }] })).json();
    const read = (await call('get_page', { path: NEWS })).json();
    const ops = [{ op: 'update', id: '_page', set: { preview_image: lead.media } }];

    const dry = (await call('edit_blocks', { path: NEWS, expectedVersion: read.version, ops, dryRun: true })).json();
    expect(dry.page.preview_image).toBe(lead.media);

    (await call('edit_blocks', { path: NEWS, expectedVersion: read.version, ops })).json();
    const stored = await (await fetch(`${urls.mockApi}${NEWS}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    expect(stored.preview_image).toMatchObject({ filename: 'lead.png', 'content-type': lead.type });
    expect(JSON.stringify(stored)).not.toContain('media:');
    expect(JSON.stringify(stored)).not.toContain('inka-pending:');
  });

  test('reads, dry-runs, saves, and refuses a stale version', async ({ urls }) => {
    // Every call opens the editor afresh — that is what keeps the server stateless.
    test.setTimeout(180000);
    const read = (await call('get_page', { path: PAGE })).json();
    expect(read.blocks.find((b: any) => b['@uid'] === 'block-1-uuid')['@type']).toBe('slate');

    const ops = [{ op: 'add', after: 'block-1-uuid', blocks: [{ '@uid': 'new', '@type': 'slate', value: 'From the *MCP server*' }] }];

    // A dry run returns the page as it would be, and saves nothing.
    const dryCall = await client.callTool({
      name: 'edit_blocks', arguments: { path: PAGE, expectedVersion: read.version, ops, dryRun: true, preview: 'desktop' },
    }, undefined, CALL);
    const [text, image] = dryCall.content as any[];
    const dry = JSON.parse(text.text);
    expect(dry.page.blocks.find((b: any) => b['@uid'] === dry.ids.new).value.md).toBe('From the *MCP server*');
    // The preview: the draft as a visitor sees it, as a screenshot and its text.
    expect(dry.renderedText).toContain('From the MCP server');
    // Without INKA_FRONTEND_URL, the admin's own default front end.
    expect(dry.renderedOn).not.toBe(urls.nuxt);
    expect(image).toMatchObject(PICTURE);
    expect(JSON.stringify(dryCall).length).toBeLessThan(KEPT_IN_CONVERSATION);
    // MCP_PREVIEW_PNG=<file> keeps the screenshot to look at.
    if (process.env.MCP_PREVIEW_PNG) writeFileSync(process.env.MCP_PREVIEW_PNG, Buffer.from(image.data, 'base64'));
    const after = (await call('get_page', { path: PAGE })).json();
    expect(after.blocks.map((b: any) => b['@uid'])).toEqual(read.blocks.map((b: any) => b['@uid']));
    expect(after.version).toBe(read.version);

    // Saved for real.
    const saved = (await call('edit_blocks', { path: PAGE, expectedVersion: read.version, ops })).json();
    // Plain fetch: the `request` fixture would carry a frontend project's storageState.
    const stored = await (await fetch(`${urls.mockApi}${PAGE}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })).json();
    expect(stored.blocks_layout.items[1]).toBe(saved.ids.new);

    // The version read before the save is now stale.
    const stale = await call('edit_blocks', { path: PAGE, expectedVersion: read.version, ops });
    expect(stale.isError).toBe(true);
    expect(stale.text).toMatch(/changed since it was read/);
  });
});
