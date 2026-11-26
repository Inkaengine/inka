/**
 * The MCP server's screenshot view, in a browser, framed by the MCP Apps SDK's
 * own host side (mcpViewHost.ts), as a client runs it.
 */
import { test, expect, type Page } from '@playwright/test';
import { screenshotViewHtml } from '../../packages/inka-mcp/screenshotView.mjs';
import { hostWith as host } from './mcpViewHost';

/**
 * The view, hosted, handed `result`. `server` answers the view's `picture`
 * tool, by id, as the server does (an error for one it doesn't hold).
 */
function hostWith(page: Page, result: object, { server = {} as Record<string, object>, ...options } = {}) {
  return host(page, screenshotViewHtml(), result, {
    ...options,
    callTool: async ({ name, arguments: args }) => {
      if (name !== 'picture') throw new Error(`the view called ${name}`);
      const held = server[args.id as string];
      return held
        ? { content: [{ type: 'text', text: `the picture ${args.id}` }], structuredContent: held }
        : { content: [{ type: 'text', text: 'the picture is no longer kept: take it again' }], isError: true };
    },
  });
}

/** A real picture, as a tool result carries it. */
async function picture(page: Page, colour: string) {
  const shot = await page.context().newPage();
  await shot.setContent(`<body style="margin:0;background:${colour};width:200px;height:100px"></body>`);
  const data = (await shot.screenshot({ clip: { x: 0, y: 0, width: 200, height: 100 } })).toString('base64');
  await shot.close();
  return { type: 'image', data, mimeType: 'image/png' };
}

test.describe('screenshot view', () => {
  test("shows the person each picture in the tool's result", async ({ page }) => {
    const [red, blue] = [await picture(page, 'red'), await picture(page, 'blue')];
    const view = await hostWith(page, { content: [{ type: 'text', text: '{"path":"/"}' }, red, blue] });
    const images = view.locator('img');
    await expect(images).toHaveCount(2);
    await expect(images.nth(0)).toHaveAttribute('src', `data:image/png;base64,${red.data}`);
    await expect(images.nth(1)).toHaveAttribute('src', `data:image/png;base64,${blue.data}`);
    // Drawn, not just placed: the picture decoded.
    expect(await images.nth(0).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(200);
    await expect(view.locator('#status')).toBeHidden();
    // Nothing the sandbox or its CSP refused.
    expect(view.reported).toEqual([]);
    // Sized to show them: the last size it reported holds both pictures.
    await expect.poll(async () => (await page.evaluate(() => (window as any).sizes)).at(-1)?.height ?? 0).toBeGreaterThan(200);
  });

  // On claude.ai the view's frame stayed 0px tall, and on Claude's Android app
  // an empty panel: a client that starts listening after the view has asked
  // to connect never hears it, and the view, asking once, waited for ever.
  test('connects to a client that starts listening only after the view has loaded', async ({ page }) => {
    const red = await picture(page, 'red');
    const view = await hostWith(page, { content: [red] }, { listensLate: true });
    await expect(view.locator('img')).toHaveCount(1);
    expect(view.reported).toEqual([]);
  });

  // On Claude's Android app the view showed an empty panel, and nothing said
  // whether it had connected, been handed a result, or what the result held.
  test('says so while it waits for the client', async ({ page }) => {
    const view = await hostWith(page, { content: [] }, { answers: false });
    await expect(view.locator('#status')).toHaveText('Connecting to the conversation…');
  });

  // Claude hands the view a tool's result without its pictures: the view asks
  // the server for each one the result names.
  test("fetches the pictures a result names, when the client hands it the result without them", async ({ page }) => {
    const [red, blue] = [await picture(page, 'red'), await picture(page, 'blue')];
    const view = await hostWith(page, { content: [{ type: 'text', text: JSON.stringify({ path: '/', pictures: ['p-red', 'p-blue'] }) }] }, {
      server: { 'p-red': { mimeType: red.mimeType, data: red.data }, 'p-blue': { mimeType: blue.mimeType, data: blue.data } },
    });
    const images = view.locator('img');
    await expect(images).toHaveCount(2);
    await expect(images.nth(0)).toHaveAttribute('src', `data:image/png;base64,${red.data}`);
    await expect(images.nth(1)).toHaveAttribute('src', `data:image/png;base64,${blue.data}`);
    await expect(view.locator('#status')).toBeHidden();
  });

  test('says so when a picture the result names is no longer kept', async ({ page }) => {
    const view = await hostWith(page, { content: [{ type: 'text', text: JSON.stringify({ path: '/', pictures: ['p-gone'] }) }] });
    await expect(view.locator('#status')).toHaveText('The picture could not be had: the picture is no longer kept: take it again');
  });

  // Under a call that took no picture (an edit saved without a preview), the
  // panel said "No picture in this result": there was nothing to say.
  test('shows nothing for a call that took no picture', async ({ page }) => {
    const view = await hostWith(page, { content: [{ type: 'text', text: '{"saved":true}' }] });
    await page.waitForFunction(() => (window as any).resultSent);
    await expect(view.locator('#status')).toBeHidden();
    await expect(view.locator('img')).toHaveCount(0);
  });

  test('says so when the server keeps no pictures for it', async ({ page }) => {
    const view = await hostWith(page, { content: [{ type: 'text', text: JSON.stringify({ path: '/', pictures: [] }) }] });
    await expect(view.locator('#status')).toHaveText('This site\'s MCP server keeps no pictures for this view; the assistant still sees them.');
  });
});
