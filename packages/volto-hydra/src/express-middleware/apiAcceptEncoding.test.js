import http from 'node:http';
import zlib from 'node:zlib';
import express from 'express';
import config from '@plone/volto/registry';
import devProxyMiddleware from '@plone/volto/express-middleware/devproxy';
import { apiAcceptEncoding } from './apiAcceptEncoding';

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

describe("the admin's API proxy (Volto's devproxy)", () => {
  let api;
  let apiUrl;
  const saved = {};

  beforeAll(async () => {
    api = compressingApi({ title: 'A page' });
    apiUrl = await listen(api);
    const { apiPath, devProxyToApiPath, subpathPrefix } = config.settings;
    Object.assign(saved, { apiPath, devProxyToApiPath, subpathPrefix });
    config.settings.apiPath = apiUrl;
    config.settings.devProxyToApiPath = apiUrl;
    // As Volto's defaults have it: the proxy answers `${subpathPrefix}/++api++`.
    config.settings.subpathPrefix = '';
  });

  afterAll(() => {
    api.close();
    Object.assign(config.settings, saved);
  });

  /** The admin's server: these middleware in this order, as Volto mounts expressMiddleware. */
  async function adminWith(middleware) {
    const app = express();
    for (const m of middleware) app.use(m);
    const server = http.createServer(app);
    return { server, url: await listen(server) };
  }

  const asABrowser = { Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate, br, zstd' };

  it('answers a browser that accepts zstd with a body its header describes', async () => {
    const admin = await adminWith([apiAcceptEncoding, devProxyMiddleware()]);
    try {
      const res = await get(`${admin.url}/++api++/a-page`, asABrowser);
      expect(res.status).toBe(200);
      expect(JSON.parse(decodedAsLabelled(res).toString())).toEqual({ title: 'A page' });
    } finally {
      admin.server.close();
    }
  });

  it('without it, Volto’s proxy sends zstd labelled as plain JSON', async () => {
    // What this middleware is for: the proxy alone drops the content-encoding
    // of a body it could not decode.
    const admin = await adminWith([devProxyMiddleware()]);
    try {
      const res = await get(`${admin.url}/++api++/a-page`, asABrowser);
      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(() => JSON.parse(res.body.toString())).toThrow();
    } finally {
      admin.server.close();
    }
  });
});
