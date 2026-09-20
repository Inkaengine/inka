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

const ViewPane = ({
  id,
  title,
  src,
  content,
  style,
  className,
  // A pane whose blocks may be SELECTED — to look at them — but never
  // changed. Not a third kind of frame: it is an ordinary editing one, and
  // every block of the content it is given is read-only, which is what stops
  // the bridge collecting a single editable field. See withAllBlocksReadOnly.
  selectable = false,
  onSelectBlock,
  // Show this block: the counterpart of whatever is selected next door. The
  // bridge scrolls it into view as part of selecting it, which is what makes
  // the two panes follow each other.
  showBlock = null,
}) => {
  const ref = useRef(null);
  // Latest-ref, so the push effect never re-runs just for a new closure — it
  // would re-push the content, and the frame would announce its selection
  // again.
  const onSelectBlockRef = useRef(onSelectBlock);
  onSelectBlockRef.current = onSelectBlock;
  const intl = useIntl();
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const adminOrigin =
    typeof window !== 'undefined' ? window.location.origin : '';
  const iframeName = `${selectable ? 'hydra-edit' : 'hydra-view'}:${adminOrigin}`;

  useEffect(() => {
    if (!content) return undefined;
    const push = () => {
      const blockPathMap = stripBlockPathMapForPostMessage(
        buildBlockPathMap(content, config.blocks.blocksConfig, intl),
      );
      // INITIAL_DATA, not FORM_DATA: only INITIAL_DATA completes the
      // handshake. The bridge marks itself initialised there — "block
      // selection is now allowed" — and stops retrying its INIT. A pane fed
      // FORM_DATA alone rendered the content but stayed forever
      // un-acknowledged: it retried INIT for the life of the page, showed the
      // bridge diagnostic, and reported nothing the editor clicked.
      ref.current?.contentWindow?.postMessage(
        {
          type: 'INITIAL_DATA',
          data: content,
          blockPathMap,
          slateConfig: {
            hotkeys: config.settings.slate?.hotkeys || {},
            toolbarButtons: config.settings.slate?.toolbarButtons || [],
          },
        },
        '*',
      );
    };
    const onMessage = (event) => {
      if (event.source !== ref.current?.contentWindow) return;
      if (event.data?.type === 'BLOCK_SELECTED') {
        // `blockUid`, which is what the bridge calls it.
        onSelectBlockRef.current?.(event.data.blockUid);
        return;
      }
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

  useEffect(() => {
    if (!selectable || !frameLoaded) return;
    ref.current?.contentWindow?.postMessage(
      { type: 'SELECT_BLOCK', uid: showBlock, method: 'select' },
      '*',
    );
  }, [showBlock, selectable, frameLoaded]);

  if (!mounted) return null;
  return (
    <iframe
      ref={ref}
      id={id}
      className={className}
      title={title}
      name={iframeName}
      onLoad={() => setFrameLoaded(true)}
      src={src}
      style={style}
    />
  );
};

export default ViewPane;
