/**
 * A reusable "render this content in a frontend iframe" pane — the same
 * protocol the editor's canvas speaks, without the editor:
 *
 *   - the SAME url recipe (access token, _edit flag, hash-vs-path routing);
 *   - client-only mounting (an iframe SSR'd with a half-built window.name
 *     keeps it for the life of the browsing context, and hydra.js then posts
 *     INIT to an empty origin and dies);
 *   - content pushed as FORM_DATA **with a blockPathMap** (the bridge throws
 *     without one), pushed on iframe load with staggered nudges until the
 *     bridge is listening, and re-pushed on any INIT (reloads).
 *
 * Used twice by the compare view (one pane per version). Iframe/View.jsx —
 * today a singleton (fixed element id, module-level persistence, bound to the
 * page form) — is the intended future consumer of these same pieces.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import config from '@plone/volto/registry';
import {
  buildBlockPathMap,
  stripBlockPathMapForPostMessage,
} from '../../utils/blockPath';

const ViewPane = ({ title, src, content, style }) => {
  const ref = useRef(null);
  const intl = useIntl();
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const adminOrigin =
    typeof window !== 'undefined' ? window.location.origin : '';
  const iframeName = `hydra-view:${adminOrigin}`;

  useEffect(() => {
    if (!content) return undefined;
    const push = () => {
      const blockPathMap = stripBlockPathMapForPostMessage(
        buildBlockPathMap(content, config.blocks.blocksConfig, intl),
      );
      ref.current?.contentWindow?.postMessage(
        { type: 'FORM_DATA', data: content, blockPathMap },
        '*',
      );
    };
    const onMessage = (event) => {
      if (event.source !== ref.current?.contentWindow) return;
      if (event.data?.type !== 'INIT') return;
      push();
    };
    window.addEventListener('message', onMessage);
    let timers = [];
    if (frameLoaded) {
      // The iframe's own init is async after load — nudge until its bridge
      // listens (idempotent: identical content each time).
      timers = [0, 500, 1500, 3500].map((ms) => setTimeout(push, ms));
    }
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('message', onMessage);
    };
  }, [content, frameLoaded, intl]);

  if (!mounted) return null;
  return (
    <iframe
      ref={ref}
      title={title}
      name={iframeName}
      onLoad={() => setFrameLoaded(true)}
      src={src}
      style={style}
    />
  );
};

export default ViewPane;
