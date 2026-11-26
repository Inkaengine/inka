import { BridgeRPC } from '@volto-hydra/hydra-js/bridgeRpc';
import config from '@plone/volto/registry';

/**
 * The admin's single bridge client, published before any route can dispatch.
 *
 * Timing is the whole point. Volto's editor bootstrap fires @types and
 * @querystring during mount, and React runs child effects before parent
 * effects — so publishing this from a component's useEffect (even App's) is
 * already too late, and those calls found no bridge and went direct. Creating
 * it at module load, which happens when the addon's applyConfig is imported,
 * means the client exists before the store does.
 *
 * It starts gated, so anything dispatched before the frontend announces an
 * adapter queues rather than racing.
 */

let rpc = null;

/** Origin of the iframe we talk to; learned from the first message it sends. */
let targetOrigin = null;

export function setBridgeTargetOrigin(origin) {
  if (origin) targetOrigin = origin;
}

/**
 * The adapter host is preferred over the visible editing iframe, because it
 * exists on every route. The editing iframe is only there while a document is
 * open, so relying on it would leave the contents view — and anything else
 * without an iframe — unable to reach the CMS at all.
 */
/**
 * The editing iframe when there is one, the host otherwise.
 *
 * ALWAYS the proxy frame, never the preview.
 *
 * This used to prefer the preview iframe wherever one existed, on the
 * reasoning that it saved loading the frontend twice. What it actually bought
 * was a transport whose lifetime is driven by what the editor is looking at:
 * when the preview was replaced mid-edit, every in-flight request was owed a
 * reply by a window that no longer existed, and they expired one at a time at
 * their timeouts. It also left routes that render no preview — the contents
 * view above all — with no transport at all.
 *
 * The proxy frame is mounted once for the session and never navigates, so
 * there is nothing to prefer between and no handoff to get wrong.
 */
function bridgeIframe() {
  return document.getElementById('hydraProxyFrame');
}

/**
 * The window whose adapter has announced itself.
 *
 * Readiness is per-WINDOW rather than a boolean on the client. With a single
 * proxy frame there is only one target, but the distinction still earns its
 * keep: the frame's document is replaced on reload, and a boolean would say
 * "ready" while requests went into a document with no listener — which is how
 * 22 requests went in and 6 came out, leaving an edit form with no title.
 *
 * Comparing against the announcing window makes readiness a property of the
 * transport rather than of the client, so a target that has not announced
 * queues instead of swallowing.
 */
let readyWindow = null;

// Whether an editing iframe is currently mounted. The host subscribes so it
// can stay out of the way rather than loading the frontend a second time.
let editingMounted = false;
const editingListeners = new Set();

export function setEditingIframeMounted(value) {
  if (editingMounted === value) return;
  editingMounted = value;
  for (const listener of editingListeners) listener(editingMounted);
}

export function subscribeEditingIframe(listener) {
  editingListeners.add(listener);
  return () => editingListeners.delete(listener);
}

export function isEditingIframeMounted() {
  return editingMounted;
}

function resolveTargetOrigin() {
  const iframe = bridgeIframe();
  if (iframe?.src) return new URL(iframe.src).origin;
  return targetOrigin;
}

export function getBridgeRpc() {
  if (rpc) return rpc;
  rpc = new BridgeRPC({
    gated: true,
    // Readiness is not just "an adapter announced" — it is also "there is an
    // iframe to send to". Leaving one route for another can remove the host
    // before the next mounts, and a request dispatched into that gap is lost.
    // Not just "is there an iframe" — "is there an adapter in the window I am
    // about to post to". The two differ exactly while a target is swapping,
    // which is when requests were being lost.
    canSend: () => {
      const target = bridgeIframe()?.contentWindow;
      return Boolean(target) && target === readyWindow;
    },
    send: (msg) => {
      const iframe = bridgeIframe();
      const origin = resolveTargetOrigin();
      if (!iframe?.contentWindow || !origin) {
        // canSend() should have kept this queued. Reaching here means the
        // transport vanished between the check and the send, so surface it
        // rather than dropping the message silently.
        throw new Error(
          '[hydra] bridge send with no iframe to send to; the transport ' +
            'disappeared after the readiness check.',
        );
      }
      iframe.contentWindow.postMessage(msg, origin);
    },
  });
  return rpc;
}

/**
 * Listen for bridge traffic here rather than in a component.
 *
 * ADAPTER_READY used to be handled in the Iframe view, which is not mounted on
 * every route — the contents view has no iframe at all. The adapter announced
 * itself, nothing was listening, the gate never opened and every request sat
 * queued behind it. The client owns its own transport so it works regardless
 * of what is on screen.
 */
// Long enough for a slow CMS to boot its frontend. WordPress on PHP-WASM
// needs well over the 15s this used to allow, and every request issued before
// the announcement was routed on a GUESS about which CMS was connected.
const ADAPTER_ANNOUNCE_TIMEOUT_MS = 60_000;

