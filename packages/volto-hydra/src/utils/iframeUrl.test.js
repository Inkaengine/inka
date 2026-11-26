import { describe, expect, it } from 'vitest';
import { addUrlParams, proxyFrameUrl } from './iframeUrl';

describe('proxyFrameUrl', () => {
  // The admin loads the adapter's page from the FRONTEND, so it has to be
  // addressed the way that frontend is addressed. Setting an absolute pathname
  // got this wrong twice over for the canvas as it is actually deployed
  // (`pnpm run canvas`, hash-routed under /canvas/): it dropped the base path
  // AND asked for a path a hash-routed static build does not serve, so the
  // proxy 404'd, no adapter ever announced, and the editor never loaded.
  it('puts the proxy in the hash of a hash-routed frontend, keeping its base path', () => {
    expect(proxyFrameUrl('http://127.0.0.1:33243/canvas/#/', 'tok')).toBe(
      'http://127.0.0.1:33243/canvas/?access_token=tok#/hydra-proxy.html',
    );
  });

  it('handles a hash with no trailing slash (the F7 frontend)', () => {
    expect(proxyFrameUrl('http://localhost:3293/#!', 'tok')).toBe(
      'http://localhost:3293/?access_token=tok#!/hydra-proxy.html',
    );
  });

  it('uses the pathname for a path-routed frontend', () => {
    expect(proxyFrameUrl('http://localhost:3290', 'tok')).toBe(
      'http://localhost:3290/hydra-proxy.html?access_token=tok',
    );
  });

  it('keeps the base path of a path-routed frontend served under a subpath', () => {
    expect(proxyFrameUrl('http://example.test/app/', 'tok')).toBe(
      'http://example.test/app/hydra-proxy.html?access_token=tok',
    );
  });

  it("carries the frontend's own parameters and drops _edit", () => {
    expect(proxyFrameUrl('http://localhost:3290/?cms=wordpress&_edit=true', 'tok')).toBe(
      'http://localhost:3290/hydra-proxy.html?cms=wordpress&access_token=tok',
    );
  });

  it('omits the token when there is none to pass', () => {
    expect(proxyFrameUrl('http://localhost:3290', null)).toBe(
      'http://localhost:3290/hydra-proxy.html',
    );
  });
});

describe('addUrlParams', () => {
  it('appends the content path to the hash of a hash-routed frontend', () => {
    expect(
      addUrlParams('http://127.0.0.1:1/canvas/#/', { _edit: 'true' }, '/_test_data/test-page'),
    ).toBe('http://127.0.0.1:1/canvas/?_edit=true#/_test_data/test-page');
  });
});
