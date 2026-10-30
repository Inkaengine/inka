/**
 * One base names the whole block.
 *
 * The no-defaults rule stopped checkouts stealing each other's servers and
 * replaced that with nineteen variables every launcher had to set — the
 * package.json scripts, three CI jobs and a consuming repo's Makefile each
 * keeping their own copy of the list. Nineteen places to set a port is
 * nineteen places to set one of them differently, which is how a run ends up
 * with its mock API in one block and its frontends in another.
 *
 * So these tests pin the properties that make `HYDRA_PORT_BASE` enough on its
 * own: a block that is internally consistent, distinct, and still refuses to
 * guess when nobody says where it starts.
 *
 * `PORTS` is built when the module is imported, so each case imports it fresh
 * under the environment it is describing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * EVERY port variable, swept from the environment rather than listed here.
 *
 * Listing five of them is how this test first passed on CI and failed on my
 * machine: a developer shell with the block exported still had
 * HYDRA_TEST_FRONTEND_PORT set, the single-port override took precedence, and
 * the "contiguous block" case was measuring my shell instead of the code.
 */
const portVars = () =>
  Object.keys(process.env).filter(
    (v) => v === 'HYDRA_PORT_BASE' || /^HYDRA_[A-Z0-9_]*PORT$/.test(v),
  );

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(portVars().map((v) => [v, process.env[v]]));
  for (const v of Object.keys(saved)) delete process.env[v];
  vi.resetModules();
});

afterEach(() => {
  for (const [v, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[v];
    else process.env[v] = value;
  }
  vi.resetModules();
});

const load = async () => {
  vi.resetModules();
  return import('./ports');
};

describe('a block from one base', () => {
  it('derives every port from HYDRA_PORT_BASE alone', async () => {
    process.env.HYDRA_PORT_BASE = '8980';
    const { PORTS } = await load();
    expect(PORTS.mockApi).toBe(8980);
    expect(Object.values(PORTS).every((p) => typeof p === 'number')).toBe(true);
  });

  it('gives every service a port of its own', async () => {
    process.env.HYDRA_PORT_BASE = '8980';
    const { PORTS } = await load();
    const values = Object.values(PORTS);
    expect(new Set(values).size).toBe(values.length);
  });

  /**
   * Not a style point: razzle derives its webpack-dev-server port by
   * incrementing PORT, so if these two drift apart the health check waits on a
   * server that is not there and Playwright's webServer gate times out with
   * nothing to say about why.
   */
  it("keeps razzle's webpack port directly above its SSR port", async () => {
    process.env.HYDRA_PORT_BASE = '8980';
    const { PORTS } = await load();
    expect(PORTS.voltoWebpack).toBe(PORTS.voltoSsr + 1);
  });

  it('keeps the block contiguous, so one number reserves a known span', async () => {
    process.env.HYDRA_PORT_BASE = '8980';
    const { PORTS } = await load();
    const values = Object.values(PORTS).sort((a, b) => a - b);
    expect(values[0]).toBe(8980);
    expect(values[values.length - 1]).toBe(8980 + values.length - 1);
  });
});

describe('what still has to be said explicitly', () => {
  it('refuses to guess when nobody says where the block starts', async () => {
    await expect(load()).rejects.toThrow(/HYDRA_PORT_BASE/);
  });

  it('names the single variable too, so the message fits either habit', async () => {
    await expect(load()).rejects.toThrow(/HYDRA_MOCK_API_PORT/);
  });

  /**
   * For pointing ONE service at something already running — a seeded Plone
   * kept up between runs — and for a consuming repo that still exports the
   * whole list, which must keep working.
   */
  it('lets a single port be overridden, base or no base', async () => {
    process.env.HYDRA_PORT_BASE = '8980';
    process.env.HYDRA_MOCK_API_PORT = '9123';
    const { PORTS } = await load();
    expect(PORTS.mockApi).toBe(9123);
    expect(PORTS.testFrontend).toBe(8984);
  });

  it('rejects a base that is not a port', async () => {
    process.env.HYDRA_PORT_BASE = 'eight-thousand';
    await expect(load()).rejects.toThrow(/must be a positive integer/);
  });
});

describe('exported for launchers', () => {
  /**
   * The one place that knows the list. A launcher exports `allPorts()` into the
   * environment and everything it starts inherits the block, instead of each
   * script repeating nineteen names.
   */
  it('hands out the whole block, keyed by name', async () => {
    process.env.HYDRA_PORT_BASE = '8980';
    const { allPorts, PORT_ENV, PORTS } = await load();
    const all = allPorts();
    expect(all).toEqual(PORTS);
    // Every port has a variable, so the block can be passed to a child process.
    expect(Object.keys(all).sort()).toEqual(Object.keys(PORT_ENV).sort());
  });
});
