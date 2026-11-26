/**
 * Test infrastructure ports: one block, named once.
 *
 * THERE ARE NO DEFAULTS. Every port must be given as HYDRA_<NAME>_PORT, or the
 * whole block as HYDRA_PORT_BASE, and a missing one is a hard failure rather
 * than a quiet fall back to 8888/3001.
 *
 * The defaults were the problem. A checkout that ran playwright directly bound
 * the historical numbers, which are shared with every other hydra checkout on
 * the machine — so one run would take over, or quietly talk to, another
 * project's servers. Nothing in the output said so; the ports simply worked
 * until the day they belonged to someone else.
 *
 * ONE number names the whole block: HYDRA_PORT_BASE.
 *
 * Removing the defaults fixed the collisions and left a different problem —
 * nineteen variables that every launcher had to set, and so nineteen chances
 * to set one of them differently. So a run says where its block starts, once,
 * and every port is that plus a fixed offset. `HYDRA_PORT_BASE=8980` is the
 * whole configuration.
 *
 * A single port may still be given explicitly, and then it wins. That is for
 * pointing one service at something already running — a seeded Plone kept up
 * between runs — not for configuring a suite; and it is what keeps a launcher
 * that still exports the whole list working unchanged.
 *
 * The harness owns the first offsets: the servers every suite has (the mock
 * API, the test frontend serving mock-parent, the admin and its webpack dev
 * server). A suite adds its own frontends above them with `definePorts`.
 *
 * Not in scope: URLs embedded as DATA inside fixture content — those are
 * historical site URLs in saved content, not infrastructure config.
 */

const BASE = 'HYDRA_PORT_BASE';

/**
 * The harness's own servers. The NAMES are the contract; these numbers only
 * have to be distinct and stable.
 *
 * `voltoWebpack` must stay one above `voltoSsr`: razzle derives its
 * webpack-dev-server port by incrementing PORT, so that pair is adjacent
 * whether we like it or not.
 */
export const HARNESS_OFFSETS = {
  /** Mock Plone REST API (`inka-mock-api`). */
  mockApi: 0,
  /** Test frontend, which also serves mock-parent.html. */
  testFrontend: 1,
  /** Mock-parent test surface for bridge isolation tests. */
  mockParent: 2,
  /** Volto admin SSR server. */
  voltoSsr: 3,
  /** Razzle webpack-dev-server (auto-incremented from voltoSsr). */
  voltoWebpack: 4,
} as const;

export type HarnessPortName = keyof typeof HARNESS_OFFSETS;

const integer = (envName: string, raw: string): number => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${envName}: ${raw} (must be a positive integer)`);
  }
  return n;
};

/** `reactDoc` -> `HYDRA_REACT_DOC_PORT`. */
export const portEnvName = (name: string): string =>
  `HYDRA_${name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}_PORT`;

const portOf = (name: string, offset: number): number => {
  const envName = portEnvName(name);
  const explicit = process.env[envName];
  if (explicit) return integer(envName, explicit);

  const base = process.env[BASE];
  if (!base) {
    throw new Error(
      `Neither ${BASE} nor ${envName} is set. Test ports have no defaults — ` +
        `binding hydra's historical numbers is what lets one checkout take ` +
        `over another's servers.\n` +
        `  Set the block once:     ${BASE}=8980\n` +
        `  One service elsewhere:  ${envName}=<port> overrides just that one`,
    );
  }
  return integer(BASE, base) + offset;
};

export interface PortBlock<Name extends string> {
  /** Every port in the block, by name. */
  PORTS: Readonly<Record<Name, number>>;
  /** `http://localhost:N` for every port, by name. */
  URLS: Readonly<Record<Name, string>>;
  /** Every variable the block reads, so a launcher can export the whole block. */
  PORT_ENV: Readonly<Record<Name, string>>;
  /** Every port in the block, by name, computed now. Used by launchers. */
  allPorts: () => Record<Name, number>;
}

/**
 * The harness's servers plus a suite's own, as one block.
 *
 * `extra` gives each of the suite's servers an offset above the harness's
 * (5 and up). The block is computed when this is called, so it throws then if
 * nothing says where the block starts.
 */
export function definePorts<Extra extends Record<string, number>>(
  extra: Extra,
): PortBlock<HarnessPortName | Extract<keyof Extra, string>> {
  type Name = HarnessPortName | Extract<keyof Extra, string>;
  const offsets: Record<string, number> = { ...HARNESS_OFFSETS };
  for (const [name, offset] of Object.entries(extra)) {
    if (name in HARNESS_OFFSETS) {
      throw new Error(`Port "${name}" is the harness's own; give your server another name`);
    }
    const taken = Object.entries(offsets).find(([, o]) => o === offset);
    if (taken) {
      throw new Error(`Ports "${name}" and "${taken[0]}" both have offset ${offset}`);
    }
    offsets[name] = offset;
  }
  const names = Object.keys(offsets) as Name[];
  const allPorts = () =>
    Object.fromEntries(names.map((n) => [n, portOf(n, offsets[n])])) as Record<Name, number>;
  const PORTS = allPorts();
  const URLS = Object.fromEntries(
    names.map((n) => [n, `http://localhost:${PORTS[n]}`]),
  ) as Record<Name, string>;
  const PORT_ENV = Object.fromEntries(names.map((n) => [n, portEnvName(n)])) as Record<Name, string>;
  return { PORTS, URLS, PORT_ENV, allPorts };
}

/**
 * The harness's own servers, read from the environment when asked.
 *
 * The harness's helpers default to these (the admin, the mock API, the
 * mock-parent page), so a suite that runs its servers on the standard offsets
 * needs to pass nothing. Read lazily: importing a helper never throws, only
 * using an address nobody gave does.
 */
export function harnessUrls(): Readonly<Record<HarnessPortName, string>> {
  return definePorts({}).URLS;
}
