"use client";

/**
 * The proxy frame: this frontend's CMS adapter, and nothing else.
 *
 * The admin holds no CMS credentials and never talks to the CMS itself. It
 * mounts this page once, in a hidden iframe named `hydra-proxy:<admin origin>`,
 * and sends every CMS request here; the adapter answers them. It stays mounted
 * for the whole session, whatever the editor is looking at — which is why it is
 * a route of its own rather than part of the page being edited. (The root
 * layout's header renders around it, invisibly; initBridge lives in the
 * catch-all's PageClient, so nothing else here talks to the admin.)
 *
 * This site is backed by Plone, so it hosts a PloneAdapter, pointed at the same
 * backend the site renders from. The admin hands over the session it already has
 * as ?access_token=, read on every request so a renewed token is picked up. A
 * frontend on another CMS would construct that CMS's adapter here instead;
 * nothing in the admin changes.
 */
import { useEffect } from "react";
import { connectProxy } from "#utils/hydra";
import { PloneAdapter } from "@volto-hydra/hydra-adapters-plone";

export default function HydraProxy() {
  useEffect(() => {
    const cmsBaseUrl = process.env.NEXT_PUBLIC_BACKEND_BASE_URL;
    if (!cmsBaseUrl) {
      throw new Error(
        "[hydra-proxy] NEXT_PUBLIC_BACKEND_BASE_URL is not set, so this frontend " +
          "does not know which CMS its adapter should talk to.",
      );
    }
    const token = new URLSearchParams(window.location.search).get("access_token");
    // connectProxy connects once per frame, so React's double-invoked effect in
    // development reuses the first bridge rather than building a second.
    connectProxy(
      new PloneAdapter({ cmsBaseUrl, getAuthToken: () => token }),
      { cmsBaseUrl },
    );
  }, []);
  return null;
}
