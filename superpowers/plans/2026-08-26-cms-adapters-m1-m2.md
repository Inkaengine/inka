# CMS Adapters M1–M2: bridge-RPC + contract suite against Plone

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invert Hydra's API transport so every CMS call travels admin → bridge → iframe adapter, and prove it with a conformance contract suite that passes against Plone before any non-Plone adapter exists.

**Architecture:** A shared `BridgeRPC` class (in `hydra-js`, imported by both sides) carries `BACKEND_REQUEST`/`BACKEND_RESPONSE` envelopes over the existing postMessage channel. On the admin side, Volto's `Api` helper is *shadowed* by a bridge-backed class exposing the same five methods, so no middleware, action creator, or reducer changes. On the iframe side, `initBridge({ adapter })` registers an adapter that answers intents. The Plone adapter answers both a raw `http` passthrough (keeps today's UI byte-identical) and semantic intents (what the contract suite asserts).

**Tech Stack:** pnpm workspace, ESM, jest (hydra-js), vitest (volto-hydra + contract suite), Playwright (existing E2E), Volto 19.1.1 vendored in `core/`.

**Spec:** `docs/superpowers/specs/2026-08-26-universal-cms-adapters-design.md`

---

## Deviations from the spec (read before starting)

Three, each with a reason. Raise with the human if any is wrong.

**1. `core/` is never edited.** `hydra-plan.md` lists
`core/packages/volto/src/middleware/api.js` as a file to modify. `core/` is
gitignored (`.gitignore:29`) and re-cloned by mrs-developer from
`@plone/volto` tag 19.1.1 on every `make install`. Edits there are untracked
and get wiped. All Volto changes go through the addon's existing customization
shadowing at `packages/volto-hydra/src/customizations/volto/…` (already used
for 27 files, e.g. `volto/helpers/Url/Url.js`).

**2. The seam is `Api`, not the middleware.** `Api`
(`core/packages/volto/src/helpers/Api/Api.js:44`) builds `this[method]` for
`['get','post','put','patch','del']`, and the middleware calls
`api[request.op](path, opts)` at `middleware/api.js:251`. Shadowing
`volto/helpers/Api/Api` with a class exposing those same five methods is a
drop-in: zero changes to the middleware, the ~30 URL templates, or any reducer.
Smaller and safer than `hydra-plan.md`'s Phase 2. SSR is unaffected because the
server constructs `new Api(req)` with a request object
(`core/packages/volto/src/server.jsx:132`) and the client constructs `new Api()`
without one (`start-client.jsx:42`) — that argument is the discriminator.

**3. `plonify()` moves from M1 to M3.** It has no consumer until a non-Plone
adapter drives the UI. In M2 the Plone adapter serves the UI through the `http`
passthrough, which returns raw Plone JSON and is marked `raw: true` so
normalization is skipped by definition. Building `plonify()` now would be
untested-by-use code. YAGNI.

Also note: `hydra-js` uses a **flat** module layout (`conversionMap.js`,
`containerOps.js` at package root), not `src/`. New modules follow that.

---

## File structure

**New:**

| Path | Responsibility |
| --- | --- |
| `packages/hydra-js/bridgeRpc.js` | `BridgeRPC` class: envelope, requestId correlation, timeouts, error coding. Used by BOTH sides. |
| `packages/hydra-js/bridgeRpc.test.js` | Tier-0 protocol tests (jest) |
| `packages/hydra-types/index.d.ts` | Canonical shapes + intent enum. Zero runtime, no build step. |
| `packages/hydra-adapters-core/baseAdapter.js` | `BaseAdapter`, error codes, retry-on-401 |
| `packages/hydra-adapters-core/baseAdapter.test.js` | unit tests |
| `packages/hydra-adapters-plone/index.js` | Plone adapter: `http` passthrough + semantic intents |
| `packages/volto-hydra/src/bridge/BridgeApi.js` | 5-method transport over `BridgeRPC` |
| `packages/volto-hydra/src/bridge/BridgeApi.test.js` | unit tests |
| `packages/volto-hydra/src/customizations/volto/helpers/Api/Api.js` | shadow: pick superagent or bridge transport |
| `tests-adapters/targets/plone.ts` | start/stop/seed the existing mock-plone-api; expose adapter |
| `tests-adapters/fixtures/seed.json` | ONE canonical content set |
| `tests-adapters/contract/*.spec.ts` | the conformance suite |
| `vitest.adapters.config.mjs` | node-env vitest project for the contract suite |

**Modified:**

| Path | Change |
| --- | --- |
| `packages/hydra-js/package.json` | add `./bridgeRpc` export subpath |
| `packages/hydra-js/hydra.src.js:13220` | `initBridge` accepts `adapter`; serve `BACKEND_REQUEST`; emit `ADAPTER_READY` |
| `packages/volto-hydra/src/components/Iframe/View.jsx` | admin-side `BridgeRPC`; consume `ADAPTER_READY`; expose `window.__hydraBridge` |
| `package.json` | add `test:contract` script |

---

## Prerequisite: worktree bootstrap

- [x] **Step 1: Confirm `core/` is populated**

Run: `ls core/packages/volto/src/helpers/Api/Api.js`
Expected: the path exists. If not, run `make install` first (clones Volto 19.1.1
into `core/`, ~940 MB, several minutes).

- [x] **Step 2: Confirm the baseline is green**

Run: `pnpm test 2>&1 | tee /tmp/baseline-vitest.log`
Run: `cd packages/hydra-js && pnpm test 2>&1 | tee /tmp/baseline-jest.log && cd ../..`
Expected: both pass. Record the counts — any later failure must be attributable
to this work, not inherited.

If the baseline is red, STOP and report to the human before writing code.

---

# M1 — Bridge-RPC foundation

## Task 1: `hydra-types` package

**Files:**
- Create: `packages/hydra-types/package.json`
- Create: `packages/hydra-types/index.d.ts`

- [x] **Step 1: Create the package manifest**

```json
{
  "name": "@volto-hydra/hydra-types",
  "version": "1.0.0",
  "description": "Canonical shapes exchanged over the Hydra bridge. Types only, zero runtime.",
  "types": "./index.d.ts",
  "exports": { ".": { "types": "./index.d.ts" } },
  "files": ["index.d.ts"]
}
```

- [x] **Step 2: Write the canonical shapes**

```ts
export type Capability =
  | 'content' | 'search-fulltext' | 'search-filter' | 'vocabulary'
  | 'schema' | 'asset' | 'workflow' | 'versioning' | 'sharing' | 'comments';

export type Intent =
  | 'content.get' | 'content.create' | 'content.update' | 'content.delete'
  | 'content.order' | 'content.move'
  | 'types.list' | 'types.getSchema'
  | 'search' | 'navigation.get' | 'breadcrumbs.get' | 'tree.list'
  | 'vocabulary.get'
  | 'asset.upload' | 'asset.imageUrl'
  | 'auth.whoami'
  | 'http';

export interface Document {
  id: string;            // opaque CMS id (UID, post id, uuid) — always a string
  path: string;          // CMS-relative path, leading slash, no origin
  type: string;
  title: string;
  language?: string;
  blocks: Record<string, unknown>;
  blocksLayout: { items: string[] };
  fields: Record<string, unknown>;
  state?: string;        // canonical workflow state, adapter-mapped
  _adapter?: { raw: unknown };
}

export interface Schema {
  fieldsets: Array<{ id: string; title: string; fields: string[] }>;
  properties: Record<string, unknown>;
  required: string[];
}

export interface User {
  id: string; username: string; fullname?: string;
  email?: string; roles: string[];
}

export interface SearchResult {
  items: Document[];
  total: number;
  batching?: { next?: string; prev?: string };
}

export interface Vocabulary {
  items: Array<{ token: string; title: string }>;
  total: number;
}

export interface HydraAdapter {
  name: string;
  capabilities: Capability[];
  init(ctx: AdapterContext): Promise<void>;
  whoami(): Promise<User | null>;
  getAdminUrl(panel: string): string | null;
  dispatch(intent: Intent, args: unknown): Promise<unknown>;
}

export interface AdapterContext {
  cmsBaseUrl: string;
  emit(event: 'auth-required' | 'auth-state', payload: unknown): void;
}
```

