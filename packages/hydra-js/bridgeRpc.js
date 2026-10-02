/**
 * Bidirectional RPC over the admin <-> iframe postMessage channel.
 *
 * Symmetric: the same class runs on both sides. The admin instance sends
 * BACKEND_REQUEST and resolves on BACKEND_RESPONSE; the iframe instance
 * serves requests by dispatching them to a registered adapter.
 */

/** Bumped whenever the envelope shape changes incompatibly. */
export const BRIDGE_PROTOCOL_VERSION = 1;

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Intents that legitimately take longer than the default. Uploads move real
 * bytes over the wire; everything else is a JSON round trip.
 */
const INTENT_TIMEOUTS = { 'asset.upload': 120_000 };

/**
 * Can this intent be re-sent safely if the peer disappears mid-flight?
 *
 * Reads can: asking twice costs a round trip and nothing else. Writes cannot,
 * because the adapter may already have applied one.
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

function isRetryableIntent(intent, args) {
  if (intent === 'http') return (args?.op ?? 'get').toLowerCase() === 'get';
  return !WRITE_INTENTS.has(intent);
}

export class BridgeRPC {
  /**
   * @param {Object} opts
   * @param {(msg: object) => void} opts.send - transport (postMessage wrapper)
   */
  /**
   * @param {Object} opts
   * @param {(msg: object) => void} opts.send - transport (postMessage wrapper)
   * @param {boolean} [opts.gated] - hold requests until an adapter is serving.
   *   The admin side sets this: the inversion makes it depend on the iframe to
   *   fetch the very content the iframe needs in order to render, so a request
   *   sent while the iframe is between documents is dropped on the floor and
   *   the editor deadlocks until the request times out. The iframe side is
   *   ungated — it only ever answers.
   */
  /**
   * @param {number} [opts.adapterTimeoutMs] - how long a gated request waits
   *   for an adapter before giving up. Waiting forever would be worse than
   *   failing: the admin has no CMS of its own to fall back to, so a request
   *   nothing will ever answer must surface as an error rather than a spinner.
   */
  /**
   * @param {() => boolean} [opts.canSend] - whether a transport exists right
   *   now. Readiness is two things, not one: an adapter has announced itself,
   *   AND there is somewhere to send. During a route change the iframe hosting
   *   the adapter can be gone while the next one has not mounted, and
   *   dispatching into that window loses the request outright.
   */
  constructor({ send, gated = false, adapterTimeoutMs = 15_000, canSend }) {
    this.send = send;
    this.canSend = canSend ?? (() => true);
    this.pending = new Map();
    this.nextId = 0;
    this.gated = gated;
    this.ready = !gated;
    this.queue = [];
    this.adapterTimeoutMs = adapterTimeoutMs;
    this.adapterTimer = null;
  }

  /** True only when an adapter has announced AND a transport exists. */
  get dispatchable() {
    return this.ready && this.canSend();
  }

  /** An adapter has announced itself; release anything held, if we can. */
  markReady() {
    this.ready = true;
    clearTimeout(this.adapterTimer);
    this.adapterTimer = null;
    if (!this.canSend()) return; // nothing to send to yet; stay queued
    const queued = this.queue;
    this.queue = [];
    for (const entry of queued) entry.dispatch();
  }

  /**
   * The window that owed us replies is gone; settle everything it owed.
   *
   * Every request here was already SENT, so a reply can only come from a
   * window that no longer exists. Left alone they sat until their 30s timeout
   * — which is indistinguishable from a slow CMS, and is why a preview reload
   * mid-edit looked like WordPress being slow rather than the peer vanishing.
   *
   * A caller awaiting this bridge must always get an answer, the same way an
   * HTTP caller gets either a response or a connection error. Never silence.
   *
   * Reads are re-sent to the new window: they are idempotent, and re-asking is
   * exactly what a browser does when a connection drops mid-GET. Writes are
   * NOT — the old adapter may have received and applied one, and re-sending
   * would be this layer deciding on its own to do it twice. Those reject, so
   * the caller finds out immediately instead of thirty seconds later.
   */
  peerReplaced(reason = 'the preview window was replaced') {
    const orphaned = [...this.pending.entries()];
    this.pending.clear();

    for (const [requestId, entry] of orphaned) {
      clearTimeout(entry.timer);
      if (entry.retryable && this.canSend()) {
        entry.redispatch();
        continue;
      }
      const err = new Error(
        `Bridge request '${entry.intent}' was lost: ${reason}.`,
      );
      err.code = 'PEER_GONE';
      err.intent = entry.intent;
      err.requestId = requestId;
      entry.reject(err);
    }
  }

  /** Give up on an adapter that never arrived, and say so plainly. */
  failQueued() {
    const queued = this.queue;
    this.queue = [];
    this.adapterTimer = null;
    for (const entry of queued) {
      const err = new Error(
        `No adapter registered after ${this.adapterTimeoutMs}ms — the frontend ` +
          `did not announce one, and the admin cannot reach a CMS by itself.`,
      );
      err.code = 'NO_ADAPTER';
      entry.reject(err);
    }
  }

  /** The iframe is navigating; whatever was serving us is gone. */
  markNotReady() {
    if (this.gated) this.ready = false;
  }

  /**
   * Abandon in-flight READS whose requester has gone away.
   *
   * The preview navigating away does not cost us the adapter any more — it
   * lives in the proxy frame, which never navigates — but it does mean the
   * document those reads were for is no longer on screen. Left alone they run
   * to completion, get re-sent by peerReplaced, and resolve into components
   * that have since unmounted: work whose only effect is to make a slow CMS
   * slower, and the shape of bug where a listing arrives after the panel that
   * asked for it has closed.
   *
   * Reads only. A write may already have been applied by the adapter, so
   * abandoning one would leave the caller unable to find out what happened —
   * the same reasoning that makes writes non-retryable in peerReplaced.
   *
   * Discarded callers are REJECTED, not silently dropped: anything awaiting
   * this bridge gets an answer.
   */
  discardReads(reason = 'the requester navigated away') {
    const settle = (entry, requestId) => {
      const err = new Error(
        `Bridge request '${entry.intent}' was discarded: ${reason}.`,
      );
      err.code = 'DISCARDED';
      err.intent = entry.intent;
      if (requestId) err.requestId = requestId;
      entry.reject(err);
    };

    // Queued: never sent, so nothing to correlate — just drop them.
    const stillWanted = [];
    for (const entry of this.queue) {
      if (entry.intent && !isRetryableIntent(entry.intent, entry.args)) {
        stillWanted.push(entry);
        continue;
      }
      settle(entry);
    }
    this.queue = stillWanted;

    // In flight: forget the id, so a late reply is ignored by handleMessage
    // rather than resolving something nobody is listening to.
    for (const [requestId, entry] of [...this.pending.entries()]) {
      if (!entry.retryable) continue; // a write; leave it alone
      this.pending.delete(requestId);
      clearTimeout(entry.timer);
      settle(entry, requestId);
    }
  }

  timeoutFor(intent) {
    return INTENT_TIMEOUTS[intent] ?? DEFAULT_TIMEOUT_MS;
  }

  request(intent, args, { timeoutMs } = {}) {
    const requestId = `rpc-${++this.nextId}`;
    const ms = timeoutMs ?? this.timeoutFor(intent);

    return new Promise((resolve, reject) => {
      // The timeout clock starts when the request actually goes out, not when
      // it is created: time spent waiting for the iframe is not the CMS being
      // slow, and charging it to the request's budget would fail calls that
      // were never given a chance to run.
      const dispatch = () => {
        const timer = setTimeout(() => {
          this.pending.delete(requestId);
          const err = new Error(
            `Bridge request '${intent}' timed out after ${ms}ms`,
          );
          err.code = 'TIMEOUT';
          err.intent = intent;
          reject(err);
        }, ms);
        this.pending.set(requestId, {
          resolve,
          reject,
          timer,
          intent,
          // Only reads may be re-sent; see peerReplaced().
          retryable: isRetryableIntent(intent, args),
          redispatch: dispatch,
        });
        this.send({
          type: 'BACKEND_REQUEST',
          requestId,
          intent,
          args,
          meta: { timeoutMs: ms },
        });
      };

      if (this.dispatchable) {
        dispatch();
      } else {
        // intent/args ride along so a discard can tell a read from a write
        // without having sent the request yet.
        this.queue.push({ dispatch, reject, intent, args });
        if (!this.adapterTimer) {
          this.adapterTimer = setTimeout(
            () => this.failQueued(),
            this.adapterTimeoutMs,
          );
        }
      }
    });
  }

  /** Register the adapter this side answers BACKEND_REQUEST with. */
  serve(adapter) {
    this.adapter = adapter;
  }

  async handleRequest(msg) {
    const { requestId, intent, args } = msg;
    if (!this.adapter) {
      this.send({
        type: 'BACKEND_RESPONSE',
        requestId,
        ok: false,
        error: {
          code: 'NO_ADAPTER',
          message: 'No adapter registered on this frontend',
        },
      });
      return;
    }
    try {
      const result = await this.adapter.dispatch(intent, args);
      this.send({
        type: 'BACKEND_RESPONSE',
        requestId,
        ok: true,
        // Only the raw http passthrough bypasses canonical normalisation.
        raw: intent === 'http',
        result,
      });
    } catch (err) {
      this.send({
        type: 'BACKEND_RESPONSE',
        requestId,
        ok: false,
        error: {
          code: err.code ?? 'ADAPTER_ERROR',
          status: err.status,
          message: err.message,
          data: err.data,
        },
      });
    }
  }

  handleMessage(msg) {
    if (msg?.type === 'BACKEND_REQUEST') return this.handleRequest(msg);
    if (msg?.type !== 'BACKEND_RESPONSE') return false;
    const entry = this.pending.get(msg.requestId);
    if (!entry) return false;
    this.pending.delete(msg.requestId);
    clearTimeout(entry.timer);
    if (msg.ok) {
      // No per-connection "was that raw?" flag here. It was last-write-wins
      // shared state, so with several requests in flight the value a caller
      // read could belong to somebody else's response. Nothing needs it:
      // BridgeApi decides passthrough-vs-canonical from the adapter's
      // CAPABILITIES, before the request is even sent. If a caller ever does
      // need it, it belongs in the resolved value, correlated by requestId
      // like everything else.
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
}
