/**
 * Shared behaviour for every Hydra CMS adapter.
 *
 * Subclasses implement dispatch(); everything here is transport-agnostic, so
 * it is unit-testable without a CMS.
 */

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
 * Canonical expansion names, and the intent each one stands in for.
 *
 * Expansion is a bundling optimisation, never a new capability: every name
 * here is something the admin could have asked for on its own. That is what
 * makes emulation legitimate — an adapter whose CMS cannot expand natively
 * simply issues the same calls itself, and no caller can tell the difference.
 */
/**
 * Where a reordered document ends up, for the two ways an editor asks.
 *
 * Shared because all three adapters have to agree exactly: the contract pins
 * both forms, and three hand-rolled clamps would drift — "to the bottom" landing
 * second-to-last on one CMS is the kind of difference nobody notices until a
 * menu is wrong.
 *
 *   targetIndex — an absolute slot among the siblings, negative counting from
 *                 the end: 0 first, -1 last, as a slice reads.
 *   delta       — a signed step from where it is now, which is what a drag
 *                 gives: the gesture is relative and the admin has no sibling
 *                 list to resolve it against.
 *
 * `from` is its current index and `count` the number of siblings it will sit
 * among AFTER being taken out, so the last valid slot is `count`.
 */
export function resolveOrderPosition({ targetIndex, delta, from, count }) {
  const clamp = (n) => Math.max(0, Math.min(n, count));
  if (delta !== undefined && delta !== null) {
    if (delta === 'top') return 0;
    if (delta === 'bottom') return count;
    return clamp(from + Number(delta));
  }
  const index = Number(targetIndex ?? 0);
  return clamp(index < 0 ? count + 1 + index : index);
}

export const EXPANSIONS = {
  breadcrumbs: (path) => ['breadcrumbs.get', { path }],
  navigation: (path) => ['navigation.get', { path }],
  actions: (path) => ['state.get', { path }],
  types: (path) => ['types.list', { path }],
  querystring: () => ['querystring.getIndexes', {}],
  translations: (path) => ['translations.get', { path }],
};

const READ_CACHE_LIMIT = 500;

/**
 * How long a retained read may be served.
 *
 * Clearing on write covers what THIS admin does; it cannot see anyone else.
 * Another editor, a cron job or someone in the CMS's own admin can change the
 * same content, and without an expiry this session would keep serving what it
 * fetched for as long as it stayed open. A ceiling in seconds keeps a stale
 * answer to something a reload would have fixed anyway, while still collapsing
 * the bursts of repeats that a single interaction produces.
 */
const READ_CACHE_TTL_MS = 30_000;

/**
 * Intents that change the CMS.
 *
 * Invalidation cannot live only in fetchJson: uploads are built by hand with
 * FormData and a raw fetch (WordPress /wp/v2/media, Drupal's two-step file +
 * media create), so they never pass through it. Naming the writing INTENTS
 * puts the rule at the one point every write does cross, whatever transport it
 * ends up using.
 */
const WRITE_INTENTS = new Set([
  'content.create',
  'content.update',
  'content.delete',
  'content.move',
  'content.order',
  'asset.upload',
  'state.transition',
  'permissions.update',
]);

export class BaseAdapter {
  constructor({ name, capabilities }) {
    this.name = name;
    this.capabilities = capabilities;
    this.ctx = null;
    // Completed reads, by key, plus the ones currently in flight.
    //
    // The lifetime is "until this admin writes something". That needs no
    // attribution and so has none of the trouble a per-route scope had: there
    // is no unit of work to assign a read to, and dispatches may interleave
    // freely. Its staleness assumption — that nobody else is editing the same
    // content at the same moment — is the one Volto's own store already makes,
    // since redux holds navigation and types for the life of the session and
    // never refetches them.
    // Completed reads ARE retained: asking the CMS the same question twice,
    // when nothing has happened in between that could change the answer, is
    // work for its own sake. It took the Drupal journey from 190 CMS requests
    // to 83, against coalescing's 110.
    //
    // It was previously left off because the journey then failed about two
    // runs in five, blamed on the admin failing to render a listing it had
    // been given. That verdict is suspect: the same runs were fighting test
    // bugs since fixed — a row selector that could never match, a wait
    // satisfied by the loading placeholder, and a probe that called a
    // still-loading folder absent. Retention makes answers arrive sooner and
    // so changes ordering, which is exactly what those broken waits were
    // sensitive to. Re-enabled to be measured against tests that wait properly.
    this.reads = new Map();
    this.retainReads = true;
    this.inFlight = new Map();
    // Bumped by every write. A read that started BEFORE a write must not be
    // stored after it: it carries pre-write data and would be handed to
    // everyone who asked next.
    this.generation = 0;
  }

