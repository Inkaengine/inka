/**
 * Read a port, or a whole origin, from the environment — and fail without one.
 *
 * `ports.ts` is the rule ("THERE ARE NO DEFAULTS. Every port must be given as
 * HYDRA_<NAME>_PORT, and a missing one is a hard failure"), but it is TypeScript
 * and these fixture servers are CommonJS, so they cannot import it. They each
 * grew their own `process.env.PORT || 8888` instead, which is the same rule
 * with the one part that matters removed.
 *
 * A default is worse than a wrong value because it works. The server comes up
 * on 8888, the suite that was told to use another port talks to nothing, and
 * the only symptom is a connection refused somewhere else entirely. The
 * historical numbers are shared with every other hydra checkout on the machine,
 * so the failure is occasionally much stranger than that: two checkouts, one
 * server, whichever started first.
 *
 * So: no fallback argument, by construction. There is nowhere to put one.
 */

/** @param {string} name e.g. 'HYDRA_MOCK_API_PORT' */
function requiredPort(name) {
  const raw = process.env[name];
  if (!raw) {
    throw new Error(
      `${name} is not set. Test ports have no defaults — binding hydra's ` +
        `historical numbers is what lets one checkout take over another's ` +
        `servers.\n` +
        `  From a consuming repo:  make hydra-test ARGS="<spec> --project=admin-mock"\n` +
        `  In this repo:           the package.json scripts and CI set them`,
    );
  }
  const port = Number(raw);
  // 0 is a real answer: it asks the OS for a free port. A test that only needs
  // A server wants exactly that, and saying so is the opposite of the problem
  // here — it is how you DON'T take a number another checkout is using. (The
  // `|| 8888` this replaced treated '0' as absent, so a test asking for an
  // ephemeral port got the shared historical one instead.)
  if (!Number.isInteger(port) || port < 0) {
    throw new Error(
      `Invalid ${name}: ${raw} (must be a port, or 0 to let the OS choose)`,
    );
  }
  return port;
}

/**
 * `http://localhost:<port>` for a service named by its port variable.
 *
 * Here rather than in each caller so that "which host do the fixtures use"
 * stays one answer: localhost and 127.0.0.1 are different origins to a browser
 * (and resolve differently on a dual-stack machine), and mixing them is its own
 * afternoon.
 */
function requiredOrigin(name) {
  return `http://localhost:${requiredPort(name)}`;
}

module.exports = { requiredPort, requiredOrigin };