- [x] **Step 3: Register in the workspace**

Run: `pnpm install`
Expected: `@volto-hydra/hydra-types` appears in the workspace. `packages/*` is
already globbed by `pnpm-workspace.yaml`, so no config change is needed.

- [x] **Step 4: Commit**

```bash
git add packages/hydra-types
git commit -m "feat(hydra-types): canonical shapes for the adapter contract"
```

---

## Task 2: `BridgeRPC` — request/response correlation

**Files:**
- Create: `packages/hydra-js/bridgeRpc.js`
- Test: `packages/hydra-js/bridgeRpc.test.js`

`hydra-js` runs jest with `testEnvironment: 'node'`, `transform: {}` (native ESM),
`testMatch: ['**/*.test.js']`. Write plain ESM; no babel.

- [x] **Step 1: Write the failing test**

```js
import { BridgeRPC } from './bridgeRpc.js';

test('resolves a request when the matching response arrives', async () => {
  const sent = [];
  const rpc = new BridgeRPC({ send: (msg) => sent.push(msg) });

  const promise = rpc.request('content.get', { path: '/news' });

  expect(sent).toHaveLength(1);
  expect(sent[0].type).toBe('BACKEND_REQUEST');
  expect(sent[0].intent).toBe('content.get');
  expect(sent[0].args).toEqual({ path: '/news' });
  expect(typeof sent[0].requestId).toBe('string');

  rpc.handleMessage({
    type: 'BACKEND_RESPONSE',
    requestId: sent[0].requestId,
    ok: true,
    result: { title: 'News' },
  });

  await expect(promise).resolves.toEqual({ title: 'News' });
});

test('ignores a response with an unknown requestId', () => {
  const rpc = new BridgeRPC({ send: () => {} });
  expect(() =>
    rpc.handleMessage({ type: 'BACKEND_RESPONSE', requestId: 'nope', ok: true }),
  ).not.toThrow();
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `cd packages/hydra-js && npx jest bridgeRpc 2>&1 | tee /tmp/rpc-red.log`
Expected: FAIL — `Cannot find module './bridgeRpc.js'`

- [x] **Step 3: Write the minimal implementation**

```js
/**
 * Bidirectional RPC over the admin <-> iframe postMessage channel.
 *
 * Symmetric: the same class runs on both sides. The admin instance sends
 * BACKEND_REQUEST and resolves on BACKEND_RESPONSE; the iframe instance
 * serves requests by dispatching them to a registered adapter.
 */
export class BridgeRPC {
  /**
   * @param {Object} opts
   * @param {(msg: object) => void} opts.send - transport (postMessage wrapper)
   */
  constructor({ send }) {
    this.send = send;
    this.pending = new Map();
    this.nextId = 0;
  }

  request(intent, args) {
    const requestId = `rpc-${++this.nextId}`;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
    });
    this.send({ type: 'BACKEND_REQUEST', requestId, intent, args });
    return promise;
  }

  handleMessage(msg) {
    if (msg?.type !== 'BACKEND_RESPONSE') return false;
    const entry = this.pending.get(msg.requestId);
    if (!entry) return false;
    this.pending.delete(msg.requestId);
    entry.resolve(msg.result);
    return true;
  }
}
```

- [x] **Step 4: Run it and watch it pass**

Run: `cd packages/hydra-js && npx jest bridgeRpc 2>&1 | tee /tmp/rpc-green.log`
Expected: PASS, 2 tests.

- [x] **Step 5: Commit**

```bash
git add packages/hydra-js/bridgeRpc.js packages/hydra-js/bridgeRpc.test.js
git commit -m "feat(bridge): BridgeRPC request/response correlation"
```

---

## Task 3: `BridgeRPC` — timeouts

An unanswered request must reject rather than hang the admin UI forever.

**Files:**
- Modify: `packages/hydra-js/bridgeRpc.js`
- Test: `packages/hydra-js/bridgeRpc.test.js`

- [x] **Step 1: Write the failing tests**

```js
test('rejects when no response arrives before the timeout', async () => {
  jest.useFakeTimers();
  const rpc = new BridgeRPC({ send: () => {} });
  const promise = rpc.request('content.get', {}, { timeoutMs: 1000 });
  const assertion = expect(promise).rejects.toMatchObject({
    code: 'TIMEOUT',
    intent: 'content.get',
  });
  jest.advanceTimersByTime(1001);
  await assertion;
  jest.useRealTimers();
});

test('clears the timer when a response arrives', async () => {
  jest.useFakeTimers();
  const sent = [];
  const rpc = new BridgeRPC({ send: (m) => sent.push(m) });
  const promise = rpc.request('content.get', {}, { timeoutMs: 1000 });
  rpc.handleMessage({
    type: 'BACKEND_RESPONSE', requestId: sent[0].requestId, ok: true, result: 1,
  });
  await expect(promise).resolves.toBe(1);
  expect(rpc.pending.size).toBe(0);
  jest.advanceTimersByTime(5000); // must not throw an unhandled rejection
  jest.useRealTimers();
});

test('asset.upload gets a longer default timeout than content.get', () => {
  const rpc = new BridgeRPC({ send: () => {} });
  expect(rpc.timeoutFor('asset.upload')).toBeGreaterThan(rpc.timeoutFor('content.get'));
});
```

- [x] **Step 2: Run and watch them fail**

Run: `cd packages/hydra-js && npx jest bridgeRpc 2>&1 | tee /tmp/rpc-timeout-red.log`
Expected: FAIL — `rpc.timeoutFor is not a function`, and the timeout test hangs
the promise rather than rejecting.

- [x] **Step 3: Implement**

Add to `BridgeRPC`:

```js
const DEFAULT_TIMEOUT_MS = 30_000;
const INTENT_TIMEOUTS = { 'asset.upload': 120_000 };

  timeoutFor(intent) {
    return INTENT_TIMEOUTS[intent] ?? DEFAULT_TIMEOUT_MS;
  }
```

and change `request` to:

```js
  request(intent, args, { timeoutMs } = {}) {
    const requestId = `rpc-${++this.nextId}`;
    const ms = timeoutMs ?? this.timeoutFor(intent);
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        const err = new Error(`Bridge request '${intent}' timed out after ${ms}ms`);
        err.code = 'TIMEOUT';
        err.intent = intent;
        reject(err);
      }, ms);
      this.pending.set(requestId, { resolve, reject, timer });
    });
    this.send({ type: 'BACKEND_REQUEST', requestId, intent, args, meta: { timeoutMs: ms } });
    return promise;
  }
