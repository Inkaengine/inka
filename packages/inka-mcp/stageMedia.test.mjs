/**
 * A file an agent stages comes from the web, a picture the MCP took, the
 * person's own computer, or the person dropping it into the conversation.
 *
 * stage_media takes a file from the person's own computer only where the
 * server runs there (stdio) and they named the folders it may read. A hosted
 * server has no such source: it is not offered, and a path is not taken.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer, MAX_FILE_BYTES } from './server.mjs';
import { DROP_VIEW } from './dropView.mjs';
import { localMedia } from './codes.mjs';
import { localFiles } from './media.mjs';

async function connected(files) {
  const server = createServer(() => { throw new Error('no admin: staging a file needs none'); }, {
    pictures: null, media: localMedia({ instance: null, now: Date.now }), localFiles: files, userOf: () => 'jane', reporting: null,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return client;
}

const fileFields = async (client) => {
  const { tools } = await client.listTools();
  const stage = tools.find((t) => t.name === 'stage_media');
  return { fields: Object.keys(stage.inputSchema.properties.files.items.properties), description: stage.description };
};

describe('stage_media, a file on the person\'s computer', () => {
  let folder;
  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'inka-stage-'));
    writeFileSync(join(folder, 'team.png'), 'png bytes');
  });
  afterAll(() => rmSync(folder, { recursive: true }));

  it('is staged from a folder the person allowed', async () => {
    const client = await connected(localFiles([folder], { maxBytes: 1000 }));
    const { fields, description } = await fileFields(client);
    expect(fields).toContain('path');
    expect(description).toMatch(/"path"/);
    const result = await client.callTool({ name: 'stage_media', arguments: { files: [{ path: join(folder, 'team.png') }] } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      staged: true, onSite: false, files: [{ name: 'team.png', type: 'image/png', bytes: 9 }],
    });
  });

  it('names the file it could not have, and stages none', async () => {
    const client = await connected(localFiles([folder], { maxBytes: 1000 }));
    const result = await client.callTool({ name: 'stage_media', arguments: { files: [{ path: join(folder, 'team.png') }, { path: '/etc/hosts' }] } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/file 2 \(\/etc\/hosts\): .*not in a folder you allowed.*Nothing was staged/);
  });

  it('is not offered where no folder is allowed, and a path is refused', async () => {
    const client = await connected(null);
    const { fields, description } = await fileFields(client);
    expect(fields).not.toContain('path');
    expect(description).not.toMatch(/"path"/);
    const result = await client.callTool({ name: 'stage_media', arguments: { files: [{ path: join(folder, 'team.png') }] } });
    expect(result.isError).toBe(true);
  });
});

describe('ask_for_files: the person drops their own file', () => {
  let client;
  beforeAll(async () => { client = await connected(null); });

  it('shows the drop view, and the model sees it as a tool that saves nothing', async () => {
    const { tools } = await client.listTools();
    const ask = tools.find((t) => t.name === 'ask_for_files');
    expect(ask._meta.ui).toEqual({ resourceUri: DROP_VIEW });
    expect(ask.annotations.readOnlyHint).toBe(true);
    const result = await client.callTool({ name: 'ask_for_files', arguments: { what: 'the team photo' } });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ asked: 'the team photo', staged: false });
  });

  it('stages a dropped file with a tool for the view alone, which a client never lists to the model', async () => {
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'stage_dropped')._meta.ui).toEqual({ resourceUri: DROP_VIEW, visibility: ['app'] });
    const data = Buffer.from('png bytes').toString('base64');
    const result = await client.callTool({ name: 'stage_dropped', arguments: { name: 'team.png', type: 'image/png', data } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ staged: true, onSite: false, files: [{ name: 'team.png', type: 'image/png', bytes: 9 }] });
    expect(result.structuredContent.files[0].media).toMatch(/^media:/);
  });

  it('refuses a dropped file over the size limit', async () => {
    const data = Buffer.alloc(MAX_FILE_BYTES + 1).toString('base64');
    const result = await client.callTool({ name: 'stage_dropped', arguments: { name: 'huge.png', type: 'image/png', data } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/huge\.png is larger than/);
  });

  it('is a page the client can show: self-contained, nothing loaded from elsewhere', async () => {
    const { contents: [view] } = await client.readResource({ uri: DROP_VIEW });
    expect(view.mimeType).toBe('text/html;profile=mcp-app');
    expect(view.text).not.toMatch(/<script[^>]+src=/);
  });

  it('is not there where the server keeps no files', async () => {
    const server = createServer(() => { throw new Error('no admin'); }, { pictures: null, media: null, localFiles: null, userOf: () => 'jane', reporting: null });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const none = new Client({ name: 'test', version: '0' });
    await none.connect(clientSide);
    const names = (await none.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('ask_for_files');
    expect(names).not.toContain('stage_dropped');
  });
});
