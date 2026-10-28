import http from 'node:http';
import zlib from 'node:zlib';
import express from 'express';
import config from '@plone/volto/registry';
import devProxyMiddleware from './devproxy';

/**
 * The API, as a CDN or Fly's edge serves it: compressed with the best
 * encoding the request accepts (zstd, then brotli), else plain.
 */
function compressingApi(body) {
  return http.createServer((req, res) => {
    const accepts = req.headers['accept-encoding'] || '';
    const json = Buffer.from(JSON.stringify(body));
    if (accepts.includes('zstd')) {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'zstd' });
      res.end(zlib.zstdCompressSync(json));
    } else if (accepts.includes('br')) {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'br' });
      res.end(zlib.brotliCompressSync(json));
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(json);
    }
  });
}

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
});

/** A raw GET (node:http, so nothing decodes it for us): status, headers, body bytes. */
const get = (url, headers) => new Promise((resolve, reject) => {
  http.get(url, { headers }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  }).on('error', reject);
});

/** The body as its content-encoding header says it is: what a browser makes of it. */
function decodedAsLabelled({ headers, body }) {
  switch (headers['content-encoding']) {
    case undefined: return body;
    case 'zstd': return zlib.zstdDecompressSync(body);
    case 'br': return zlib.brotliDecompressSync(body);
    case 'gzip': return zlib.gunzipSync(body);
    default: throw new Error(`unexpected content-encoding ${headers['content-encoding']}`);
  }
}

describe('devProxy', () => {
  let api;
  let admin;
  let adminUrl;
  const settings = {};

  beforeAll(async () => {
    api = compressingApi({ title: 'A page' });
    const apiUrl = await listen(api);
    Object.assign(settings, config.settings);
    config.settings.apiPath = apiUrl;
    config.settings.devProxyToApiPath = apiUrl;
    const app = express();
    app.use(devProxyMiddleware());
    admin = http.createServer(app);
    adminUrl = await listen(admin);
  });

  afterAll(() => {
    admin.close();
    api.close();
    config.settings = settings;
  });

  it('answers a browser that accepts zstd with a body its header describes', async () => {
    // The API compresses with zstd for a request that accepts it. Passed on
    // with its content-encoding dropped, the bytes went out labelled as plain
    // JSON, and the host's edge compressed them again: a browser undid one
    // layer and got zstd where it expected JSON.
    const res = await get(`${adminUrl}/++api++/a-page`, {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(decodedAsLabelled(res).toString())).toEqual({ title: 'A page' });
  });
});