  /**
   * Read through the cache, sharing anything already on its way.
   *
   * Three cases, in order: already answered, already asked, ask now.
   */
  async cachedRead(key, run) {
    const held = this.reads.get(key);
    if (held) {
      if (this.now() - held.storedAt < READ_CACHE_TTL_MS) return held.value;
      // Expired: drop it and ask again, rather than serving it once more.
      this.reads.delete(key);
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      try {
        return await existing;
      } catch (err) {
        // Do not inherit someone else's abort. Sharing a request must never
        // leave a caller worse off than issuing its own would have.
        if (!this.isAbortedByNavigation(err)) throw err;
        return this.readWithRetry(run);
      }
    }

    const generation = this.generation;
    const pending = this.readWithRetry(run);
    this.inFlight.set(key, pending);
    pending.then(
      (value) => {
        this.inFlight.delete(key);
        if (!this.retainReads) return;
        if (this.generation !== generation) return; // a write overtook it
        this.reads.set(key, { value, storedAt: this.now() });
        // Bounded so a long session cannot grow without limit. Oldest first:
        // insertion order is a good enough proxy, and the cost of dropping an
        // entry is one request, not a wrong answer.
        if (this.reads.size > READ_CACHE_LIMIT) {
          this.reads.delete(this.reads.keys().next().value);
        }
      },
      () => this.inFlight.delete(key),
    );
    return pending;
  }

  /**
   * A read the browser killed, rather than the CMS refusing it.
   *
   * The adapter runs INSIDE the iframe, so anything the frontend does to that
   * window — a back-navigation, a reload, following a link — aborts its
   * in-flight fetches. fetch() reports that as a TypeError with no status,
   * which is not the CMS saying no; it is nobody having answered yet.
   *
   * This is what made the journey's back-to-the-listing step flaky long before
   * any caching existed: the listing data was fetched correctly, but a sibling
   * read died with the navigation and the view rendered empty.
   */
  isAbortedByNavigation(err) {
    return err instanceof TypeError && err.status === undefined;
  }

  /**
   * Issue a read, once more if a navigation killed it.
   *
   * Only reads: they are idempotent, so a retry cannot duplicate anything. A
   * write aborted mid-flight may well have been applied, and re-sending it
   * would be the adapter deciding on its own to do it twice.
   */
  async readWithRetry(run) {
    try {
      return await run();
    } catch (err) {
      if (!this.isAbortedByNavigation(err)) throw err;
      return run();
    }
  }

  /** Does this dispatch change the CMS? */
  isWriteIntent(intent, args) {
    // The raw passthrough carries its own verb; everything but a GET writes.
    if (intent === 'http') return (args?.op ?? 'get').toLowerCase() !== 'get';
    return WRITE_INTENTS.has(intent);
  }

  /**
   * Run a dispatch, invalidating around it if it writes.
   *
   * Invalidated BEFORE so a read already in flight cannot be stored (the
   * generation guard), and AFTER so anything read while the write was in
   * progress — and therefore possibly pre-write — is dropped too.
   */
  async dispatchWithInvalidation(intent, args, run) {
    if (!this.isWriteIntent(intent, args)) return run();
    this.invalidateReads();
    try {
      return await run();
    } finally {
      this.invalidateReads();
    }
  }

