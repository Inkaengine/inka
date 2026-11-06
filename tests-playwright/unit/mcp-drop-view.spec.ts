/**
 * The MCP server's drop view, in a browser, framed by the MCP Apps SDK's own
 * host side (mcpViewHost.ts), as a client runs it under ask_for_files. A
 * client like claude.ai can't hand a chat attachment's bytes to a tool, so the
 * person drops their file here: the view stages it (stage_dropped) and tells
 * the assistant its media id in a message.
 */
import { test, expect, type Page } from '@playwright/test';
import { dropViewHtml } from '../../packages/inka-mcp/dropView.mjs';
import { hostWith } from './mcpViewHost';

const MAX_BYTES = 1000;
const ASKED = { content: [{ type: 'text', text: JSON.stringify({ asked: 'the team photo', staged: false }) }] };
const PHOTO = { name: 'team.png', mimeType: 'image/png', buffer: Buffer.from('png bytes') };

/** The server's stage_dropped, staging each file as media:<n>; `calls` has what it was handed. */
function stager() {
  const calls: Record<string, unknown>[] = [];
  const callTool = async ({ name, arguments: args }) => {
    if (name !== 'stage_dropped') throw new Error(`the view called ${name}`);
    calls.push(args);
    const held = { media: `media:${calls.length}`, name: args.name, type: args.type, bytes: Buffer.from(args.data, 'base64').length };
    const result = { staged: true, onSite: false, keptUntil: '2026-11-04T12:00:00Z', files: [held] };
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  };
  return { calls, callTool };
}

/** The conversation, collecting each message the view sends it. */
function conversation() {
  const messages: { role: string, content: { type: string, text: string }[] }[] = [];
  return { messages, message: async (params) => { messages.push(params); return {}; } };
}

const viewFrame = (page: Page) => page.frames().find((frame) => frame.url().startsWith('https://sandbox.test/'))!;

test.describe('drop view', () => {
  test('a file the person chooses is staged, and the assistant is told its media id', async ({ page }) => {
    const { calls, callTool } = stager();
    const { messages, message } = conversation();
    const view = await hostWith(page, dropViewHtml({ maxBytes: MAX_BYTES }), ASKED, { callTool, message });
    await expect(view.locator('#asked')).toHaveText('The assistant asks for: the team photo');
    await expect(view.locator('#zone')).toContainText('not on the site until the change is saved');
    await view.locator('#choose').setInputFiles(PHOTO);
    await expect(view.locator('#files li')).toHaveText(['team.png: staged, not on the site until the change is saved']);
    expect(calls).toEqual([{ name: 'team.png', type: 'image/png', data: PHOTO.buffer.toString('base64') }]);
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content[0].text).toBe(
      'I dropped files for the page change. They are staged, not on the site yet:\n- team.png (image/png): media:1',
    );
    expect(view.reported).toEqual([]);
  });

  test('files dropped on it are staged, all named in one message', async ({ page }) => {
    const { callTool } = stager();
    const { messages, message } = conversation();
    const view = await hostWith(page, dropViewHtml({ maxBytes: MAX_BYTES }), ASKED, { callTool, message });
    await expect(view.locator('#asked')).not.toBeEmpty();
    const frame = viewFrame(page);
    const dropped = await frame.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['png bytes'], 'a.png', { type: 'image/png' }));
      transfer.items.add(new File(['pdf bytes'], 'report.pdf', { type: 'application/pdf' }));
      return transfer;
    });
    await frame.locator('#zone').dispatchEvent('drop', { dataTransfer: dropped });
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0].content[0].text).toContain('- a.png (image/png): media:1\n- report.pdf (application/pdf): media:2');
  });

  test('a file the server refuses is said so, and the assistant is told nothing', async ({ page }) => {
    const { messages, message } = conversation();
    const view = await hostWith(page, dropViewHtml({ maxBytes: MAX_BYTES }), ASKED, {
      message,
      callTool: async () => ({ content: [{ type: 'text', text: 'the file is no longer kept: add it again' }], isError: true }),
    });
    await view.locator('#choose').setInputFiles(PHOTO);
    await expect(view.locator('#files li')).toHaveText(['team.png: the file is no longer kept: add it again']);
    expect(messages).toEqual([]);
  });

  test('a file over the size limit is refused before it is sent', async ({ page }) => {
    const { calls, callTool } = stager();
    const view = await hostWith(page, dropViewHtml({ maxBytes: MAX_BYTES }), ASKED, { callTool });
    await view.locator('#choose').setInputFiles({ ...PHOTO, buffer: Buffer.alloc(MAX_BYTES + 1) });
    await expect(view.locator('#files li')).toHaveText([`team.png: larger than ${MAX_BYTES} bytes, the most a file may be`]);
    expect(calls).toEqual([]);
  });

  test('where the conversation takes no message from a view, the person is shown the ids to pass on', async ({ page }) => {
    const { callTool } = stager();
    const view = await hostWith(page, dropViewHtml({ maxBytes: MAX_BYTES }), ASKED, { callTool, takesMessages: false });
    await view.locator('#choose').setInputFiles(PHOTO);
    await expect(view.locator('#status')).toContainText('This conversation takes no message from the view. Tell the assistant:');
    await expect(view.locator('#status')).toContainText('team.png (image/png): media:1');
  });
});
