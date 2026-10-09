/**
 * The demo account a "try editing" link signs in with (/login?demo&return_url=…),
 * from RAZZLE_DEMO_LOGIN and RAZZLE_DEMO_PASSWORD. Read from Volto's
 * runtimeConfig, so a deployed editor needs no rebuild; both reach the browser,
 * so the account must be one whose saves the CMS throws away. Null when the
 * site configures none; half a configuration is an error.
 */
export function demoAccount(env) {
  const login = env.RAZZLE_DEMO_LOGIN;
  const password = env.RAZZLE_DEMO_PASSWORD;
  if (!login && !password) return null;
  if (!password) throw new Error('RAZZLE_DEMO_LOGIN is set without RAZZLE_DEMO_PASSWORD');
  if (!login) throw new Error('RAZZLE_DEMO_PASSWORD is set without RAZZLE_DEMO_LOGIN');
  return { login, password };
}
