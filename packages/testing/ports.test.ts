/**
 * The harness block, and the one thing a URL in it has to get right besides
 * the number: the host.
 *
 * `localhost` and `127.0.0.1` are the same server and NOT the same origin, and
 * two of the things these ports address care which one they are told. A
 * WordPress install refuses `localhost` as an application-password
 * `success_url` — its SSRF guard rejects the host and authorize-application.php
 * 500s rather than declining — and the sign-in flow redirects back to the
 * frontend's origin, so the frontend has to be addressed as something the CMS
 * will accept. The CMS mocks already answer on 127.0.0.1.
 *
 * The host therefore belongs to the block, not to each caller: the harness's
 * own helpers build `${harnessUrls().testFrontend}/mock-parent.html`
 * themselves, so a suite that fixed the host in its own URLS map would serve
 * one server on two origins and leave postMessage checks comparing them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definePorts, harnessUrls, portEnvName } from './ports';

const BASE = 'HYDRA_PORT_BASE';
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[BASE];
  process.env[BASE] = '8980';
});

afterEach(() => {
  if (saved === undefined) delete process.env[BASE];
  else process.env[BASE] = saved;
});

describe('the host a port is addressed by', () => {
  it('gives the test frontend an address a CMS will accept', () => {
    expect(definePorts({}).URLS.testFrontend).toBe('http://127.0.0.1:8981');
  });

  it('is the same host for the harness helpers, not just for a suite', () => {
    expect(harnessUrls().testFrontend).toBe(definePorts({}).URLS.testFrontend);
  });

  it('leaves every other harness server on localhost', () => {
    const { URLS } = definePorts({});
    expect(URLS.mockApi).toBe('http://localhost:8980');
    expect(URLS.voltoSsr).toBe('http://localhost:8983');
  });

  it("lets a suite's own server say which host it answers on", () => {
    const { URLS } = definePorts({
      plain: 5,
      byAddress: { offset: 6, host: '127.0.0.1' },
    });
    expect(URLS.plain).toBe('http://localhost:8985');
    expect(URLS.byAddress).toBe('http://127.0.0.1:8986');
  });
});

describe('a port declared with a host is a port like any other', () => {
  it('derives its number from the base', () => {
    expect(definePorts({ byAddress: { offset: 7, host: '127.0.0.1' } }).PORTS.byAddress).toBe(8987);
  });

  it('reads its own variable when one is given', () => {
    const name = portEnvName('byAddress');
    process.env[name] = '9123';
    try {
      const { PORTS, URLS } = definePorts({ byAddress: { offset: 7, host: '127.0.0.1' } });
      expect(PORTS.byAddress).toBe(9123);
      expect(URLS.byAddress).toBe('http://127.0.0.1:9123');
    } finally {
      delete process.env[name];
    }
  });

  it('still refuses to share an offset', () => {
    expect(() =>
      definePorts({ a: 5, b: { offset: 5, host: '127.0.0.1' } }),
    ).toThrow(/both have offset 5/);
  });

  it("still refuses to take one of the harness's own names", () => {
    expect(() =>
      definePorts({ mockApi: { offset: 9, host: '127.0.0.1' } }),
    ).toThrow(/the harness's own/);
  });
});
