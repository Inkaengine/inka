/**
 * BlockPickerWidget — pick a block, store a FIELD VALUE from it.
 *
 * The author chooses a block; what gets written is one named field of that
 * block. Usually that is its id, but it does not have to be — `valueField` says
 * which field to take, and any field of the chosen block will do.
 *
 * Not the same job as `schemaFieldSelect`, which offers the CONTENT TYPE's
 * schema fields from `/@types`. This offers blocks on the page, read from
 * `blockPathMap` — the same container/region map the editor uses.
 *
 * The motivating case is a form's skip logic: "show this question when THAT one
 * is answered". The author should pick the other question by its label; what
 * gets stored is that question's `field_id`, because that is what the rule is
 * evaluated against — a uid would look right in the sidebar and never match.
 *
 * Field options (alongside `widget: 'blockPicker'`):
 *   - scope: 'siblings' (default) — blocks sharing my parent
 *            '..'                 — my parent's siblings
 *            '<region>'           — that region of my parent
 *   - direction: 'before' | 'after' — only blocks earlier/later than me. A
 *       question cannot depend on one that comes after it, so skip logic uses
 *       'before'.
 *   - blockTypes: ['text', 'select'] — only these `@type`s.
 *   - valueField: 'field_id' — WHICH field of the chosen block to store.
 *       Defaults to the block's own id, but the point of the option is that the
 *       useful value often lives in another field: a form question is referred
 *       to by its `field_id`, because that is the name its answer arrives
 *       under.
 *   - labelField: 'label' — the field to SHOW. Falls back to title, then label,
 *       then the block type, then the id.
 *   - emptyLabel: the first, empty option's text.
 */
import React from 'react';
import { defineMessages, useIntl } from 'react-intl';
import config from '@plone/volto/registry';
import { blockDisplayTitle } from '../../utils/blockDisplayTitle';

const messages = defineMessages({
  none: {
    id: 'no block selected',
    defaultMessage: '— none —',
  },
});
import { useHydraSchemaContext } from '../../context/HydraSchemaContext';
import { getBlockById } from '../../utils/blockPath';

/** The blocks a picker may offer, in page order, given where it is asked from. */
export function candidateBlockIds({
  blockPathMap,
  currentBlockId,
  scope = 'siblings',
  direction,
}) {
  const me = blockPathMap?.[currentBlockId];
  if (!me) return [];
  // '..' asks about my parent's neighbours, so the parent whose children we
  // list is my grandparent.
  const parentId =
    scope === '..' ? blockPathMap[me.parentId]?.parentId : me.parentId;
  const anchorId = scope === '..' ? me.parentId : currentBlockId;
  if (parentId === undefined) return [];

  const siblings = Object.entries(blockPathMap)
    .filter(([, info]) => info.parentId === parentId)
    .filter(([, info]) =>
      scope && scope !== 'siblings' && scope !== '..'
        ? info.region === scope
        : true,
    );

  // Page order: the path's last segment is the position within the parent.
  const ordered = siblings.sort((a, b) => positionOf(a[1]) - positionOf(b[1]));
  const ids = ordered.map(([id]) => id);
  const at = ids.indexOf(anchorId);
  // `direction` is relative to me, so not finding myself among my own siblings
  // means there is no "before" to compute. Offering the whole list instead —
  // what this did — is the worst answer available: a menu that looks right,
  // lets an author pick a question that comes AFTER this one, and produces a
  // rule that can never be met. Offer nothing, so the emptiness is visible.
  if (direction && at === -1) return [];
  const trimmed =
    direction === 'before'
      ? ids.slice(0, at)
      : direction === 'after'
        ? ids.slice(at + 1)
        : ids;
  return trimmed.filter((id) => id !== currentBlockId);
}

function positionOf(info) {
  const last = info?.path?.[info.path.length - 1];
  const n = Number(last);
  return Number.isFinite(n) ? n : 0;
}

/** What a block should be called in the menu. */
/**
 * What one candidate reads as in the menu.
 *
 * Deferred to the shared namer, so a block is called the same thing here as in
 * the sidebar's child list — `labelField` only nominates where this kind of
 * block keeps its name.
 */
export function labelFor(block, labelField) {
  if (!block) return '';
  return blockDisplayTitle(block, { labelField, fallback: block.field_id });
}

const BlockPickerWidget = (props) => {
  const {
    scope = 'siblings',
    direction,
    blockTypes,
    valueField,
    labelField,
    emptyLabel,
  } = props;
  const intl = useIntl();
  const ctx = useHydraSchemaContext();
  const { blockPathMap, currentBlockId, formData } = ctx || {};

  const ids = candidateBlockIds({
    blockPathMap,
    currentBlockId,
    scope,
    direction,
  });

  const choices = [
    // A schema-supplied `emptyLabel` is the author's own wording ("— always
    // show —") and is used as written; only our default is translated.
    ['', emptyLabel || intl.formatMessage(messages.none)],
    ...ids
      .map((id) => ({ id, block: getBlockById(formData, blockPathMap, id) }))
      .filter(({ block }) => block)
      .filter(({ block }) =>
        blockTypes?.length ? blockTypes.includes(block['@type']) : true,
      )
      .map(({ id, block }) => [
        // What to STORE: a named field of the chosen block (a form question's
        // `field_id`), or the block's own id when the consumer wants that.
        valueField ? block[valueField] ?? id : id,
        labelFor(block, labelField),
      ])
      .filter(([value, label]) => value !== '' && label !== ''),
  ];

  const SelectWidget = config.widgets.widget.select;
  return <SelectWidget {...props} choices={choices} />;
};

export default BlockPickerWidget;
