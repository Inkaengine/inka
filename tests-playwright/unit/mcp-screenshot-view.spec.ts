/**
 * The MCP server's screenshot view, in a browser, framed by a host that speaks
 * the MCP Apps protocol as claude.ai does: it answers the view's ui/initialize,
 * and once the view says it is ready, hands it the tool call's result.
 */
import { test, expect, type Page } from '@playwright/test';
import { screenshotViewHtml } from '../../packages/inka-mcp/screenshotView.mjs';

/** A host page framing the view, which sends it `result` once it is ready. */
async function hostWith(page: Page, result: object) {
  await page.setContent('<iframe id="view" style="width:600px;height:800px"></iframe>');
  await page.evaluate(({ html, result }) => {
    const frame = document.getElementById('view') as HTMLIFrameElement;
    window.addEventListener('message', (event) => {
      if (event.source !== frame.contentWindow) return;
      const message = event.data;
      const send = (reply: object) => frame.contentWindow!.postMessage({ jsonrpc: '2.0', ...reply }, '*');
      if (message.method === 'ui/initialize') {
        send({
          id: message.id,
          result: { protocolVersion: message.params.protocolVersion, hostInfo: { name: 'test host', version: '0' }, hostCapabilities: {}, hostContext: {} },
        });
      } else if (message.method === 'ui/notifications/initialized') {
        send({ method: 'ui/notifications/tool-result', params: result });
        (window as any).resultSent = true;
      }
    });
    frame.srcdoc = html;
  }, { html: screenshotViewHtml(), result });
  return page.frameLocator('#view');
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
  });

  test('shows nothing for a call that took no picture', async ({ page }) => {
    const view = await hostWith(page, { content: [{ type: 'text', text: '{"saved":true}' }] });
    // The view connected and was handed the result.
    await page.waitForFunction(() => (window as any).resultSent);
    await page.waitForTimeout(500);
    await expect(view.locator('img')).toHaveCount(0);
  });
});