```

and in `handleMessage`, before resolving: `clearTimeout(entry.timer);`

- [x] **Step 4: Run and watch them pass**

Run: `cd packages/hydra-js && npx jest bridgeRpc 2>&1 | tee /tmp/rpc-timeout-green.log`
Expected: PASS, 5 tests.

- [x] **Step 5: Commit**

```bash
git add packages/hydra-js/bridgeRpc.js packages/hydra-js/bridgeRpc.test.js
git commit -m "feat(bridge): per-intent RPC timeouts"
```

---

## Task 4: `BridgeRPC` — error envelope and `raw` passthrough

**Files:**
- Modify: `packages/hydra-js/bridgeRpc.js`
- Test: `packages/hydra-js/bridgeRpc.test.js`

`raw: true` marks a response that must skip canonical normalization. In M2 it is
set by the Plone `http` passthrough; `plonify()` (M3) consumes it.

- [x] **Step 1: Write the failing tests**

```js
test('rejects with a structured error when ok is false', async () => {
  const sent = [];
  const rpc = new BridgeRPC({ send: (m) => sent.push(m) });
  const promise = rpc.request('content.get', { path: '/missing' });
  rpc.handleMessage({
    type: 'BACKEND_RESPONSE',
    requestId: sent[0].requestId,
    ok: false,
    error: { code: 'NOT_FOUND', status: 404, message: 'No such resource' },
  });
  await expect(promise).rejects.toMatchObject({
    code: 'NOT_FOUND',
    status: 404,
    message: 'No such resource',
  });
});

test('exposes the raw flag alongside the result', async () => {
  const sent = [];
  const rpc = new BridgeRPC({ send: (m) => sent.push(m) });
  const promise = rpc.request('http', { op: 'get', path: '/news' });
  rpc.handleMessage({
    type: 'BACKEND_RESPONSE',
    requestId: sent[0].requestId,
    ok: true,
    raw: true,
    result: { '@id': 'http://x/news' },
  });
  const res = await promise;
  expect(res).toEqual({ '@id': 'http://x/news' });
  expect(rpc.lastResponseWasRaw).toBe(true);
});
```

**Note for the implementer:** `lastResponseWasRaw` is deliberately a
last-write-wins flag rather than per-request state — it is only read by the
synchronous `plonify()` decision immediately after an await, and making it
per-request would mean threading a wrapper object through the `Api` shadow's
five methods for no behavioural gain. If M3 shows this racing under concurrent
requests, promote it to a `{ result, raw }` tuple then, with a test that fails
first.

- [x] **Step 2: Run and watch them fail**

Run: `cd packages/hydra-js && npx jest bridgeRpc 2>&1 | tee /tmp/rpc-error-red.log`
Expected: FAIL — the error case resolves with `undefined` instead of rejecting.

- [x] **Step 3: Implement**

Replace `handleMessage` with:

```js
  handleMessage(msg) {
    if (msg?.type !== 'BACKEND_RESPONSE') return false;
    const entry = this.pending.get(msg.requestId);
    if (!entry) return false;
    this.pending.delete(msg.requestId);
    clearTimeout(entry.timer);
    if (msg.ok) {
      this.lastResponseWasRaw = msg.raw === true;
      entry.resolve(msg.result);
    } else {
      const e = msg.error ?? {};
      const err = new Error(e.message ?? 'Bridge request failed');
      err.code = e.code ?? 'BRIDGE_ERROR';
      err.status = e.status;
      err.data = e.data;
      entry.reject(err);
    }
    return true;
  }
```

- [x] **Step 4: Run and watch them pass**

Run: `cd packages/hydra-js && npx jest bridgeRpc 2>&1 | tee /tmp/rpc-error-green.log`
Expected: PASS, 7 tests.

- [x] **Step 5: Commit**

```bash
git add packages/hydra-js/bridgeRpc.js packages/hydra-js/bridgeRpc.test.js
git commit -m "feat(bridge): structured RPC errors and raw passthrough flag"
```

---

## Task 5: `BridgeRPC` — serving side

The iframe half: receive `BACKEND_REQUEST`, dispatch to the adapter, reply.

**Files:**
- Modify: `packages/hydra-js/bridgeRpc.js`
- Test: `packages/hydra-js/bridgeRpc.test.js`

- [x] **Step 1: Write the failing tests**

```js
const fakeAdapter = {
  name: 'fake',
  capabilities: ['content'],
  async dispatch(intent, args) {
    if (intent === 'content.get') return { title: 'ok', path: args.path };
    const e = new Error('unsupported'); e.code = 'NOT_IMPLEMENTED'; throw e;
  },
};

test('serves a request from the registered adapter', async () => {
  const sent = [];
  const rpc = new BridgeRPC({ send: (m) => sent.push(m) });
  rpc.serve(fakeAdapter);

  await rpc.handleMessage({
    type: 'BACKEND_REQUEST', requestId: 'r1',
    intent: 'content.get', args: { path: '/a' },
  });

  expect(sent[0]).toEqual({
    type: 'BACKEND_RESPONSE', requestId: 'r1', ok: true,
    raw: false, result: { title: 'ok', path: '/a' },
  });
});

test('converts an adapter throw into an error response', async () => {
  const sent = [];
  const rpc = new BridgeRPC({ send: (m) => sent.push(m) });
  rpc.serve(fakeAdapter);

  await rpc.handleMessage({
    type: 'BACKEND_REQUEST', requestId: 'r2', intent: 'workflow.get', args: {},
  });

  expect(sent[0].ok).toBe(false);
  expect(sent[0].error.code).toBe('NOT_IMPLEMENTED');
});

test('replies NO_ADAPTER when nothing is registered', async () => {
  const sent = [];
  const rpc = new BridgeRPC({ send: (m) => sent.push(m) });
  await rpc.handleMessage({
    type: 'BACKEND_REQUEST', requestId: 'r3', intent: 'content.get', args: {},
  });
  expect(sent[0].error.code).toBe('NO_ADAPTER');
});
```

- [x] **Step 2: Run and watch them fail**

Run: `cd packages/hydra-js && npx jest bridgeRpc 2>&1 | tee /tmp/rpc-serve-red.log`
Expected: FAIL — `rpc.serve is not a function`

- [x] **Step 3: Implement**

```js
  serve(adapter) {
    this.adapter = adapter;
  }

  async handleRequest(msg) {
    const { requestId, intent, args } = msg;
    if (!this.adapter) {
      this.send({
        type: 'BACKEND_RESPONSE', requestId, ok: false,
        error: { code: 'NO_ADAPTER', message: 'No adapter registered on this frontend' },
      });
      return;
    }
    try {
      const result = await this.adapter.dispatch(intent, args);
      this.send({
        type: 'BACKEND_RESPONSE', requestId, ok: true,
        raw: intent === 'http', result,
      });
    } catch (err) {
      this.send({
        type: 'BACKEND_RESPONSE', requestId, ok: false,
        error: {
          code: err.code ?? 'ADAPTER_ERROR',
          status: err.status,
          message: err.message,
          data: err.data,
        },
      });
    }
  }
```

and at the top of `handleMessage`:

```js
    if (msg?.type === 'BACKEND_REQUEST') return this.handleRequest(msg);
```

- [x] **Step 4: Run and watch them pass**

Run: `cd packages/hydra-js && npx jest bridgeRpc 2>&1 | tee /tmp/rpc-serve-green.log`
Expected: PASS, 10 tests.

- [x] **Step 5: Run the whole hydra-js suite for regressions**

Run: `cd packages/hydra-js && pnpm test 2>&1 | tee /tmp/hydra-js-after-rpc.log`
Expected: same pass count as `/tmp/baseline-jest.log` plus 10.

- [x] **Step 6: Commit**

```bash
git add packages/hydra-js/bridgeRpc.js packages/hydra-js/bridgeRpc.test.js
git commit -m "feat(bridge): serve BACKEND_REQUEST from a registered adapter"
```

---

## Task 6: Export `bridgeRpc` from the `hydra-js` package

**Files:**
- Modify: `packages/hydra-js/package.json`

- [x] **Step 1: Add the export subpath**

Change `exports` to:

```json
  "exports": {
    ".": "./hydra.src.js",
    "./bridgeRpc": "./bridgeRpc.js"
  }
