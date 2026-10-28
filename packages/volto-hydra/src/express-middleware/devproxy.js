// Internal proxy to bypass CORS while developing.

import express from 'express';
import config from '@plone/volto/registry';
import {
  createProxyMiddleware,
  responseInterceptor,
} from 'http-proxy-middleware';
import querystring from 'querystring';
import { parse as parseUrl } from 'url';

const filter = function (pathname, req) {
  // This is the proxy to the API in case the accept header is 'application/json'
  return config.settings.devProxyToApiPath && pathname.startsWith('/++api++');
};

let _env = null;

// the config is not available at the middleware creation time, so it needs to
// read/cache the global configuration on first request.
function getEnv() {
  if (_env) {
    return _env;
  }

  const apiPathURL = parseUrl(config.settings.apiPath);
  const proxyURL = parseUrl(config.settings.devProxyToApiPath);
  const serverURL = `${proxyURL.protocol}//${proxyURL.host}`;
  const instancePath = proxyURL.pathname;

  _env = {
    apiPathURL,
    serverURL,
    instancePath,
  };

  return _env;
}

export default function devProxyMiddleware() {
  const middleware = express.Router();
  const devProxy = createProxyMiddleware(filter, {
    selfHandleResponse: true,
    onProxyRes: responseInterceptor(
      async (responseBuffer, proxyRes, req, res) => {
        return responseBuffer;
      },
    ),
    onProxyReq: (proxyReq, req, res) => {
      //Fixes https://github.com/plone/volto/issues/6283
      proxyReq.setHeader('Host', new URL(config.settings.apiPath).host);
      // Ask the API only for encodings responseInterceptor can decompress.
      // It drops content-encoding from every response it passes on, decoded
      // or not, so a browser's `zstd` reached the API (or the CDN or edge in
      // front of it), its zstd body went out labelled as plain JSON, and the
      // host's edge compressed it again: a browser undid one layer and got
      // zstd where it expected JSON.
      proxyReq.setHeader('Accept-Encoding', 'gzip, deflate, br');
      // Fixes https://github.com/chimurai/http-proxy-middleware/issues/320
      if (!req.body || !Object.keys(req.body).length) {
        return;
      }

      const contentType = proxyReq.getHeader('Content-Type');
      const writeBody = (bodyData) => {
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
      };

      if (contentType.includes('application/json')) {
        writeBody(JSON.stringify(req.body));
      }

      if (contentType.includes('application/x-www-form-urlencoded')) {
        writeBody(querystring.stringify(req.body));
      }
    },
    // target: serverURL,
    router: (req) => {
      const { serverURL } = getEnv();
      return serverURL;
    },
    pathRewrite: (path, req) => {
      const { apiPathURL, instancePath } = getEnv();
      // Default port to 443 for https, 80 for http when not explicitly specified
      const port = apiPathURL.port || (apiPathURL.protocol === 'https:' ? 443 : 80);
      const target =
        config.settings.proxyRewriteTarget ||
        `/VirtualHostBase/${apiPathURL.protocol.slice(0, -1)}/${
          apiPathURL.hostname
        }:${port}${instancePath}/++api++/VirtualHostRoot`;

      return `${target}${path.replace('/++api++', '')}`;
    },
    logLevel: process.env.DEBUG_HPM ? 'debug' : 'silent',
    ...(process.env.RAZZLE_DEV_PROXY_INSECURE && {
      changeOrigin: true,
      secure: false,
    }),
  });

  middleware.all('*', devProxy);
  middleware.id = 'devProxy';

  return middleware;
}
