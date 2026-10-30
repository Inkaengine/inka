import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import Cookies from 'js-cookie';
import config from '@plone/volto/registry';
import { getIframeUrlCookieName } from '../utils/cookieNames';
import { subscribeAdapter } from './client';
import { getURlsFromEnv } from '../utils/getSavedURLs';
import { proxyFrameUrl } from '../utils/iframeUrl';

/**
 * The PROXY frame: a hidden iframe that hosts the frontend's adapter, always.
 *
 * It never stands down. This used to hand the adapter over to the preview
 * iframe whenever the editor mounted one, and that handoff was the bug: the
 * preview's lifetime is driven by what the editor is LOOKING at, so when it
 * was replaced mid-edit every in-flight request was owed a reply by a window
 * that no longer existed. They expired one by one at their timeouts, and an
 * upload that never reached the CMS looked like a slow upload rather than a
 * lost peer. Traced with the admin sitting still on .../edit while the preview
 * reverted to view mode at the site root.
 *
 * Never handing over also removes what the handoff needed: no gate to close
 * between hosts, no race about which iframe has announced, no cache thrown
 * away on every navigation. Adapter caches now live as long as the session.
 *
 * It loads a MINIMAL proxy page, not the frontend's rendering page: no router,
 * no DOM, nothing that can navigate it out from under the admin. See §8e of
 * the design doc.
 */
export default function AdapterHost() {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => setIsClient(true), []);

  // Who, if anyone, is signed in to the CMS. Null adapter means it has not
  // announced yet; an announced adapter with no user means nobody is signed in.
  const [adapter, setAdapter] = useState(null);
  useEffect(() => subscribeAdapter(setAdapter), []);

  // Nobody is signed in. The plain fact, kept apart from what to DO about it.
  const signedOut = Boolean(adapter) && !adapter.user;

  // Whether to hand this frame the SCREEN, which is a different question from
  // whether anyone is signed in.
  //
  // Only an adapter that runs its own sign-in has anything to show: it opens
  // the CMS's login page itself (auth.begin) so the credential never passes
  // through the admin, and that has to happen in this frame. Adapters without
  // it — Plone, which takes the admin's token — have no flow to offer, and the
  // panel covered the admin's own login page with a button that could do
  // nothing: `[PROXY] auth.begin failed: NOT_IMPLEMENTED`, over the one
  // sign-in UI that worked, including the site's password-free demo option.
  //
  // Read from the announcement rather than probed, like every other decision
  // the admin makes about an adapter.
  const needsSignIn =
    Boolean(adapter) &&
    !adapter.user &&
    (adapter.capabilities ?? []).includes('adapter-sign-in');

  // Start the admin over once someone signs in.
  //
  // Everything the admin fetched while anonymous came back empty, and nothing
  // would refetch it: the contents listing had already decided it had no rows.
  // Since login precedes the editor there is no work to lose, and reloading
  // after signing in is what a user expects anyway.
  //
  // Guarded by a ref rather than reloading whenever a user appears, so a normal
  // authenticated start — credential already stored, no sign-in shown — does
  // not reload at all.
  //
  // Keyed on having BEEN signed out, not on this frame having offered the
  // sign-in: whichever surface was used, the stale anonymous reads are the
  // same. Keying it on the panel meant that gating the panel also silently
  // removed the reload, and a demo sign-in through the admin's own login page
  // landed in an editor whose content had been fetched as nobody.
  const wasSignedOut = useRef(false);
  useEffect(() => {
    if (signedOut) {
      wasSignedOut.current = true;
      return;
    }
    if (wasSignedOut.current && adapter?.user) {
      wasSignedOut.current = false;
      window.location.reload();
    }
  }, [signedOut, adapter]);

  // EVERY route, for the whole session. There is no condition here on purpose:
  // the moment this frame's presence depends on what the editor is doing, the
  // adapter's lifetime does too, and that is the coupling being removed.

  const frontendUrl =
    useSelector((state) => state.frontendPreviewUrl?.url) ||
    (isClient ? Cookies.get(getIframeUrlCookieName()) : null) ||
    getURlsFromEnv()[0]?.url;

  // The adapter runs on the FRONTEND's origin and needs the session to talk
  // to the CMS. The visible editing iframe receives it as a URL parameter;
  // without the same here, the adapter's whoami() fails, registration is
  // abandoned, ADAPTER_READY never fires, and every request sits queued
  // behind a gate that will not open.
  const token = useSelector((state) => state.userSession?.token);

  // Only meaningful in a bridge session, and only on the client: there is no
  // iframe at render time on the server.
  if (!config.settings.useBridgeBackend || !isClient || !frontendUrl) return null;

  // The frontend's own parameters (which adapter, which CMS) are carried over;
  // only the PAGE changes, to the one that hosts an adapter and renders
  // nothing. Addressed the way this frontend addresses any page — in the hash
  // when it is hash-routed, under its base path either way — because a
  // statically deployed canvas is both, and setting an absolute pathname
  // served it a 404 instead of an adapter.
  const src = proxyFrameUrl(
    new URL(frontendUrl, window.location.origin).toString(),
    token,
  );

  // The frontend reads window.name to learn it is inside Hydra and in WHICH
  // role, and an iframe inherits the name from this attribute at creation.
  //
  // "proxy", not "view": the proxy page serves the adapter and renders
  // nothing. A view-role frame would boot the whole frontend — router,
  // rendering, navigation detection — every part of which can move it.
  const adminOrigin =
    typeof window !== 'undefined' ? window.location.origin : '';

  // Hidden while it is only a transport; VISIBLE when it needs to sign in.
  //
  // The sign-in has to happen inside this frame: the credential must not pass
  // through the admin, and only a click in this frame gives it the user
  // activation to open the CMS's login window. Since login precedes the
  // editor, there is nothing to overlay — the login screen simply IS this
  // frame.
  const hidden = {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: 'none',
    border: 0,
  };
  const visible = {
    position: 'fixed',
    inset: 0,
    width: '100%',
    height: '100%',
    border: 0,
    zIndex: 9999,
    background: '#fff',
  };

  return (
    <iframe
      id="hydraProxyFrame"
      title={needsSignIn ? 'Sign in' : 'Hydra CMS proxy'}
      name={`hydra-proxy:${adminOrigin}`}
      src={src}
      aria-hidden={needsSignIn ? undefined : 'true'}
      tabIndex={needsSignIn ? undefined : -1}
      style={needsSignIn ? visible : hidden}
    />
  );
}