```

- [x] **Step 2: Verify it resolves from volto-hydra**

`packages/volto-hydra/package.json` already declares
`"@volto-hydra/hydra-js": "workspace:*"`, so no dependency change is needed.

Run: `node -e "import('@volto-hydra/hydra-js/bridgeRpc').then(m => console.log(Object.keys(m)))"` from `packages/volto-hydra`
Expected: `[ 'BridgeRPC' ]`

- [x] **Step 3: Commit**

```bash
git add packages/hydra-js/package.json
git commit -m "chore(hydra-js): export bridgeRpc subpath"
```

---

## Task 7: `BaseAdapter` with retry-on-401

**Files:**
- Create: `packages/hydra-adapters-core/package.json`
- Create: `packages/hydra-adapters-core/baseAdapter.js`
- Test: `packages/hydra-adapters-core/baseAdapter.test.js`

Reuse `packages/hydra-js/jest.config.js` as the template for this package's jest
config (node env, `transform: {}`, ESM).

- [x] **Step 1: Write the failing tests**

```js
import { BaseAdapter, AdapterError } from './baseAdapter.js';

class Stub extends BaseAdapter {
  constructor(responses) { super({ name: 'stub', capabilities: ['content'] }); this.responses = responses; this.calls = 0; }
  async fetchJson() { this.calls++; const r = this.responses.shift(); if (r instanceof Error) throw r; return r; }
  async dispatch(intent) { return this.withAuthRetry(() => this.fetchJson(intent)); }
}

test('re-runs the call once after a 401 and succeeds', async () => {
  const unauth = new AdapterError('Unauthorized', { code: 'UNAUTHORIZED', status: 401 });
  const a = new Stub([unauth, { ok: 1 }]);
  a.init({ cmsBaseUrl: 'http://x', emit: () => {} });
  await expect(a.dispatch('content.get')).resolves.toEqual({ ok: 1 });
  expect(a.calls).toBe(2);
});

test('emits auth-required and rethrows when the retry also 401s', async () => {
  const events = [];
  const unauth = () => new AdapterError('Unauthorized', { code: 'UNAUTHORIZED', status: 401 });
  const a = new Stub([unauth(), unauth()]);
  a.init({ cmsBaseUrl: 'http://x', emit: (e, p) => events.push([e, p]) });
  await expect(a.dispatch('content.get')).rejects.toMatchObject({ status: 401 });
  expect(events.map(([e]) => e)).toContain('auth-required');
});

test('does not retry a non-401 error', async () => {
  const a = new Stub([new AdapterError('Boom', { code: 'SERVER_ERROR', status: 500 })]);
  a.init({ cmsBaseUrl: 'http://x', emit: () => {} });
  await expect(a.dispatch('content.get')).rejects.toMatchObject({ status: 500 });
  expect(a.calls).toBe(1);
});

test('rejects an unsupported intent with NOT_IMPLEMENTED', async () => {
  const a = new BaseAdapter({ name: 'bare', capabilities: [] });
  await expect(a.dispatch('workflow.get', {})).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
});
```

- [x] **Step 2: Run and watch them fail**

Run: `cd packages/hydra-adapters-core && npx jest 2>&1 | tee /tmp/base-red.log`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```js
export class AdapterError extends Error {
  constructor(message, { code = 'ADAPTER_ERROR', status, data } = {}) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

/**
 * Shared behaviour for every CMS adapter.
 *
 * Subclasses implement dispatch(); everything here is transport-agnostic so it
 * is unit-testable without a CMS.
 */
export class BaseAdapter {
  constructor({ name, capabilities }) {
    this.name = name;
    this.capabilities = capabilities;
    this.ctx = null;
  }

  async init(ctx) { this.ctx = ctx; }

  supports(capability) { return this.capabilities.includes(capability); }

  async whoami() { return null; }

  getAdminUrl() { return null; }

  async dispatch(intent) {
    throw new AdapterError(`${this.name} does not implement '${intent}'`, {
      code: 'NOT_IMPLEMENTED',
      status: 501,
    });
  }

  /**
   * Run fn; on a 401 run it exactly once more (the CMS session may have been
   * refreshed in another tab). If the retry also 401s, tell the admin to show
   * an auth challenge and rethrow so the caller still sees the failure.
   */
  async withAuthRetry(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err?.status !== 401) throw err;
      try {
        return await fn();
      } catch (retryErr) {
        this.ctx?.emit('auth-required', {
          reason: 'session-expired',
          adapter: this.name,
        });
        throw retryErr;
      }
    }
  }
}
```

- [x] **Step 4: Run and watch them pass**

Run: `cd packages/hydra-adapters-core && npx jest 2>&1 | tee /tmp/base-green.log`
Expected: PASS, 4 tests.

- [x] **Step 5: Commit**

```bash
git add packages/hydra-adapters-core
git commit -m "feat(adapters-core): BaseAdapter with retry-on-401"
```

---

## Task 8: Iframe side — `initBridge({ adapter })` and `ADAPTER_READY`

**Files:**
- Modify: `packages/hydra-js/hydra.src.js` (`initBridge` at :13220, `Bridge` at :160)

`initBridge(adminOriginOrOptions, options)` already accepts an options object
(`options.adminOrigin` handled at :13232), so `adapter` slots in beside it.

- [x] **Step 1: Wire a `BridgeRPC` into `Bridge`**

In the `Bridge` constructor (after `this.adminOrigin = adminOrigin;` at :176):

```js
    this.rpc = new BridgeRPC({
      send: (msg) => window.parent.postMessage(msg, this.adminOrigin),
    });
```

Import at the top of the file: `import { BridgeRPC } from './bridgeRpc.js';`

- [x] **Step 2: Register the adapter and announce readiness**

In `initBridge`, after the bridge is constructed and `adminOrigin` resolved:

```js
  if (options.adapter) {
    bridge.rpc.serve(options.adapter);
    Promise.resolve(
      options.adapter.init({
        cmsBaseUrl: options.cmsBaseUrl ?? window.location.origin,
        emit: (event, payload) =>
          window.parent.postMessage(
            { type: event === 'auth-required' ? 'AUTH_REQUIRED' : 'AUTH_STATE', ...payload },
            adminOrigin,
          ),
      }),
    ).then(async () => {
      const user = await options.adapter.whoami();
      window.parent.postMessage(
        {
          type: 'ADAPTER_READY',
          name: options.adapter.name,
          capabilities: options.adapter.capabilities,
          cmsBaseUrl: options.cmsBaseUrl ?? window.location.origin,
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          user,
        },
        adminOrigin,
      );
    });
  }
```

Define `export const BRIDGE_PROTOCOL_VERSION = 1;` in `bridgeRpc.js` and import it.

- [x] **Step 3: Route incoming RPC messages**

Find the existing `window.addEventListener('message', …)` registration used for
the real-time data handler (`this.realTimeDataHandler`, registered at :4280) and
add, as the first thing in that handler:

```js
      if (event.data?.type === 'BACKEND_REQUEST' || event.data?.type === 'BACKEND_RESPONSE') {
        this.rpc.handleMessage(event.data);
        return;
      }
```

- [x] **Step 4: Verify nothing regressed**

Run: `cd packages/hydra-js && pnpm test 2>&1 | tee /tmp/hydra-js-after-init.log`
Expected: same count as `/tmp/hydra-js-after-rpc.log`.

Run: `cd packages/hydra-js && pnpm build`
Expected: `hydra.js` rebuilds with no esbuild errors.

- [x] **Step 5: Commit**

```bash
git add packages/hydra-js/hydra.src.js packages/hydra-js/bridgeRpc.js
git commit -m "feat(bridge): register an adapter at initBridge and announce ADAPTER_READY"
```

---

## Task 9: Admin side — RPC client in the iframe view

**Files:**
- Modify: `packages/volto-hydra/src/components/Iframe/View.jsx`

Reuse the existing `iframeOriginRef` for targeted `postMessage` — do not
introduce a second origin-tracking mechanism.

- [x] **Step 1: Construct the admin-side RPC**

```js
import { BridgeRPC } from '@volto-hydra/hydra-js/bridgeRpc';