  /**
   * Everything written invalidates every cached read.
   *
   * Whole-cache, not just the written path: a write changes what listings,
   * breadcrumbs and navigation say about the document too, and working out
   * which of those a given write touched is exactly the guesswork this design
   * avoids.
   */
  /** Overridable so a test can age the cache without sleeping through it. */
  now() {
    return Date.now();
  }

  invalidateReads() {
    this.generation += 1;
    this.reads.clear();
  }

  /** Stable cache key: same route and params must produce the same string. */
  scopeKey(route, params) {
    if (!params) return route;
    const sorted = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    return sorted ? `${route}?${sorted}` : route;
  }

  async init(ctx) {
    this.ctx = ctx;
  }

  supports(capability) {
    return this.capabilities.includes(capability);
  }

  async whoami() {
    return null;
  }

  /**
   * Refuse form values the transition's own schema did not declare.
   *
   * Dropping them silently is the dangerous version: the dialog reports
   * success for a setting that never took, and the first sign of trouble is
   * the wrong audience seeing the document.
   */
  /**
   * The form of a transition the document offers, or BAD_REQUEST.
   *
   * Every CMS here moves a document by writing something; a transition id it
   * does not know becomes nothing to write. WordPress sent `status: undefined`,
   * which it ignored with a 200, and Drupal wrote nothing and answered null:
   * the caller was told the document moved and it never did. An import
   * reported every page published and left them all drafts.
   */
  offeredTransition(forms, transitionId) {
    const form = forms?.[transitionId];
    if (!form) {
      throw new AdapterError(
        `${this.name}: no transition '${transitionId}' is offered here (offered: ${Object.keys(forms ?? {}).join(', ') || 'none'})`,
        { code: 'BAD_REQUEST', status: 400 },
      );
    }
    return form;
  }

  assertDeclared(data, schema, transitionId) {
    if (!data) return;
    const declared = schema?.properties ?? {};
    const undeclared = Object.keys(data).filter((k) => !(k in declared));
    if (undeclared.length) {
      throw new AdapterError(
        `${this.name}: '${transitionId}' does not take ${undeclared.join(', ')}`,
        { code: 'BAD_REQUEST', status: 400 },
      );
    }
  }

  /**
   * Forget the credential. Signing out, for every CMS.
   *
   * Implemented once here because it is the same act everywhere: the session
   * lives in the adapter, so ending it is dropping what the adapter holds. A
   * CMS with a server-side session to tear down overrides this and calls
   * super.logout() when it is done.
   *
   * Reads are discarded too. They were fetched as somebody — leaving them in
   * place means the next caller is served that person's content from cache
   * after they signed out, which is the whole thing logging out is supposed to
   * prevent.
   */
  async logout() {
    this.authToken = null;
    this.getAuthToken = null;
    this.credentials = null;
    this.csrfToken = null;
    this.invalidateReads();
  }

  async dispatch(intent, args) {
    // Several operations, one intention — served here so EVERY adapter has it.
    //
    // Layered like expansion: the base class applies the operations itself, so a
    // CMS with nothing bulk still answers `batch`, and one that has something
    // (WordPress's /batch/v1 takes 25 requests per call; Plone's @import takes a
    // whole subtree) overrides this and groups them. The caller asks the same
    // thing either way and never keeps a fallback of its own — which is the whole
    // point of putting it at this layer rather than in the importer.
    if (intent === 'batch') return this.applyBatch(args);
    throw new AdapterError(`${this.name} does not implement '${intent}'`, {
      code: 'NOT_IMPLEMENTED',
      status: 501,
    });
  }

