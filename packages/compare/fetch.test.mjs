/**
 * A request the compare makes over the network, retried on a NETWORK failure
 * only, then failed loudly with a named error a run can blame on one page.
 *
 *   node --test packages/compare/fetch.test.mjs
 */

import assert from "node:assert/strict";
import test from "node:test";

import { fetchRetrying, Unreachable } from "./fetch.mjs";

const networkError = (code) => Object.assign(new TypeError("fetch failed"), { cause: { code } });
const scripted = (...steps) => {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const step = steps.shift();
    if (step instanceof Error) throw step;
    return step;
  };
  return { fn, calls };
};

test("a connection that times out is tried again, and its answer used", async () => {
  // The 19 Oct full run ended 373 pages in: one HEAD to the source timed out
  // connecting (UND_ERR_CONNECT_TIMEOUT) and took the whole run with it.
  const ok = { status: 200 };
  const { fn, calls } = scripted(networkError("UND_ERR_CONNECT_TIMEOUT"), ok);
  assert.equal(await fetchRetrying("https://x/a", {}, { fetch: fn, wait: 0 }), ok);
  assert.equal(calls.length, 2);
});

test("three network failures are Unreachable, naming the URL and the cause", async () => {
  const { fn, calls } = scripted(networkError("ECONNRESET"), networkError("ECONNRESET"), networkError("ECONNRESET"));
  await assert.rejects(fetchRetrying("https://x/a", {}, { fetch: fn, wait: 0 }), (e) => {
    assert.ok(e instanceof Unreachable);
    assert.match(e.message, /https:\/\/x\/a did not answer after 3 tries: ECONNRESET/);
    return true;
  });
  assert.equal(calls.length, 3);
});

test("a request that runs out of time is a network failure too", async () => {
  const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  const { fn } = scripted(timeout, { status: 204 });
  assert.equal((await fetchRetrying("https://x/a", {}, { fetch: fn, wait: 0 })).status, 204);
});

test("an HTTP error is an answer, returned as it is", async () => {
  const { fn, calls } = scripted({ status: 503 });
  assert.equal((await fetchRetrying("https://x/a", {}, { fetch: fn, wait: 0 })).status, 503);
  assert.equal(calls.length, 1);
});

test("anything else is a bug, thrown at once", async () => {
  const { fn, calls } = scripted(new RangeError("bad init"));
  await assert.rejects(fetchRetrying("https://x/a", {}, { fetch: fn, wait: 0 }), RangeError);
  assert.equal(calls.length, 1);
});
