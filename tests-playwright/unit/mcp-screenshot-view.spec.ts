/**
 * The MCP server's screenshot view, in a browser, framed by the MCP Apps SDK's
 * own host side (AppBridge), as a client runs it: the view's handshake, then
 * the tool call's input and its result.
 *
 * The host was hand-written here once, speaking the protocol as the view's
 * author understood it; the view passed against it and showed an empty panel
 * in Claude. A host of the SDK's own is the protocol, not a reading of it.
 */
import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { screenshotViewHtml } from '../../packages/inka-mcp/screenshotView.mjs';

/** The SDK's host side, bundled for the host page: `window.extApps`. */
const hostSide = build({
  stdin: {
    contents: "export { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';",
    // Where the MCP server resolves its own copy of the SDK.
    resolveDir: fileURLToPath(new URL('../../packages/inka-mcp', import.meta.url)),
  },
  bundle: true, format: 'iife', globalName: 'extApps', platform: 'browser', write: false, logLevel: 'error',
}).then(({ outputFiles: [bundle] }) => bundle.text);

/**
 * The Content Security Policy a client must give a view that declares no
 * domains of its own (MCP Apps spec, "Content Security Policy"), as this one
 * declares none.
 */
const SPEC_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
  + "img-src 'self' data:; media-src 'self' data:; connect-src 'none'";

const HOST = 'https://host.test';
const VIEW = 'https://sandbox.test/view.html';

/**
 * A host page framing the view as a client does — in a sandbox (scripts, no
 * shared origin), served with the spec's CSP — which hands it the call's
 * `input` and then `result` once the view is ready; with `answers: false`, it
 * never connects. What the view's frame reports (CSP refusals, errors) is
 * collected in `reported`.
 */
async function hostWith(page: Page, result: object, { answers = true, input = { path: '/' } } = {}) {
  const reported: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') reported.push(message.text()); });
  page.on('pageerror', (error) => reported.push(error.message));
  await page.route(VIEW, (route) => route.fulfill({
    contentType: 'text/html', headers: { 'Content-Security-Policy': SPEC_CSP }, body: screenshotViewHtml(),
  }));
  await page.route(`${HOST}/`, (route) => route.fulfill({
    contentType: 'text/html', body: '<!DOCTYPE html><iframe id="view" sandbox="allow-scripts" style="width:600px;height:800px"></iframe>',
  }));
  await page.goto(`${HOST}/`);
  await page.addScriptTag({ content: await hostSide });
  await page.evaluate(async ({ view, result, answers, input }) => {
    const frame = document.getElementById('view') as HTMLIFrameElement;
    const { AppBridge, PostMessageTransport } = (window as any).extApps;
    const loaded = new Promise((done) => { frame.onload = done; });
    frame.src = view;
    await loaded;
    if (!answers) return;
    const bridge = new AppBridge(null, { name: 'test host', version: '0' }, { serverTools: {}, logging: {} });
    bridge.oninitialized = async () => {
      await bridge.sendToolInput({ arguments: input });
      await bridge.sendToolResult(result);
      (window as any).resultSent = true;
    };
    await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
  }, { view: VIEW, result, answers, input });
  return Object.assign(page.frameLocator('#view'), { reported });
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
  });

  // On Claude's Android app the view showed an empty panel, and nothing said
  // whether it had connected, been handed a result, or what the result held.
  test('says so while it waits for the client', async ({ page }) => {
    const view = await hostWith(page, { content: [] }, { answers: false });
    await expect(view.locator('#status')).toHaveText('Connecting to the conversation…');
  });

  test('says what a result without a picture held', async ({ page }) => {
    const view = await hostWith(page, { content: [{ type: 'text', text: '{"saved":true}' }] });
    await expect(view.locator('#status')).toHaveText('No picture in this result (it held: text).');
    await expect(view.locator('img')).toHaveCount(0);
  });
});
