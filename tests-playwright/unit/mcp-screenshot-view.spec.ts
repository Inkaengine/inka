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
 * never connects. It listens before it loads the view, unless `listensLate`:
 * then only once the view has loaded, and a moment more, as a client may (the
 * view's first word to it is lost). What the view's frame reports (CSP
 * refusals, errors) is collected in `reported`.
 */
async function hostWith(page: Page, result: object, {
  answers = true, listensLate = false, input = { path: '/' }, server = {} as Record<string, object>,
} = {}) {
  const reported: string[] = [];
  page.on('console', (message) => {
    // The one refusal expected: zod (in the SDK's client) tries an eval once,
    // to see whether it may, and goes on without when it may not. Firefox
    // reports the refusal; Chromium doesn't.
    if (message.type() === 'error' && !/blocked a JavaScript eval/.test(message.text())) reported.push(message.text());
  });
  page.on('pageerror', (error) => reported.push(error.message));
  await page.route(VIEW, (route) => route.fulfill({
    contentType: 'text/html', headers: { 'Content-Security-Policy': SPEC_CSP }, body: screenshotViewHtml(),
  }));
  await page.route(`${HOST}/`, (route) => route.fulfill({
    contentType: 'text/html', body: '<!DOCTYPE html><iframe id="view" sandbox="allow-scripts" style="width:600px;height:800px"></iframe>',
  }));
  await page.goto(`${HOST}/`);
  await page.addScriptTag({ content: await hostSide });
  await page.evaluate(async ({ view, result, answers, listensLate, input, server }) => {
    const frame = document.getElementById('view') as HTMLIFrameElement;
    const { AppBridge, PostMessageTransport } = (window as any).extApps;
    const loaded = new Promise((done) => { frame.onload = done; });
    const load = () => { frame.src = view; return loaded; };
    if (!answers) {
      await load();
      return;
    }
    if (listensLate) {
      await load();
      await new Promise((later) => { setTimeout(later, 1000); });
    }
    const bridge = new AppBridge(null, { name: 'test host', version: '0' }, { serverTools: {}, logging: {} });
    // The client sizes the view's frame by what the view reports (a view that
    // reports no height is a frame no one sees).
    (window as any).sizes = [];
    bridge.onsizechange = (size: object) => (window as any).sizes.push(size);
    // The MCP server, for the view's own calls: `server` answers the `picture`
    // tool, by id, as the server does (an error for one it doesn't hold).
    bridge.oncalltool = async ({ name, arguments: args }: { name: string, arguments: { id: string } }) => {
      if (name !== 'picture') throw new Error(`the view called ${name}`);
      const held = server[args.id];
      return held
        ? { content: [{ type: 'text', text: `the picture ${args.id}` }], structuredContent: held }
        : { content: [{ type: 'text', text: 'the picture is no longer kept: take it again' }], isError: true };
    };
    bridge.oninitialized = async () => {
      await bridge.sendToolInput({ arguments: input });
      await bridge.sendToolResult(result);
      (window as any).resultSent = true;
    };
    await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
    if (!listensLate) await load();
  }, { view: VIEW, result, answers, listensLate, input, server });
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

  test('says what a result without a picture held', async ({ page }) => {
    const view = await hostWith(page, { content: [{ type: 'text', text: '{"saved":true}' }] });
    await expect(view.locator('#status')).toHaveText('No picture in this result (it held: text).');
    await expect(view.locator('img')).toHaveCount(0);
  });
});