function installListener(rpcClient) {
  window.addEventListener('message', (event) => {
    const type = event.data?.type;
    if (!type) return;

    const iframe = bridgeIframe();
    const expected = iframe?.src ? new URL(iframe.src).origin : null;
    if (expected && event.origin !== expected) return;
    // NOT filtering on event.source, deliberately. During an iframe reload the
    // element's contentWindow can already be the new document while
    // ADAPTER_READY from the old one is still in flight; dropping it leaves
    // the gate shut and every request hanging. The host and the editor never
    // coexist now — the host is confined to routes with no editor — so origin
    // is sufficient to identify the sender.

    if (type === 'BACKEND_RESPONSE') {
      rpcClient.handleMessage(event.data);
      return;
    }
    if (type === 'ADAPTER_READY') {
      setBridgeTargetOrigin(event.origin);
      lastAdapter = {
        name: event.data.name,
        capabilities: event.data.capabilities ?? [],
        protocolVersion: event.data.protocolVersion,
        user: event.data.user,
        cmsBaseUrl: event.data.cmsBaseUrl,
      };

      // The CMS the FRONTEND chose, not the one this admin was built against.
      //
      // apiPath is what flattenToAppURL strips to turn an absolute @id into a
      // route. A passthrough adapter hands back the CMS's own JSON, so those
      // @ids carry the CMS's origin — and if apiPath still names the build's
      // default, nothing is stripped: the admin then treats a whole URL as a
      // path and asks for `/news/http://host/news/untitled-document`, which
      // 404s and leaves the edit form with nothing.
      //
      // Which CMS is answering is the frontend's choice in Hydra, so the
      // admin cannot know it at build time. It learns it here.
      if (event.data.cmsBaseUrl) {
        config.settings.apiPath = event.data.cmsBaseUrl.replace(/\/+$/, '');
      }

      // apiExpanders is deliberately NOT touched here.
      //
      // It used to be emptied on this line, to undo expanders that had been
      // declared from the announcement — which did arrive too late to be true,
      // because the first route's content request goes out while the adapter is
      // still announcing. The decision now lives in applyConfig, made
      // statically before any request exists (see bridge/expanders.js), so
      // there is nothing left here to undo.
      //
      // Clearing it now is actively wrong, because the flag is read at THREE
      // moments and an announcement lands between them:
      //
      //   1. building the content request — add `?expand=...`?
      //   2. the answer coming back — may the reducer take @components?
      //   3. a component mounting — should it fetch its own data?
      //
      // Emptying it between 1 and 2 desynchronises them: the request went out
      // expanded and the CMS answered in full, then the actions reducer refused
      // the bundle because the config now said nothing was expanded, while the
      // Toolbar had already skipped its own fetch at 3. The data was fetched,
      // delivered and discarded, and the toolbar rendered no Edit button — which
      // is what broke every edit-mode spec in the suite.
      //
      // Pinned by ApiRouting.test.js: an announcement must leave it alone.

      // A DIFFERENT window announcing means the previous one is gone, and with
      // it every reply it still owed. Say so before marking ready, so those
      // requests are settled against the old peer rather than left to expire.
      //
      // Without this a preview reload mid-edit went silent: the upload and
      // every intent after it sat until their 30s timeouts, which reads as a
      // slow CMS rather than a window that no longer exists.
      if (readyWindow && readyWindow !== event.source) {
        rpcClient.peerReplaced();
      }

      // Readiness belongs to the WINDOW that announced it, not to the client.
      readyWindow = event.source;
      rpcClient.markReady();
      resolveAdapterReady?.(lastAdapter);
      for (const listener of adapterListeners) listener(lastAdapter);
    }
  });
}

/** What the frontend last told us it is and can do. */
let lastAdapter = null;

export function getAdapterInfo() {
  return lastAdapter;
}

/**
 * Watch what the adapter says about itself, including WHO is signed in.
 *
 * ADAPTER_READY carries `user`, and it arrives twice in a sign-in: once
 * anonymous, and again once the proxy has a credential. The admin needs both —
 * the first tells it to show a login, the second to start the editor — so this
 * is a subscription rather than a one-shot read.
 */
const adapterListeners = new Set();

export function subscribeAdapter(listener) {
  adapterListeners.add(listener);
  listener(lastAdapter);
  return () => adapterListeners.delete(listener);
}

/**
 * Resolves once the frontend has said what it is.
 *
 * Callers that only need a request answered can rely on the RPC queue, which
 * already holds traffic until readiness. Callers that must *decide something*
 * from the adapter's capabilities cannot: they run at call time, before the
 * announcement, and would bake in a default that never gets revisited. That is
 * exactly how every request ended up on the passthrough regardless of which
 * CMS was connected.
 *
 * Resolves with null if no adapter ever announces, so a missing frontend
 * surfaces as the usual NO_ADAPTER error instead of a hang here.
 */
let resolveAdapterReady;
const adapterReadyPromise =
  typeof window === 'undefined'
    ? Promise.resolve(null)
    : new Promise((resolve) => {
        resolveAdapterReady = resolve;
        setTimeout(() => resolve(lastAdapter), ADAPTER_ANNOUNCE_TIMEOUT_MS);
      });

export function whenAdapterReady() {
  return adapterReadyPromise;
}

if (typeof window !== 'undefined') {
  // The Api shadow is constructed by Volto's start-client before any React
  // tree exists and has no context to read from; one window handle is the seam.
  const client = getBridgeRpc();
  window.__hydraBridgeRpc = client;
  installListener(client);
}
