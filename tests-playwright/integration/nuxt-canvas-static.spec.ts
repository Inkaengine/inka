/**
 * The canvas as it is deployed: the Nuxt starter's editing build, as
 * scripts/netlify-build.sh builds it (hash-routed, under /canvas/), served as
 * plain static files with no routing rules, as a CDN serves it. The admin
 * frames `<canvas>/#/<page>`, so one file serves every page; a page below the
 * root must load in the canvas and connect to the editor.
 *
 * The dev-server specs can't see this: a dev server routes any path itself.
 * inka.sh's canvas 404'd for every page but the homepage while they passed.
 */
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { PORTS, URLS } from '../ports';

const STARTER = new URL('../../examples/nuxt-blog-starter/', import.meta.url).pathname;
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

/** Files as they are, and 404 for anything that isn't one: no fallback, no rewrites. */
function staticFiles(root: string): Server {
  return createServer((req, res) => {
    let file = join(root, decodeURIComponent(new URL(req.url!, 'http://x').pathname));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404).end('404 - File Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
}

test.describe('the deployed canvas (static, hash-routed)', () => {
  let site: string;
  let server: Server;
  let canvas: string;

  test.beforeAll(async () => {
    test.setTimeout(600000);
    // Built as the deploy builds it: netlify-build.sh's canvas step.
    execFileSync('pnpm', ['run', 'canvas'], {
      cwd: STARTER,
      stdio: 'pipe',
      // A production build, as the deploy's: the test runner's own NODE_ENV
      // otherwise makes `nuxt generate` emit a dev build (Vite's client and
      // absolute module paths), which no static host can serve.
      env: { ...process.env, NODE_ENV: 'production', NUXT_TEST_BACKEND: URLS.mockApi, NUXT_ADMIN_URL: URLS.voltoSsr },
    });
    site = mkdtempSync(join(tmpdir(), 'inka-canvas-'));
    cpSync(join(STARTER, '.output/public'), join(site, 'canvas'), { recursive: true });
    server = staticFiles(site);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    canvas = `http://127.0.0.1:${(server.address() as AddressInfo).port}/canvas/#/`;
  });

  test.afterAll(() => {
    server?.close();
    if (site) rmSync(site, { recursive: true, force: true });
  });

  test('a page below the root loads in the canvas and connects', async ({ page, context }) => {
    // Without a route on the server, a path-routed canvas 404s here.
    const deep = await fetch(canvas.replace('#/', '_test_data/test-page'));
    expect(deep.status).toBe(404);

    await context.addCookies([{ name: `iframe_url_${PORTS.voltoSsr}`, value: canvas, domain: 'localhost', path: '/' }]);
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await expect(page.locator('#previewIframe')).toHaveAttribute('src', /\/canvas\/\?.*#\/.*test-page/);
    await helper.waitForIframeReady();
    await helper.clickBlockInIframe('block-1-uuid');
  });
});
