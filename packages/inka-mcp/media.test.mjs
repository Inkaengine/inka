import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediaIn, withMedia, isPublicAddress, fetchMedia, localFiles, MediaRefused } from './media.mjs';

describe('media ids in what an agent sends', () => {
  const ops = [
    { op: 'update', id: 'b1', set: { url: 'media:one~abc', alt: 'A' } },
    { op: 'add', after: 'b1', blocks: [{ '@type': 'image', url: [{ '@id': 'media:one~def' }] }, { '@type': 'image', url: 'media:one~abc' }] },
    { op: 'update', id: 'b2', set: { value: { md: 'media:one~abc is not a file here' } } },
  ];

  it('finds each one once, wherever it is, and only a whole value', () => {
    expect([...mediaIn(ops)]).toEqual(['media:one~abc', 'media:one~def']);
  });

  it('swaps each for what it maps to, leaving the rest as it was', () => {
    const swapped = withMedia(ops, new Map([['media:one~abc', 'inka-pending:1'], ['media:one~def', 'inka-pending:2']]));
    expect(swapped[0].set).toEqual({ url: 'inka-pending:1', alt: 'A' });
    expect(swapped[1].blocks[0].url).toEqual([{ '@id': 'inka-pending:2' }]);
    expect(swapped[2]).toEqual(ops[2]);
    expect(ops[0].set.url, 'what was sent is not changed').toBe('media:one~abc');
  });
});

describe('addresses a URL may be fetched from', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
  ])('refuses %s, which is not on the public internet', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '151.101.1.1', '2606:4700::1111'])('takes %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe('fetching a file from a URL', () => {
  let server;
  let base;
  beforeAll(async () => {
    server = createServer((req, res) => {
      const routes = {
        '/shot.png': () => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.from([137, 80, 78, 71])); },
        '/download': () => {
          res.writeHead(200, { 'Content-Type': 'application/pdf; qs=0.5', 'Content-Disposition': 'attachment; filename="report.pdf"' });
          res.end('%PDF');
        },
        '/': () => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end('x'); },
        '/untyped': () => { res.writeHead(200); res.end('x'); },
        '/big': () => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.alloc(64)); },
        '/big-unsaid': () => { res.writeHead(200, { 'Content-Type': 'image/png', 'Transfer-Encoding': 'chunked' }); res.write(Buffer.alloc(40)); res.end(Buffer.alloc(40)); },
        '/missing': () => { res.writeHead(404); res.end(); },
        '/to-private': () => { res.writeHead(302, { Location: 'http://10.0.0.1/shot.png' }); res.end(); },
        '/to-shot': () => { res.writeHead(301, { Location: '/shot.png' }); res.end(); },
        '/loop': () => { res.writeHead(302, { Location: '/loop' }); res.end(); },
      };
      routes[req.url]();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  // The test server is on loopback, which the real rule refuses.
  const loopbackOnly = (address) => address === '127.0.0.1';
  const get = (path, options = {}) => fetchMedia(`${base}${path}`, { maxBytes: 50, isAllowed: loopbackOnly, ...options });

  it('gives the bytes, their type and a name from the URL', async () => {
    expect(await get('/shot.png')).toEqual({ name: 'shot.png', type: 'image/png', data: Buffer.from([137, 80, 78, 71]).toString('base64') });
  });

  it("takes the name the server gives, and the type without its parameters", async () => {
    expect(await get('/download')).toMatchObject({ name: 'report.pdf', type: 'application/pdf' });
  });

  it('takes the name it is given over either', async () => {
    expect(await get('/download', { name: 'Annual report.pdf' })).toMatchObject({ name: 'Annual report.pdf' });
  });

  it('asks for a name when the URL has none', async () => {
    await expect(get('/')).rejects.toThrow(/give it a name/);
  });

  it('refuses a file the server gives no type for', async () => {
    await expect(get('/untyped')).rejects.toThrow(/no Content-Type/);
  });

  it('refuses a file over the size limit, whether or not the server says its size first', async () => {
    await expect(get('/big')).rejects.toThrow(MediaRefused);
    await expect(get('/big')).rejects.toThrow(/larger than 50 bytes/);
    await expect(get('/big-unsaid')).rejects.toThrow(/larger than 50 bytes/);
  });

  it('says what the server answered', async () => {
    await expect(get('/missing')).rejects.toThrow(/answered 404/);
  });

  it('follows a redirect, and checks where it leads as it checked the first address', async () => {
    expect(await get('/to-shot')).toMatchObject({ name: 'shot.png' });
    await expect(get('/to-private')).rejects.toThrow(/10\.0\.0\.1 is not on the public internet/);
  });

  it('gives up on a redirect that never ends', async () => {
    await expect(get('/loop')).rejects.toThrow(/too many redirects/);
  });

  it('refuses an address the rule refuses, before connecting', async () => {
    await expect(fetchMedia(`${base}/shot.png`, { maxBytes: 50, isAllowed: isPublicAddress }))
      .rejects.toThrow(/127\.0\.0\.1 is not on the public internet/);
  });

  it('takes only http and https', async () => {
    await expect(fetchMedia('file:///etc/passwd', { maxBytes: 50, isAllowed: loopbackOnly })).rejects.toThrow(/http or https/);
  });
});