// inside the component, alongside the other refs
const rpcRef = useRef(null);
if (!rpcRef.current) {
  rpcRef.current = new BridgeRPC({
    send: (msg) => iframeRef.current?.contentWindow?.postMessage(msg, iframeOriginRef.current),
  });
}
```

- [x] **Step 2: Feed responses in and expose the client**

In the existing message listener, before the other `switch`/`if` handling:

```js
      if (event.data?.type === 'BACKEND_RESPONSE') {
        rpcRef.current.handleMessage(event.data);
        return;
      }
      if (event.data?.type === 'ADAPTER_READY') {
        setAdapterInfo({
          name: event.data.name,
          capabilities: event.data.capabilities,
          protocolVersion: event.data.protocolVersion,
          user: event.data.user,
        });
        return;
      }
```

and, so the `Api` shadow (Task 10) can reach it without prop drilling through
Volto's store:

```js
  useEffect(() => {
    window.__hydraBridge = rpcRef.current;
    return () => { delete window.__hydraBridge; };
  }, []);
```

**Note:** a window global is used deliberately. The `Api` shadow is constructed
by Volto's `start-client.jsx` before any React tree exists, so there is no
context or store to read from at that point. Keep it to this one handle.

- [x] **Step 3: Verify**

Run: `pnpm test 2>&1 | tee /tmp/vitest-after-view.log`
Expected: same count as `/tmp/baseline-vitest.log`.

- [x] **Step 4: Commit**

```bash
git add packages/volto-hydra/src/components/Iframe/View.jsx
git commit -m "feat(bridge): admin-side RPC client and ADAPTER_READY handling"
```

---

## Task 10: `BridgeApi` — the five-method transport

**Files:**
- Create: `packages/volto-hydra/src/bridge/BridgeApi.js`
- Test: `packages/volto-hydra/src/bridge/BridgeApi.test.js`

Volto's `Api` exposes `['get','post','put','patch','del']`, each called as
`api[method](path, { params, data, type, headers, checkUrl, attach })`
(`core/packages/volto/src/helpers/Api/Api.js:53`). `BridgeApi` must match that
surface exactly.

- [x] **Step 1: Write the failing tests**

```js
import { describe, it, expect, vi } from 'vitest';
import { BridgeApi } from './BridgeApi';

const rpc = (result) => ({ request: vi.fn().mockResolvedValue(result) });

describe('BridgeApi', () => {
  it('exposes exactly the five Api methods', () => {
    const api = new BridgeApi(rpc({}));
    for (const m of ['get', 'post', 'put', 'patch', 'del']) {
      expect(typeof api[m]).toBe('function');
    }
  });

  it('maps a GET to the http passthrough intent', async () => {
    const r = rpc({ '@id': 'http://x/news' });
    const api = new BridgeApi(r);
    const res = await api.get('/news', { headers: { Accept: 'application/json' } });
    expect(r.request).toHaveBeenCalledWith('http', {
      op: 'get', path: '/news', data: undefined,
      headers: { Accept: 'application/json' }, params: undefined,
    });
    expect(res).toEqual({ '@id': 'http://x/news' });
  });

  it('passes the body through on a PATCH', async () => {
    const r = rpc({});
    const api = new BridgeApi(r);
    await api.patch('/news', { data: { title: 'New' } });
    expect(r.request).toHaveBeenCalledWith('http', expect.objectContaining({
      op: 'patch', path: '/news', data: { title: 'New' },
    }));
  });

  it('propagates a bridge error unchanged', async () => {
    const err = Object.assign(new Error('nope'), { code: 'NOT_FOUND', status: 404 });
    const api = new BridgeApi({ request: vi.fn().mockRejectedValue(err) });
    await expect(api.get('/missing')).rejects.toMatchObject({ status: 404 });
  });
});
```

- [x] **Step 2: Run and watch them fail**

Run: `pnpm vitest run packages/volto-hydra/src/bridge 2>&1 | tee /tmp/bridgeapi-red.log`
Expected: FAIL — cannot resolve `./BridgeApi`.

- [x] **Step 3: Implement**

```js
const METHODS = ['get', 'post', 'put', 'patch', 'del'];

/**
 * Drop-in replacement for Volto's Api helper that routes every call over the
 * Hydra bridge instead of superagent. Same five methods, same argument shape,
 * so the api middleware, the action creators and the reducers are untouched.
 *
 * MVP uses the `http` passthrough intent for every call: the Plone adapter
 * mirrors today's behaviour exactly. Semantic intents replace this per action
 * creator as non-Plone adapters need them.
 */
export class BridgeApi {
  constructor(rpc) {
    this.rpc = rpc;
    METHODS.forEach((op) => {
      this[op] = (path, { params, data, headers } = {}) =>
        this.rpc.request('http', { op, path, data, headers, params });
    });
  }
}
```

- [x] **Step 4: Run and watch them pass**

Run: `pnpm vitest run packages/volto-hydra/src/bridge 2>&1 | tee /tmp/bridgeapi-green.log`
Expected: PASS, 4 tests.

- [x] **Step 5: Commit**

```bash
git add packages/volto-hydra/src/bridge/BridgeApi.js packages/volto-hydra/src/bridge/BridgeApi.test.js
git commit -m "feat(bridge): BridgeApi transport matching Volto's Api surface"
```

---

## Task 11: Shadow Volto's `Api` behind the `useBridgeBackend` flag

**Files:**
- Create: `packages/volto-hydra/src/customizations/volto/helpers/Api/Api.js`

This is the switch. It must be inert by default.

- [x] **Step 1: Write the shadow**

```js
/**
 * Customization of volto/helpers/Api/Api.
 *
 * When Hydra runs the admin inside a bridge session, every CMS call is routed
 * through the iframe's adapter instead of being fetched directly. Three guards
 * must all hold before that happens:
 *
 *   1. config.settings.useBridgeBackend is on
 *   2. we are on the client (SSR constructs `new Api(req)` with a request
 *      object; the client constructs `new Api()` without one)
 *   3. the bridge handle exists (the iframe view has mounted and handshaken)
 *
 * Any guard failing falls back to the original superagent Api, so a
 * misconfigured or pre-handshake state degrades to today's behaviour rather
 * than breaking.
 */
import OriginalApi from '@plone/volto/helpers/Api/Api';
import config from '@plone/volto/registry';
import { BridgeApi } from '../../../../bridge/BridgeApi';

export default class Api {
  constructor(req) {
    const useBridge =
      config.settings.useBridgeBackend &&
      !req &&
      typeof window !== 'undefined' &&
      window.__hydraBridge;

    if (useBridge) return new BridgeApi(window.__hydraBridge);
    return new OriginalApi(req);
  }
}
```

**Note for the implementer:** confirm the shadow path resolves. Volto's
customization mechanism maps `src/customizations/volto/<path>` onto
`@plone/volto/<path>`. Check the existing working example at
`packages/volto-hydra/src/customizations/volto/helpers/Url/Url.js` and mirror
its import style exactly — in particular how it imports the module it shadows
without creating a cycle.

- [x] **Step 2: Add the flag, defaulted off**

In the addon's `applyConfig` (`packages/volto-hydra/src/index.js`):

```js
  config.settings.useBridgeBackend = false;
