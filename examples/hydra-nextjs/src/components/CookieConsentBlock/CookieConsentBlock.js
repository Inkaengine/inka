"use client";
import { useState } from "react";

/**
 * One block drawn in three places, two of them hidden.
 *
 * The bar is the block's own element and is always on screen; the `message` is
 * read in a BANNER and the `analyticsPurpose` beside a tick box in a PREFERENCES
 * DIALOG. Both sit OUTSIDE the block's element — a real frontend portals them to
 * <body>, where a design system's own JavaScript puts them — and both are hidden
 * until their trigger is pressed.
 *
 * So "is the block visible?" answers nothing here, and one handle cannot serve
 * two halves: each trigger names the FIELD its half holds, and the bridge opens
 * the half whose field the author reached for in the sidebar.
 */
// SlateNodes is handed in rather than imported: it lives inside BlocksList,
// and `message` needs it — a flat toString would drop the data-node-id the
// bridge syncs the cursor to.
export default function CookieConsentBlock({ id, block, SlateNodes }) {
  const [showBanner, setShowBanner] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  return (
    <>
      <div
        data-block-uid={id}
        className="cookie-consent-bar"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem",
          background: "#f4f4f6",
          border: "1px solid #ddd",
          borderRadius: "6px",
        }}
      >
        <strong>Cookie consent</strong>
        <button
          type="button"
          data-block-selector={`${id}#message`}
          data-linkable-allow
          onClick={() => setShowBanner(true)}
        >
          Show the banner
        </button>
        <button
          type="button"
          data-block-selector={`${id}#analyticsPurpose`}
          data-linkable-allow
          onClick={() => setShowDialog(true)}
        >
          Show cookie preferences
        </button>
      </div>

      {/* Outside the block's element, and annotated where the text is READ.
          Each half advertises the field it holds as well: without that the
          wording inside belongs to no block, and is not editable. The bar's
          trigger is what the bridge clicks — this is hidden until it opens. */}
      <div
        className="cookie-banner"
        data-block-selector={`${id}#message`}
        hidden={!showBanner}
        role="alert"
      >
        <div data-edit-text="message">
          <SlateNodes value={block.message || []} />
        </div>
        <button type="button" onClick={() => setShowBanner(false)}>
          Accept all
        </button>
      </div>

      <div
        className="cookie-dialog"
        data-block-selector={`${id}#analyticsPurpose`}
        hidden={!showDialog}
        role="dialog"
      >
        <h2>Manage cookie preferences</h2>
        <label>
          <input type="checkbox" name="analytics" /> Analytics
        </label>
        <p data-edit-text="analyticsPurpose">{block.analyticsPurpose}</p>
        <button type="button" onClick={() => setShowDialog(false)}>
          Save
        </button>
      </div>
    </>
  );
}