describe('a file from a folder the person allows (the stdio server)', () => {
  let root;
  let allowed;
  let read;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'inka-media-'));
    allowed = join(root, 'allowed');
    mkdirSync(join(allowed, 'team'), { recursive: true });
    writeFileSync(join(allowed, 'team', 'jane.png'), 'png bytes');
    writeFileSync(join(allowed, 'report.pdf'), 'pdf bytes');
    writeFileSync(join(allowed, 'big.png'), 'x'.repeat(51));
    writeFileSync(join(allowed, 'notes.xyz'), 'what is this');
    writeFileSync(join(root, 'secret.png'), 'not yours');
    symlinkSync(join(root, 'secret.png'), join(allowed, 'link.png'));
    read = localFiles([allowed], { maxBytes: 50 });
  });
  afterAll(() => rmSync(root, { recursive: true }));

  it('reads one inside an allowed folder, typed by its extension', async () => {
    expect(await read(join(allowed, 'team', 'jane.png'))).toEqual({
      name: 'jane.png', type: 'image/png', data: Buffer.from('png bytes').toString('base64'),
    });
    expect(await read(join(allowed, 'report.pdf'), 'Annual report.pdf')).toMatchObject({ name: 'Annual report.pdf', type: 'application/pdf' });
  });

  it.each([
    ['outside every folder', () => join(root, 'secret.png')],
    ['outside by ..', () => join(allowed, '..', 'secret.png')],
    ['outside through a link', () => join(allowed, 'link.png')],
  ])('refuses one %s', async (_, path) => {
    await expect(read(path())).rejects.toThrow(MediaRefused);
    await expect(read(path())).rejects.toThrow(/not in a folder you allowed/);
  });

  it('takes only a whole path', async () => {
    await expect(read('team/jane.png')).rejects.toThrow(/a whole path/);
  });

  it('says a file is not there', async () => {
    await expect(read(join(allowed, 'gone.png'))).rejects.toThrow(/no file at/);
  });

  it('refuses a folder', async () => {
    await expect(read(join(allowed, 'team'))).rejects.toThrow(/not a file/);
  });

  it('refuses one over the size limit', async () => {
    await expect(read(join(allowed, 'big.png'))).rejects.toThrow(/larger than 50 bytes/);
  });

  it('refuses one whose kind it does not know from its extension', async () => {
    await expect(read(join(allowed, 'notes.xyz'))).rejects.toThrow(/what kind of file .xyz is/);
  });

  it('refuses, at start, a folder that is not there', () => {
    expect(() => localFiles([join(root, 'nowhere')], { maxBytes: 50 })).toThrow(/the folder .*nowhere is not there/);
    expect(() => localFiles([join(allowed, 'report.pdf')], { maxBytes: 50 })).toThrow(/not a folder/);
  });
});
