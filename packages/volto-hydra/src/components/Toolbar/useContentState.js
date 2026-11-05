import { useCallback, useEffect, useState } from 'react';
import { getBridgeRpc, whenAdapterReady, getAdapterInfo } from '../../bridge/client';

/**
 * The current document's state and the forms its transitions ask for.
 *
 * Two intents, fetched at different times on purpose. `state.get` is cheap and
 * runs whenever the document changes; `state.getForms` is only fetched when the
 * menu opens, because the expensive part of it — who currently has access — is
 * a second request the CMS does not make for free.
 *
 * These go straight down the bridge rather than through the Plone-REST
 * emulation. `state.getForms` has no Plone endpoint to emulate: the adapter
 * composes it out of @workflow and @sharing, and a CMS on the http passthrough
 * would send an invented URL to a real Plone and get a 404.
 */
export function useContentState(path) {
  const [pas, setPas] = useState(null);
  const [forms, setForms] = useState(null);
  const [error, setError] = useState(null);

  const hasState = () => Boolean(getAdapterInfo()?.capabilities?.includes('state'));

  useEffect(() => {
    let live = true;
    if (!path) return undefined;
    (async () => {
      await whenAdapterReady();
      if (!live || !hasState()) return;
      try {
        const next = await getBridgeRpc().request('state.get', { path });
        if (live) setPas(next);
      } catch (err) {
        // Surfaced in the panel rather than swallowed: a toolbar that silently
        // shows no state looks identical to a document with no workflow.
        if (live) setError(err);
      }
    })();
    return () => {
      live = false;
      setForms(null);
    };
  }, [path]);

  const loadForms = useCallback(async () => {
    if (!path) return;
    // Readiness FIRST, capability second. Reversed, this asked whether the
    // adapter does `state` before the adapter had said anything at all, so it
    // was always false on mount and the access entry never loaded — while
    // state.get, which awaits first, worked. The menu then showed transitions
    // and silently nothing else.
    await whenAdapterReady();
    if (!hasState()) return;
    try {
      setForms(await getBridgeRpc().request('state.getForms', { path }));
    } catch (err) {
      setError(err);
    }
  }, [path]);

  const transition = useCallback(
    async (id, data) => {
      const result = await getBridgeRpc().request('state.transition', {
        path,
        id,
        data,
      });
      // Re-read rather than assume: the adapter may land somewhere other than
      // the transition's nominal target, and one of three cannot even name one.
      // Skipped when we are being sent elsewhere — the state of the document we
      // are leaving is about to stop being what is on screen.
      if (!result?.redirect) {
        setPas(await getBridgeRpc().request('state.get', { path }));
      }
      setForms(null);
      return result;
    },
    [path],
  );

  return { pas, forms, error, loadForms, transition };
}
