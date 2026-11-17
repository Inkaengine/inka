/**
 * A request the compare makes over the network: retried on a NETWORK failure,
 * then failed loudly.
 *
 * An API that auto-suspends times out a connection made while it wakes; a
 * source site, once in a long run, does not answer a connection in time (one
 * HEAD at page 373 once ended a whole run). Three tries, 2s then 4s
 * apart. A network error is not an answer, so after the third it throws
 * Unreachable, naming the URL — which a run can blame on the one page that
 * asked. An HTTP error IS an answer and is returned for the caller to judge;
 * any other error is a bug and is thrown at once.
 */

export class Unreachable extends Error {
  name = "Unreachable";
}

// undici's "fetch failed" (connect timeout, reset, DNS) and the AbortSignal
// timeout: the two ways a request fails without an answer.
const isNetworkFailure = (e) =>
  (e instanceof TypeError && e.message === "fetch failed") ||
  (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError"));

export async function fetchRetrying(url, init, { fetch: fetchFn = fetch, tries = 3, wait = 2_000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fetchFn(url, { signal: AbortSignal.timeout(30_000), ...init });
    } catch (e) {
      if (!isNetworkFailure(e)) throw e;
      lastError = e;
      if (attempt < tries) await new Promise((r) => setTimeout(r, wait * attempt));
    }
  }
  throw new Unreachable(`${url} did not answer after ${tries} tries: ${lastError.cause?.code || lastError.message}`);
}
