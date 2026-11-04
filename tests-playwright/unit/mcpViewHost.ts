/**
 * An MCP server's view (an MCP App), in a browser, framed by the MCP Apps
 * SDK's own host side (AppBridge), as a client runs it: the view's handshake,
 * then the tool call's input and its result.
 *
 * The host was hand-written here once, speaking the protocol as the view's
 * author understood it; the view passed against it and showed an empty panel
 * in Claude. A host of the SDK's own is the protocol, not a reading of it.
 */
import { type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

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
 * domains of its own (MCP Apps spec, "Content Security Policy"), as these
 * declare none.
 */
const SPEC_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
  + "img-src 'self' data:; media-src 'self' data:; connect-src 'none'";

const HOST = 'https://host.test';
const VIEW = 'https://sandbox.test/view.html';

type ToolCall = { name: string, arguments: Record<string, unknown> };

/**
 * A host page framing the view (`html`) as a client does — in a sandbox
 * (scripts, no shared origin), served with the spec's CSP — which hands it the
 * call's `input` and then `result` once the view is ready; with `answers:
 * false`, it never connects. It listens before it loads the view, unless
 * `listensLate`: then only once the view has loaded, and a moment more, as a
 * client may (the view's first word to it is lost).
 *
 * The view's own tool calls are answered by `callTool` (as the MCP server
 * would), and a message it sends to the conversation by `message`; with
 * `takesMessages: false`, the host says it takes none. What the view's frame
 * reports (CSP refusals, errors) is collected in `reported`.
 */
export async function hostWith(page: Page, html: string, result: object, {
  answers = true, listensLate = false, input = { path: '/' } as object, takesMessages = true,
  callTool = async (call: ToolCall): Promise<object> => { throw new Error(`the view called ${call.name}`); },
  message = async (params: object): Promise<object> => { throw new Error(`the view sent a message: ${JSON.stringify(params)}`); },
} = {}) {
  const reported: string[] = [];
  page.on('console', (logged) => {
    // The one refusal expected: zod (in the SDK's client) tries an eval once,
    // to see whether it may, and goes on without when it may not. Firefox
    // reports the refusal; Chromium doesn't.
    if (logged.type() === 'error' && !/blocked a JavaScript eval/.test(logged.text())) reported.push(logged.text());
  });
  page.on('pageerror', (error) => reported.push(error.message));
  await page.exposeFunction('serverCallTool', callTool);
  await page.exposeFunction('conversationMessage', message);
  await page.route(VIEW, (route) => route.fulfill({
    contentType: 'text/html', headers: { 'Content-Security-Policy': SPEC_CSP }, body: html,
  }));
  await page.route(`${HOST}/`, (route) => route.fulfill({
    contentType: 'text/html', body: '<!DOCTYPE html><iframe id="view" sandbox="allow-scripts" style="width:600px;height:800px"></iframe>',
  }));
  await page.goto(`${HOST}/`);
  await page.addScriptTag({ content: await hostSide });
  await page.evaluate(async ({ view, result, answers, listensLate, input, takesMessages }) => {
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
    const bridge = new AppBridge(null, { name: 'test host', version: '0' }, {
      serverTools: {}, logging: {}, ...(takesMessages && { message: { text: {} } }),
    });
    // The client sizes the view's frame by what the view reports (a view that
    // reports no height is a frame no one sees).
    (window as any).sizes = [];
    bridge.onsizechange = (size: object) => (window as any).sizes.push(size);
    bridge.oncalltool = (call: object) => (window as any).serverCallTool(call);
    bridge.onmessage = (params: object) => (window as any).conversationMessage(params);
    bridge.oninitialized = async () => {
      await bridge.sendToolInput({ arguments: input });
      await bridge.sendToolResult(result);
      (window as any).resultSent = true;
    };
    await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
    if (!listensLate) await load();
  }, { view: VIEW, result, answers, listensLate, input, takesMessages });
  return Object.assign(page.frameLocator('#view'), { reported });
}
