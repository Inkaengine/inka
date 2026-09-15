import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import { createServer } from 'net';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * A site root the mock GENERATES.
 *
 * Every consumer of this mock mounts content at `/`, but not every mount has a
 * document FOR `/`: hydra's own fixtures and the docs distribution carry a site
 * root on disk, while a mount of just a fixture folder (the frontend's
 * block-sanity content, say) does not. For those, `getContent('/')` falls
 * through to `getSiteRoot()`, which generates one.
 *
 * That generated root builds its own `@components`, and two of those builders
 * asked `getContent` for the very path being generated — so `getSiteRoot` called
 * `getContent('/')` called `getSiteRoot`, forever. Every request for the site
 * root 500ed with "Maximum call stack size exceeded", and since a Next frontend
 * fetches `/?expand=…` for its chrome, EVERY page did.
 *
 * The mounts that happen to have a root on disk never reach the generator, which
 * is why nothing here saw it.
 */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

test.describe('a mount with no site root on disk', () => {
  let proc: ChildProcess | undefined;
  let base = '';

  test.beforeAll(async () => {
    // One page, no `/`. This is the shape that reaches the generator.
    const dir = mkdtempSync(path.join(tmpdir(), 'mock-no-root-'));
    const pageDir = path.join(dir, 'a-page');
    mkdirSync(pageDir);
    writeFileSync(
      path.join(pageDir, 'data.json'),
      JSON.stringify({
        '@id': '/a-page',
        '@type': 'Document',
        UID: 'a-page-uid',
        id: 'a-page',
        title: 'A page',
        blocks: {},
        blocks_layout: { items: [] },
      }),
    );

    const port = await freePort();
    base = `http://localhost:${port}`;
    proc = spawn(process.execPath, [fileURLToPath(new URL('../fixtures/mock-api-server.cjs', import.meta.url))], {
      env: { ...process.env, PORT: String(port), CONTENT_MOUNTS: `/:${dir}` },
      stdio: 'ignore',
    });

    await expect(async () => {
      const res = await fetch(`${base}/health`);
      expect(res.ok).toBe(true);
    }).toPass({ timeout: 30000 });
  });

  test.afterAll(() => {
    proc?.kill();
  });

  test('serves the generated root instead of recursing into itself', async () => {
    // The expansions a Next frontend asks for on every page.
    const res = await fetch(`${base}/?expand=breadcrumbs,navroot,navigation&expand.navigation.depth=2`, {
      headers: { Accept: 'application/json' },
    });
    expect(res.status, 'the site root is servable when it is generated').toBe(200);

    const body = await res.json();
    expect(body['@type']).toBe('Plone Site');
    // The page under it is in the generated root's menu — the components are
    // built, not merely absent.
    const titles = (body['@components']?.navigation?.items ?? []).map((i: any) => i.title);
    expect(titles).toContain('A page');
  });
});