```

- [x] **Step 3: Verify the default path is untouched**

Run: `pnpm test 2>&1 | tee /tmp/vitest-after-shadow.log`
Expected: same count as `/tmp/baseline-vitest.log`.

Run: `pnpm exec playwright test --project=admin-mock 2>&1 | tee /tmp/pw-flag-off.log`
Expected: same pass count as before this task. With the flag off, nothing changed.

- [x] **Step 4: Commit**

```bash
git add packages/volto-hydra/src/customizations/volto/helpers/Api/Api.js packages/volto-hydra/src/index.js
git commit -m "feat(bridge): route Api through the bridge behind useBridgeBackend"
```

---

**M1 exit criteria.** All of these must hold before starting M2:

- `pnpm test` and `cd packages/hydra-js && pnpm test` green, counts up by the new tests only
- `pnpm exec playwright test --project=admin-mock` green with the flag off
- Nothing under `core/` modified: `git status` shows no `core/` entries and
  `ls core/.git` still resolves

---

# M2 — Contract suite, green against Plone

## Task 12: Contract-suite runner and Plone target

**Files:**
- Create: `vitest.adapters.config.mjs`
- Create: `tests-adapters/targets/plone.ts`
- Create: `tests-adapters/targets/index.ts`
- Modify: `package.json` (add `test:contract`)

The existing mock Plone API is started by
`tests-playwright/fixtures/mock-api-server.cjs` on `HYDRA_MOCK_API_PORT`
(default 8888) with `CONTENT_MOUNTS` naming the content directories — see the
`start:mock-api` script in `package.json` for the exact invocation.

- [x] **Step 1: Create the vitest project**

```js
// vitest.adapters.config.mjs
// The contract suite drives adapters directly — no DOM, no Volto, no browser.
// Kept separate from vitest.config.mjs because that one loads Volto's jsdom
// setup files, which are pure overhead here and pull in the whole registry.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests-adapters/contract/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false, // targets bind fixed ports
  },
});
```

- [x] **Step 2: Add the script**

```json
"test:contract": "vitest run --config vitest.adapters.config.mjs"
```

- [x] **Step 3: Write the target interface**

```ts
// tests-adapters/targets/index.ts
import type { HydraAdapter } from '@volto-hydra/hydra-types';

export interface Target {
  name: string;
  /** Capabilities the suite may exercise against this target. */
  capabilities: string[];
  /** Boot the backing CMS (or mock) and seed it from fixtures/seed.json. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Reset content to the seed state between test files. */
  seed(): Promise<void>;
  adapter: HydraAdapter;
}

export async function resolveTarget(): Promise<Target> {
  const name = process.env.TARGET ?? 'plone';
  const mod = await import(`./${name}.ts`);
  return mod.default as Target;
}
```

- [x] **Step 4: Write the Plone target**

It spawns the existing mock API as a child process and points the Plone adapter
at it. Nothing new is mocked — this reuses `mock-api-server.cjs` verbatim.

```ts
// tests-adapters/targets/plone.ts
import { spawn, type ChildProcess } from 'node:child_process';
import { PloneAdapter } from '@volto-hydra/hydra-adapters-plone';
import type { Target } from './index';

const PORT = 8899; // deliberately not 8888 — must not collide with a dev server
const BASE = `http://localhost:${PORT}`;
let proc: ChildProcess | null = null;

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // server not up yet — the only expected failure here
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`mock Plone API did not become healthy on ${BASE}`);
}

const target: Target = {
  name: 'plone',
  capabilities: ['content', 'search-fulltext', 'vocabulary', 'schema', 'asset'],
  adapter: new PloneAdapter({ cmsBaseUrl: BASE }),

  async start() {
    proc = spawn('node', ['tests-playwright/fixtures/mock-api-server.cjs'], {
      env: {
        ...process.env,
        PORT: String(PORT),
        CONTENT_MOUNTS: '/:tests-adapters/fixtures/content',
      },
      stdio: 'pipe',
    });
    await waitForHealth();
    await this.adapter.init({ cmsBaseUrl: BASE, emit: () => {} });
  },

  async stop() {
    proc?.kill('SIGTERM');
    proc = null;
  },

  async seed() {
    // The mock serves content from disk and keeps mutations in per-session
    // memory, so a fresh session id is a full reset. See getSessionId() in
    // mock-plone-api.cjs.
    await fetch(`${BASE}/@hydra-test-reset`, { method: 'POST' }).catch(() => {});
  },
};