  /**
   * The floor: apply them one at a time, in order, and stop at the first failure.
   *
   * Deliberately NOT like expandContext, which runs its intents concurrently and
   * omits what a CMS cannot serve. Those are reads. These are writes:
   *
   *   - Order is part of the meaning. A parent has to exist before its child, and
   *     an ordering has to be applied after the documents it orders. Promise.all
   *     would make a batch that works and a batch that was reordered look alike.
   *   - A failure is not omitted. Half-applied is a real state someone has to
   *     recover from, so the error carries `failedIndex` and how many stood: an
   *     importer can resume instead of starting over or, worse, reapplying.
   *   - `atomic` is refused rather than faked. Rolling back cannot be emulated
   *     from out here, and a caller believing in a guarantee it does not have is
   *     worse off than one told no. An adapter whose CMS can promise it overrides
   *     this method.
   *
   * Each operation goes through `this.dispatch`, not `dispatchOnce`, so it behaves
   * exactly as it would on its own — same auth retry, same cache invalidation.
   */
  async applyBatch(args = {}) {
    const operations = args.operations ?? [];
    if (!Array.isArray(operations)) {
      throw new AdapterError('batch requires an array of operations', {
        code: 'INVALID_BATCH',
        status: 400,
      });
    }
    if (args.atomic) {
      throw new AdapterError(
        `${this.name} cannot apply a batch atomically: it is emulated one ` +
          `operation at a time, so a failure part-way leaves what came before ` +
          `it applied. Ask without atomic and handle failedIndex, or use an ` +
          `adapter whose CMS can promise it.`,
        { code: 'NOT_IMPLEMENTED', status: 501 },
      );
    }

    const results = [];
    for (const [index, operation] of operations.entries()) {
      if (!operation?.intent) {
        throw new AdapterError(`batch operation ${index} has no intent`, {
          code: 'INVALID_BATCH',
          status: 400,
          failedIndex: index,
          applied: results.length,
        });
      }
      try {
        results.push(await this.dispatch(operation.intent, operation.args ?? {}));
      } catch (error) {
        // Rethrown with WHERE it stopped attached, rather than wrapped: the
        // original code and status are what the caller decides on.
        error.failedIndex = index;
        error.applied = results.length;
        error.failedIntent = operation.intent;
        throw error;
      }
    }
    return { results };
  }

  /**
   * Run fn; on a 401 run it exactly once more — the CMS session may have been
   * refreshed in another tab. If the retry also 401s, tell the admin to raise
   * an auth challenge and rethrow, so the caller still sees the failure rather
   * than a silently swallowed one.
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

  /**
   * Fetch the requested context bundle concurrently.
   *
   * The concurrency is the whole point, and it is only available here. The
   * admin issues these reads from separate components at separate times and
   * cannot know they belong to one route; the adapter, handed the list, can
   * put them all in flight at once. Against a CMS with a high per-request
   * floor that is the difference between one round trip and N.
   *
   * Calls dispatchOnce rather than dispatch so the caller's withAuthRetry
   * governs the whole bundle — otherwise one expired session would trigger a
   * retry storm, one per expansion.
   */
  async expandContext(path, expand) {
    const unknown = expand.filter((name) => !(name in EXPANSIONS));
    if (unknown.length) {
      throw new AdapterError(
        `${this.name} got unknown expansion(s): ${unknown.join(', ')}`,
        { code: 'UNKNOWN_EXPANSION', status: 400 },
      );
    }
    const entries = await Promise.all(
      expand.map(async (name) => {
        const [intent, intentArgs] = EXPANSIONS[name](path);
        try {
          return [name, await this.dispatchOnce(intent, intentArgs)];
        } catch (error) {
          // An expansion this CMS cannot serve is omitted, not fatal. The
          // DOCUMENT is what was asked for; the bundle beside it is a
          // convenience, and taking the read down with it would mean a
          // WordPress page failing to load because the admin asked whether it
          // had a German version.
          //
          // The admin cannot avoid asking: its bundle is declared statically,
          // before any adapter has announced what it supports, because the
          // first content request goes out while that announcement is still in
          // flight (bridge/client.js says so at length).
          //
          // Only this one reason, though. Anything else — a refused session, a
          // CMS that is down, a malformed answer — is a real failure and stays
          // one, or expansion becomes a place where errors go to be forgotten.
          if (error?.code === 'NOT_IMPLEMENTED') return [name, undefined];
          throw error;
        }
      }),
    );
    return Object.fromEntries(
      entries.filter(([, value]) => value !== undefined),
    );
  }

  /** Attach an expansion bundle to a document, if one was asked for. */
  async withContext(doc, path, expand) {
    if (!expand?.length) return doc;
    return { ...doc, context: await this.expandContext(path, expand) };
  }
}
