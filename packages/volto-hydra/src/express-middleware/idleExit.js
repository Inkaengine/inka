/**
 * An admin started for tests stops itself once nothing has used it for a
 * while.
 *
 * Test admins are started and then forgotten: they outlive the session that
 * started them by days, each holding its memory all that time. With
 * INKA_ADMIN_IDLE_EXIT_MINUTES set (the test scripts set it; a deployment does
 * not), the server exits when no request has reached it for that long, and
 * the next test run starts it again.
 *
 * Every page and every API call (/++api++) passes through here; the build's
 * static assets are served before any middleware, so a browser left open on a
 * page that only holds its scripts does not keep it alive.
 */
const CHECK_EVERY_MS = 60_000;

/** The idle time asked for, in minutes, or null when it was not asked for. */
export function idleExitMinutes(env) {
  const raw = env.INKA_ADMIN_IDLE_EXIT_MINUTES;
  if (raw === undefined || raw === '') return null;
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes < 1) {
    throw new Error(`INKA_ADMIN_IDLE_EXIT_MINUTES must be a whole number of minutes (1 or more), not ${JSON.stringify(raw)}`);
  }
  return minutes;
}

export function idleExit({
  minutes,
  // The dev server is razzle's child, and razzle (its webpack) holds the
  // memory: stopping only the server would leave razzle up, and razzle would
  // start the server again on the next change.
  stopParent,
  parent = process.ppid,
  kill = (pid, signal) => process.kill(pid, signal),
  exitProcess = () => process.exit(0),
  now = Date.now,
  every = (fn) => setInterval(fn, CHECK_EVERY_MS).unref(),
}) {
  if (typeof stopParent !== 'boolean') {
    throw new TypeError('idleExit: stopParent, whether this is the dev server (razzle\'s child)');
  }
  let last = now();
  every(() => {
    if (now() - last < minutes * 60_000) return;
    console.log(`[inka] no request for ${minutes} minutes: stopping (INKA_ADMIN_IDLE_EXIT_MINUTES)`);
    if (stopParent) kill(parent, 'SIGTERM');
    exitProcess();
  });
  function middleware(req, res, next) {
    last = now();
    next();
  }
  middleware.id = 'inka-idle-exit';
  return middleware;
}