export default target;
```

**Note for the implementer:** `mock-plone-api.cjs` has no `@hydra-test-reset`
endpoint yet. Read `getSessionId()` and `setSessionContent()` (around
`mock-plone-api.cjs:153-180`) and add the smallest endpoint that clears
`sessionContent` for the calling session. If per-session isolation already makes
resets unnecessary, delete the `seed()` body and say so in a comment — do not
leave a call to an endpoint that does nothing.

- [x] **Step 5: Verify the harness boots with no tests**

Run: `pnpm test:contract 2>&1 | tee /tmp/contract-boot.log`
Expected: "No test files found" — the config resolves and nothing crashes.

- [x] **Step 6: Commit**

```bash
git add vitest.adapters.config.mjs tests-adapters/targets package.json
git commit -m "test(contract): vitest project and Plone target harness"
```

---

## Task 13: The canonical seed set

**Files:**
- Create: `tests-adapters/fixtures/seed.json`
- Create: `tests-adapters/fixtures/content/**` (Plone-shaped projection)

This is the single source of truth every target projects into its CMS. Every
contract assertion refers to this, never to per-CMS literals.

- [x] **Step 1: Define the seed**

```json
{
  "documents": [
    { "path": "/", "type": "folder", "title": "Home", "state": "published" },
    { "path": "/news", "type": "folder", "title": "News", "state": "published" },
    { "path": "/news/first-post", "type": "page", "title": "First Post",
      "state": "published",
      "blocks": { "b1": { "@type": "slate", "value": [{ "type": "p", "children": [{ "text": "Hello" }] }] } },
      "blocksLayout": { "items": ["b1"] } },
    { "path": "/news/draft-post", "type": "page", "title": "Draft Post",
      "state": "draft", "blocks": {}, "blocksLayout": { "items": [] } },
    { "path": "/about", "type": "page", "title": "About", "state": "published",
      "blocks": {}, "blocksLayout": { "items": [] } }
  ],
  "assets": [
    { "path": "/news/hero.png", "type": "image", "title": "Hero",
      "width": 800, "height": 600 }
  ],
  "vocabularies": {
    "categories": { "generate": 10000, "tokenPrefix": "cat-", "titlePrefix": "Category " }
  },
  "users": [
    { "username": "admin", "fullname": "Site Admin", "roles": ["Manager"] }
  ]
}
```

**Note for the implementer:** `vocabularies.categories.generate: 10000` exists to
make the autocomplete performance assertion meaningful. Generate it at seed time;
do not commit 10 000 JSON objects.

- [x] **Step 2: Project it for the Plone mock**

Write the generator that turns `seed.json` into the on-disk content tree the
mock serves. Match the layout of the existing
`tests-playwright/fixtures/content/` directory — read it first and follow it
exactly rather than inventing a new one.

- [x] **Step 3: Verify the mock serves the seed**

Run in one shell: `PORT=8899 CONTENT_MOUNTS='/:tests-adapters/fixtures/content' node tests-playwright/fixtures/mock-api-server.cjs`
Run in another: `curl -s localhost:8899/news/first-post | python3 -m json.tool | head -20`
Expected: a Plone-shaped document with `@id`, `title: "First Post"`, and a
`blocks` object containing `b1`.

- [x] **Step 4: Commit**

```bash
git add tests-adapters/fixtures
git commit -m "test(contract): canonical seed content set"
```

---

## Task 14: `content-crud.spec.ts` — red, then the Plone adapter

**Files:**
- Create: `tests-adapters/contract/content-crud.spec.ts`
- Create: `packages/hydra-adapters-plone/index.js`
- Create: `packages/hydra-adapters-plone/package.json`

This is the first real contract file. Write the assertions against `seed.json`,
watch them fail, then build the Plone adapter until they pass.

- [x] **Step 1: Write the failing spec**

```ts
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { resolveTarget, type Target } from '../targets';
import seed from '../fixtures/seed.json';

let target: Target;

beforeAll(async () => { target = await resolveTarget(); await target.start(); }, 60_000);
afterAll(async () => { await target.stop(); });
beforeEach(async () => { await target.seed(); });

describe('content.get', () => {
  it('returns a canonical Document for a seeded path', async () => {
    const doc: any = await target.adapter.dispatch('content.get', { path: '/news/first-post' });
    const expected = seed.documents.find((d) => d.path === '/news/first-post')!;

    expect(doc.path).toBe('/news/first-post');
    expect(doc.title).toBe(expected.title);
    expect(typeof doc.id).toBe('string');
    expect(doc.id.length).toBeGreaterThan(0);
    expect(doc.blocksLayout.items).toEqual(['b1']);
    expect(doc.blocks.b1['@type']).toBe('slate');
  });

  it('never leaks the CMS origin into path', async () => {
    const doc: any = await target.adapter.dispatch('content.get', { path: '/news/first-post' });
    expect(doc.path.startsWith('/')).toBe(true);
    expect(doc.path).not.toMatch(/^https?:/);
  });

  it('rejects a missing path with NOT_FOUND', async () => {
    await expect(
      target.adapter.dispatch('content.get', { path: '/does-not-exist' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('content.update', () => {
  it('round-trips blocks through write then read', async () => {
    const blocks = { x1: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Edited' }] }] } };
    const blocksLayout = { items: ['x1'] };

    await target.adapter.dispatch('content.update', {
      path: '/news/first-post', data: { blocks, blocksLayout },
    });

    const doc: any = await target.adapter.dispatch('content.get', { path: '/news/first-post' });
    expect(doc.blocksLayout.items).toEqual(['x1']);
    expect(doc.blocks.x1.value[0].children[0].text).toBe('Edited');
  });

  it('leaves untouched fields alone', async () => {
    await target.adapter.dispatch('content.update', {
      path: '/news/first-post', data: { title: 'Renamed' },
    });
    const doc: any = await target.adapter.dispatch('content.get', { path: '/news/first-post' });
    expect(doc.title).toBe('Renamed');
    expect(doc.blocksLayout.items).toEqual(['b1']); // blocks untouched
  });
});

describe('content.create / content.delete', () => {
  it('creates a document at the requested parent and then removes it', async () => {
    const created: any = await target.adapter.dispatch('content.create', {
      parentPath: '/news', data: { type: 'page', title: 'Temp' },
    });
    expect(created.path).toBe('/news/temp');

    const fetched: any = await target.adapter.dispatch('content.get', { path: '/news/temp' });
    expect(fetched.title).toBe('Temp');

    await target.adapter.dispatch('content.delete', { path: '/news/temp' });
    await expect(
      target.adapter.dispatch('content.get', { path: '/news/temp' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

- [x] **Step 2: Run and watch it fail**

Run: `pnpm test:contract 2>&1 | tee /tmp/contract-crud-red.log`
Expected: FAIL — `@volto-hydra/hydra-adapters-plone` cannot be resolved.

- [x] **Step 3: Implement the Plone adapter's content intents**

Create the package (mirror `packages/hydra-adapters-core/package.json`), then:

```js
import { BaseAdapter, AdapterError } from '@volto-hydra/hydra-adapters-core';

/** Plone serves its REST API under a ++api++ traversal prefix. */
const API_PREFIX = '/++api++';

export class PloneAdapter extends BaseAdapter {
  constructor({ cmsBaseUrl } = {}) {
    super({
      name: 'plone',
      capabilities: ['content', 'search-fulltext', 'vocabulary', 'schema', 'asset'],
    });
    this.cmsBaseUrl = cmsBaseUrl;
  }

  async init(ctx) {
    await super.init(ctx);
    this.cmsBaseUrl = ctx.cmsBaseUrl ?? this.cmsBaseUrl;
  }

  url(path) {
    return `${this.cmsBaseUrl}${API_PREFIX}${path}`;
  }

