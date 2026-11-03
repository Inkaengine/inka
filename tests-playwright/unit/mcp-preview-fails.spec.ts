/**
 * A preview of a draft the front end can't render is a failure, not a picture
 * of the failure. An agent's slider had slides without ids; the Nuxt front end
 * caught the error and showed its 500 page, and the MCP returned that page's
 * screenshot as a successful preview. The agent went on as if it had worked.
 *
 * The front end here is a small one, served locally: it fetches the page's
 * content in the browser (as previewDraft needs) and renders each block with
 * its data-block-uid, or, for a block of type `unrenderable`, its error page.
 */
import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { previewDraft } from '../../packages/inka-mcp/preview.mjs';

const FRONTEND = `<!DOCTYPE html><html><body><main id="page">Loading...</main><script>
  fetch('/++api++' + location.pathname, { headers: { Accept: 'application/json' } })
    .then((response) => response.json())
    .then((content) => {
      const page = document.getElementById('page');
      const blocks = content.blocks_layout.items.map((uid) => [uid, content.blocks[uid]]);
      if (blocks.some(([, block]) => block['@type'] === 'unrenderable')) {
        page.innerHTML = '<h1>500</h1><p>render: an item has no "@id"</p>';
        return;
      }
      if (blocks.some(([, block]) => block['@type'] === 'throws')) {
        page.textContent = '';
        throw new Error('render: no renderer for "throws"');
      }
      page.innerHTML = blocks.map(([uid, block]) => '<div data-block-uid="' + uid + '">' + block.text + '</div>').join('');
    });
</script></body></html>`;

const SAVED = { '@id': '/page', title: 'Page', blocks: { a: { '@type': 'text', text: 'Saved' } }, blocks_layout: { items: ['a'] } };

let server: Server;
let origin: string;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url!.startsWith('/++api++')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(SAVED));
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(FRONTEND);
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterAll(() => new Promise<void>((closed) => server.close(() => closed())));

const draftOf = (blocks: Record<string, object>) => ({ blocks, blocks_layout: { items: Object.keys(blocks) } });
const preview = (page, draft) => previewDraft(page.context(), { frontendUrl: `${origin}/page`, path: '/page', draft, maxChars: 100_000 });

test.describe('previewDraft', () => {
  test('a draft the front end renders: its picture and text', async ({ page }) => {
    const rendered = await preview(page, draftOf({ b: { '@type': 'text', text: 'Drafted' } }));
    expect(rendered.text).toContain('Drafted');
    expect(rendered.image.length).toBeGreaterThan(0);
  });

  test('a draft the front end shows its error page for: fails, with what the page said', async ({ page }) => {
    await expect(preview(page, draftOf({ s: { '@type': 'unrenderable' } })))
      .rejects.toThrow(/the front end did not render the draft.*render: an item has no "@id"/s);
  });

  test('a draft the front end throws on: fails, with the error', async ({ page }) => {
    await expect(preview(page, draftOf({ t: { '@type': 'throws' } })))
      .rejects.toThrow(/the front end did not render the draft.*no renderer for "throws"/s);
  });
});
