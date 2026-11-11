/**
 * Error reporting for the hosted MCP server.
 *
 * A tool call that fails answers the client with an error, and that is the end
 * of it: nobody is watching this server's stdout, so a bug an agent hits --
 * the admin never answering, a page the pool lost, a field no schema declares
 * -- is only visible to whoever happened to be driving it. The admins report
 * to Sentry (volto-sentry) and so do the APIs; this is the same for the MCP.
 *
 * Configuration (environment), as the rest of the deployments spell it:
 *   SENTRY_DSN          where to send. UNSET MEANS OFF: nothing is started and
 *                       nothing is sent, which is what a local run and CI want.
 *   SENTRY_ENVIRONMENT  optional: which deployment this is, e.g. `inka-site`.
 *   SENTRY_RELEASE      optional: the commit, so an event names its code.
 *
 * The SDK is passed in rather than imported here: the bundle leaves
 * @sentry/node external (its instrumentation patches modules as they load, and
 * bundling it defeats that), the image installs it beside Playwright, and the
 * tests hand these functions a recorder instead.
 */

/**
 * What to start the SDK with, or null when no DSN says to start it at all.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{dsn: string, environment?: string, release?: string}|null}
 */
export function sentryOptions(env) {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return null;
  const options = { dsn };
  if (env.SENTRY_ENVIRONMENT) options.environment = env.SENTRY_ENVIRONMENT;
  if (env.SENTRY_RELEASE) options.release = env.SENTRY_RELEASE;
  return options;
}

/**
 * Start the SDK if the environment asks for it, and answer something that
 * reports a tool's error. With no DSN, `report` is a no-op and the SDK is
 * never started -- so an unconfigured server is exactly as it was.
 *
 * @param {Record<string, string|undefined>} env
 * @param {{init: Function, captureException: Function}} sdk - @sentry/node
 */
export function reporter(env, sdk) {
  const options = sentryOptions(env);
  if (!options) return { reporting: false, report() {} };
  sdk.init(options);
  return {
    reporting: true,
    /**
     * @param {string} tool - the tool whose call failed; the event is tagged
     *   with it, so Sentry groups by the tool an agent was using.
     * @param {unknown} error
     */
    report(tool, error) {
      sdk.captureException(error, { tags: { tool } });
    },
  };
}

/**
 * Report what the server's tools throw, by wrapping registerTool: every tool
 * registered after this is covered, including the ones a deployment adds, and
 * the error still reaches the client unchanged. Reporting is the only thing
 * added -- the name, the config and the answer are passed straight through.
 *
 * @param {{registerTool: Function}} server
 * @param {{report: Function}} reporting - from `reporter`
 */
export function reportTheseTools(server, reporting) {
  const register = server.registerTool.bind(server);
  server.registerTool = (name, config, handler) =>
    register(name, config, async (...args) => {
      try {
        return await handler(...args);
      } catch (error) {
        reporting.report(name, error);
        throw error;
      }
    });
  return server;
}