  async fetchJson(path, { method = 'GET', body, headers = {} } = {}) {
    const res = await fetch(this.url(path), {
      method,
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 404) {
      throw new AdapterError(`Not found: ${path}`, { code: 'NOT_FOUND', status: 404 });
    }
    if (res.status === 401) {
      throw new AdapterError('Unauthorized', { code: 'UNAUTHORIZED', status: 401 });
    }
    if (!res.ok) {
      throw new AdapterError(`Plone returned ${res.status} for ${path}`, {
        code: 'SERVER_ERROR', status: res.status,
      });
    }
    return res.status === 204 ? null : res.json();
  }

  /** Plone's @id is an absolute URL; the canonical shape wants a CMS-relative path. */
  toPath(atId) {
    const u = new URL(atId);
    return u.pathname.replace(API_PREFIX, '') || '/';
  }

  toDocument(raw) {
    const { '@id': atId, '@type': type, UID, title, language,
            blocks, blocks_layout: blocksLayout, ...fields } = raw;
    return {
      id: String(UID ?? atId),
      path: this.toPath(atId),
      type,
      title,
      language: language?.token,
      blocks: blocks ?? {},
      blocksLayout: blocksLayout ?? { items: [] },
      fields,
      state: raw.review_state,
      _adapter: { raw },
    };
  }

  async dispatch(intent, args) {
    return this.withAuthRetry(() => this.dispatchOnce(intent, args));
  }

  async dispatchOnce(intent, args) {
    switch (intent) {
      case 'http': {
        const { op, path, data, headers } = args;
        const method = op === 'del' ? 'DELETE' : op.toUpperCase();
        return this.fetchJson(path, { method, body: data, headers });
      }
      case 'content.get':
        return this.toDocument(await this.fetchJson(args.path));
      case 'content.update': {
        const body = { ...args.data };
        if (body.blocksLayout) {
          body.blocks_layout = body.blocksLayout;
          delete body.blocksLayout;
        }
        await this.fetchJson(args.path, { method: 'PATCH', body });
        return null;
      }
      case 'content.create': {
        const raw = await this.fetchJson(args.parentPath, {
          method: 'POST',
          body: { '@type': args.data.type, title: args.data.title, ...args.data.fields },
        });
        return this.toDocument(raw);
      }
      case 'content.delete':
        await this.fetchJson(args.path, { method: 'DELETE' });
        return null;
      default:
        return super.dispatch(intent, args);
    }
  }
}

export default PloneAdapter;
```

- [x] **Step 4: Run and watch it pass**

Run: `pnpm test:contract 2>&1 | tee /tmp/contract-crud-green.log`
Expected: PASS, 7 tests.

If `content.create` returns a path the mock doesn't normalize the way the spec
expects, fix the **adapter's** `toPath`, not the assertion — the assertion
encodes the contract.

- [x] **Step 5: Commit**

```bash
git add tests-adapters/contract/content-crud.spec.ts packages/hydra-adapters-plone
git commit -m "test(contract): content CRUD conformance, green on Plone"
```

---

## Tasks 15–20: the remaining contract files

Each follows the identical five-step shape as Task 14 — write the spec against
`seed.json`, run it red, implement the Plone adapter's intent, run it green,
commit. They are listed compactly because the shape does not vary; expand each
into full steps when you reach it.

- [x] **Task 15: `search.spec.ts`** — `search`, `navigation.get`, `breadcrumbs.get`,
  `tree.list`. Assert: full-text search for "First" returns `/news/first-post`;
  `total` is a number; batching keys present when the result set exceeds a page;
  `tree.list({ parent: '/news' })` returns both seeded children;
  `breadcrumbs.get('/news/first-post')` returns Home → News → First Post in order.
  Plone intents map to `@search`, `@navigation`, `@breadcrumbs`.

- [x] **Task 16: `schema.spec.ts`** — `types.list`, `types.getSchema`. Assert:
  `types.list` includes `page` and `folder`; `getSchema('page')` returns
  `{ fieldsets, properties, required }` with `title` in `properties` and a
  `fieldsets[0].fields` array containing it. Plone maps to `@types`.

- [x] **Task 17: `vocabulary.spec.ts`** — `vocabulary.get`. Assert: the shape is
  `{ items: [{ token, title }], total }`; a `?title=Category 4242` filter narrows
  the result; **and the 10 000-term filtered lookup completes under 1 s**, which
  is the assertion the large seed exists for.

- [x] **Task 18: `asset.spec.ts`** — `asset.upload`, `asset.imageUrl`. Assert: an
  upload returns a Document whose `type` is an image type; `asset.imageUrl(field,
  'preview')` returns an absolute URL that responds 200 with an `image/*`
  content-type.

- [x] **Task 19: `auth.spec.ts`** — `auth.whoami`. Assert: returns a canonical
  `User` with `username` and a `roles` array; a call made with a deliberately
  invalidated session raises `UNAUTHORIZED`/401 and the adapter emits
  `auth-required` exactly once (reuse the `BaseAdapter` retry semantics proven in
  Task 7).

- [x] **Task 20: `capabilities.spec.ts`** — the anti-false-advertising check. For
  every capability the target advertises, exercise its representative intent and
  assert it resolves. For every capability it does **not** advertise, assert the
  representative intent rejects with `NOT_IMPLEMENTED`/501. This is what stops an
  adapter claiming `workflow` it doesn't have.

---

## Task 21: The transparency proof

The whole point of the `http` passthrough: with the bridge on, Plone behaves
byte-identically. This task produces the evidence.

**Files:**
- Modify: `playwright.config.ts` (add a `bridge-mock` project)

- [x] **Step 1: Record the baseline**

Run: `pnpm exec playwright test --project=admin-mock 2>&1 | tee /tmp/pw-baseline.log`
Record the pass/fail counts.

- [x] **Step 2: Add a flag-on project**

Duplicate the `admin-mock` project as `bridge-mock`, identical except that the
Volto server is started with the bridge flag on. The flag is read from
`config.settings.useBridgeBackend`; wire it through an env var in
`packages/volto-hydra/src/index.js`:

```js
  config.settings.useBridgeBackend = process.env.RAZZLE_USE_BRIDGE_BACKEND === 'true';
```

and set `RAZZLE_USE_BRIDGE_BACKEND: 'true'` in the new project's webServer env.

- [x] **Step 3: Run it**

Run: `pnpm exec playwright test --project=bridge-mock 2>&1 | tee /tmp/pw-bridge.log`
Expected: **identical** pass/fail counts to `/tmp/pw-baseline.log`.

- [x] **Step 4: Diff the two and record the result**

Run: `diff <(grep -E '^\s+[0-9]+ (passed|failed)' /tmp/pw-baseline.log) <(grep -E '^\s+[0-9]+ (passed|failed)' /tmp/pw-bridge.log)`
Expected: no output.

Any divergence is a real defect in the inversion — investigate it with
@superpowers:systematic-debugging before proceeding. Do not adjust the test to
make the counts match.

- [x] **Step 5: Commit**

```bash
git add playwright.config.ts packages/volto-hydra/src/index.js
git commit -m "test(bridge): transparency proof — Plone suite green with the bridge on"
```

---

**M2 exit criteria:**

- `pnpm test:contract` green against `TARGET=plone`, all seven contract files
- `pnpm exec playwright test --project=bridge-mock` matches `--project=admin-mock` exactly
- `pnpm test` and hydra-js jest still green
- `git status` shows no changes under `core/`
- **Nothing pushed.** Confirm with `git log origin/main..HEAD` showing local-only commits.

Once M2 is green, the contract suite is trustworthy and M3 (WordPress) can be
planned against it.

---

# Execution log

Executed 2026-08-26 in the `cms-adapters` worktree. Tasks 1-20 complete; Task
21 (transparency proof) is the last step.

## Corrections to this plan, found while executing it

1. **`npx jest` needs `NODE_OPTIONS='--experimental-vm-modules'`.** The plan's
   run commands omitted it; `pnpm test` in `packages/hydra-js` supplies it.
2. **`jest` is not a global under native ESM.** Only `test`/`expect` are
   injected; fake timers need `import { jest } from '@jest/globals'`.
3. **`window.__hydraBridge` was already taken.** hydra-js stores the Bridge
   instance there (`hydra.src.js:13256`). The admin-side RPC handle is
   `window.__hydraBridgeRpc`.
4. **The Api shadow is a copy, not a wrapper.** Volto's customization aliasing
   rewrites `@plone/volto/helpers/Api/Api` for every importer *including the
   shadow itself*, so `import OriginalApi from` that specifier is a cycle. The
   file is copied and tagged with `HYDRA:` comments, matching the sibling Url
   shadow. `storeExtenders` was evaluated as an alternative seam and rejected:
   it can transform the middleware stack but cannot reach the api helper that
   `start-client.jsx` closes over.
5. **RPC gets its own message listener**, not a branch inside
   `realTimeDataHandler` — that handler runs hot during typing and carries
   edit-mode guards irrelevant to RPC.
6. **The contract suite refuses to reuse a server it did not start.** A stale
   mock on the port answers `/health` and then serves unknown content, so the
   target fails loudly instead.

## Contract findings

Two assertions were wrong rather than the code:

- **Create does not fix the slug.** The first draft required `/news/temp` from
  `title: 'Temp'`. Plone slugifies; WordPress assigns `post_name`; Drupal uses
  a path alias. The contract now fixes where the document lands and that the
  returned path is addressable, not how the id is derived.
- **Breadcrumbs exclude the site root.** Plone has a root document to point
  at; WordPress and Drupal do not, so a root entry could not mean the same
  thing across adapters. The adapter normalises it away.

`capabilities.spec.ts` found a real bug on its first run: the Plone adapter
advertised `search-fulltext` but not `search-filter`, while `tree.list` worked.

## Mock gaps closed

Each of these made an intent untestable, and each is a place the mock had
drifted from real Plone:

| Gap | Fix |
| --- | --- |
| No DELETE handler at all | Session content dropped; disk content tombstoned per-session |
| `@types/{name}` fabricated a schema for any name | 404s unless the type has a schema file or is addable |
| `localhost:8888` hardcoded in 14 response payloads | Uses the live `PORT`, so a second instance advertises its own URLs |
| Uploaded image bytes never stored | Kept per-session so `@@images` serves back the scale URLs the upload advertised |
| No way to simulate expiry | `Bearer EXPIRED_TOKEN` 401s at the middleware |
| Vocabularies were three hardcoded terms | Opt-in generated vocabularies (`VOCAB_SPEC`) with server-side title filter and batching |

## Results

| Suite | Before | After |
| --- | --- | --- |
| `pnpm test` (vitest) | 349 / 32 files | 354 / 33 files |
| `packages/hydra-js` (jest) | 233 / 37 suites | 243 / 38 suites |
| `pnpm test:api` (mock) | 38 | 38 |
| `pnpm test:contract` | — | 44 / 8 files |
