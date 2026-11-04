/**
 * stage_media takes a file from the person's own computer only where the
 * server runs there (stdio) and they named the folders it may read. A hosted
 * server has no such source: it is not offered, and a path is not taken.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.mjs';
import { localMedia } from './codes.mjs';
import { localFiles } from './media.mjs';

async function connected(files) {
  const server = createServer(() => { throw new Error('no admin: staging a file needs none'); }, {
    pictures: null, media: localMedia({ instance: null, now: Date.now }), localFiles: files, userOf: () => 'jane',
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
