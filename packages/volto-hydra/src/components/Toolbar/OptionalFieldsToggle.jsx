import React from 'react';
import { Icon } from '@plone/volto/components';
import showSVG from '@plone/volto/icons/show.svg';
import hideSVG from '@plone/volto/icons/hide.svg';

/**
 * Reveal the selected block's empty optional fields so they can be filled from
 * the canvas (issue #296).
 *
 * Replaces two per-block hacks: rendering an element even when empty (which leaks
 * an empty element into VIEW markup), and per-field `showButton`/`hideButton`
 * booleans whose only job is to expose another field.
 *
 * ONE toggle for the whole block, not a per-field menu. Per-field targeting buys
 * little, because reveal already collapses on deselect — fields the editor ignores
 * disappear on their own.
 *
 * Reveal is ALWAYS EXPLICIT: nothing is revealed on selection or on insert. The
 * button is rendered only when the block actually has something to reveal: an
 * empty field its frontend marked `optionalOnCanvas` (inka#765). An eye, not a
 * `+`, which reads as "add a block".
 *
 * @param {string} blockUid - block whose optional fields this toggles
 * @param {string[]} revealableFields - empty inline-editable fields (from BLOCK_SELECTED)
 * @param {boolean} revealed - are they currently revealed
 * @param {(blockUid: string) => void} onToggle
 */
/** What the reveal control says, on the toolbar and in the ⋯ menu alike. */
export const revealFieldsLabel = (revealableFields, revealed) =>
  revealed
    ? 'Hide empty fields'
    : `Show ${revealableFields.length} empty field${revealableFields.length === 1 ? '' : 's'}`;

export default function OptionalFieldsToggle({
  blockUid,
  revealableFields,
  revealed,
  onToggle,
}) {
  if (!revealableFields?.length && !revealed) return null;

  const title = revealFieldsLabel(revealableFields, revealed);

  return (
    <button
      type="button"
      className={`optional-fields-toggle${revealed ? ' revealed' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={revealed}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(blockUid);
      }}
    >
      <Icon name={revealed ? hideSVG : showSVG} size="18px" title={title} />
    </button>
  );
}
