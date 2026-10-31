/**
 * The screenshots are for the person too, not only the model: a client that
 * shows MCP Apps (claude.ai, Claude Desktop) shows each tool's pictures in the
 * conversation through the screenshot view. A screenshot only in the tool
 * result reached the model and never the person, who asked to see the page.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.mjs';
import { SCREENSHOT_VIEW } from './screenshotView.mjs';
import { localPictures } from './codes.mjs';

const PICTURING = ['describe_block', 'edit_blocks', 'preview_layout', 'view_page'];

describe('the screenshot view', () => {
  let client;
  beforeAll(async () => {
    const server = createServer(() => { throw new Error('no admin: nothing here calls a tool'); }, {
      pictures: localPictures({ instance: null, now: Date.now }), userOf: () => 'jane',
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);
  });

  it('is what each tool that takes a picture shows, and no other', async () => {
    const { tools } = await client.listTools();
    const shown = tools.filter((t) => t._meta?.ui?.resourceUri === SCREENSHOT_VIEW && !t._meta.ui.visibility).map((t) => t.name).sort();
    expect(shown).toEqual(PICTURING);
  });

  it("fetches a tool's pictures with a tool for it alone, which a client never lists to the model", async () => {
    // A client (Claude) hands the view a tool's result without its pictures.
    const { tools } = await client.listTools();
    const picture = tools.find((t) => t.name === 'picture');
    expect(picture._meta.ui).toEqual({ resourceUri: SCREENSHOT_VIEW, visibility: ['app'] });
  });

  it('is a page the client can show: self-contained, nothing loaded from elsewhere', async () => {
    const { contents: [view] } = await client.readResource({ uri: SCREENSHOT_VIEW });
    expect(view.mimeType).toBe('text/html;profile=mcp-app');
    expect(view.text).toMatch(/<script type="module">/);
    // The sandbox loads nothing from another origin unless it is declared.
    expect(view.text).not.toMatch(/<script[^>]+src=/);
    expect(view.text).not.toMatch(/https?:\/\/[^"'\s]+\.js/);
  });
});
