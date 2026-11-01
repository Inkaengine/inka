/**
 * CopyFromTargetField — the wrapper the copy-from-target enhancer swaps mapped
 * destination fields to. It renders the field's ORIGINAL widget untouched
 * (that's why it works for any field type — object_browser, textarea, select…)
 * and adds a small owned-by-the-link ⇄ the-author's toggle beneath it.
 *
 * A mapped field is pulled only when the block SAYS a link owns it, in
 * `_pullFrom`: then it tracks the linked target — pulled on block select and
 * re-pulled when the target (href) changes. Editing the field, or unticking the
 * toggle, claims it: the field leaves the record and keeps its value.
 * Re-ticking hands it back and re-pulls. A block that says nothing is the
 * author's throughout (inka#595).
 *
 * The enhancer stashes the original field def under `baseWidget`; we restore it
 * and resolve the real widget with Volto's own resolution order so the base
 * renders exactly as it always would.
 */
import React, { useEffect } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Icon } from '@plone/volto/components';
import config from '@plone/volto/registry';
import { isInternalURL } from '@plone/volto/helpers/Url/Url';
import linkSVG from '@plone/volto/icons/link.svg';
import unlinkSVG from '@plone/volto/icons/unlink.svg';
import { useHydraSchemaContext, getLiveBlockData } from '../../context';
import {
  getTargetId,
  getTargetValueForField,
  isFieldLinked,
  withFieldNotPulled,
  withFieldPulled,
  sourceFieldFor,
  getSourceField,
  pullLinkedFields,
  linkPickedFields,
} from '../../utils/copyFromTarget';

// No live @search: the pick stores the full item metadata (metadata_fields:'_all')
// into the link snapshot, so every mapped field pulls straight from that snapshot.

const messages = defineMessages({
  linked: {
    id: 'pull from linked',
    defaultMessage: 'pull from linked',
  },
  linkedHint: {
    id: 'Pulls from the linked content; edit or untick to customise',
    defaultMessage: 'pulls from the linked content — edit to customise',
  },
});

/**
 * Resolve the real widget component for a field def, mirroring Volto's
 * Field.jsx resolution order (id → tagged → name → choices → vocabulary →
 * factory → type → default). Kept faithful so the base widget renders
 * identically to a normal field.
 */
function resolveWidget(props) {
  const widgets = config.widgets;
  const byId = widgets.id[props.id];
  if (byId) return byId;
  const tagged = props.widgetOptions?.frontendOptions?.widget;
  if (typeof tagged === 'string' && widgets.widget[tagged]) {
    return widgets.widget[tagged];
  }
  if (typeof props.widget === 'string') {
    return widgets.widget[props.widget] || widgets.default;
  }
  const vocab = props.vocabulary?.['@id'];
  if (vocab) {
    const w = widgets.vocabulary[vocab.replace(/^.*\/@vocabularies\//, '')];
    if (w) return w;
  }
  if (props.factory && widgets.factory?.[props.factory]) {
    return widgets.factory[props.factory];
  }
  if (props.type && widgets.type[props.type]) return widgets.type[props.type];
  return widgets.default;
}

const CopyFromTargetField = (props) => {
  const intl = useIntl();
  const { baseWidget, ...rest } = props;

  // Block-level context + a block-level updater (so we can write the block's
  // `_pullFrom` record, which a plain field onChange can't reach).
  const ctx = useHydraSchemaContext?.() || {};
  const blockData = getLiveBlockData?.(ctx.currentBlockId) || ctx.formData || null;
  const blockConfig = blockData?.['@type']
    ? ctx.blocksConfig?.[blockData['@type']]
    : null;
  const updateBlock = (newData) => ctx.onChangeBlock?.(ctx.currentBlockId, newData);

  // The target snapshot lives on the link field (metadata_fields:'_all' at pick
  // time), so the value a linked field pulls to comes straight from it.
  const targetId =
    blockConfig && blockData && getTargetId(blockConfig, blockData, props.id);
  // Only an INTERNAL link is a pull source: an external URL has no catalog item,
  // so the field falls back to a plain editable field (no toggle).
  const targetSupported = !!targetId && isInternalURL(targetId);

  const linked =
    targetSupported &&
    !!blockConfig &&
    !!blockData &&
    isFieldLinked(props.id, blockConfig, blockData);
  const targetValue = getTargetValueForField(props.id, blockConfig, blockData);

  // PULL (reactive): when the SELECTED block's link changes (canvas or sidebar) or
  // a field is re-linked, fill every linked field from the snapshot in ONE
  // block-level, idempotent write (settled block → same ref → no-op). Page open is
  // handled by the `pullAllLinkedFields` pass in View; this covers editing. The
  // snapshot already carries full metadata (the pick/type stored it) — no @search.
  // Deferred a frame so the form's initial data re-derivation doesn't discard it.
  useEffect(() => {
    if (!targetSupported || !blockConfig || !blockData) return undefined;
    // A link picked in the SIDEBAR lands as a plain field change, which no
    // wrapper sees — so the same rule the canvas pick applies runs here: a link
    // nothing has been said about takes the empty mapped fields.
    const pulled = pullLinkedFields(blockConfig, linkPickedFields(blockConfig, blockData));
    if (pulled === blockData) return undefined;
    const raf = requestAnimationFrame(() => updateBlock(pulled));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSupported, JSON.stringify(blockData)]);

  // EDIT: editing a LINKED field CLAIMS it — the field leaves `_pullFrom`,
  // keeping the typed value. The sidebar edit is only visible HERE (the widget
  // lives in the sidebar form, not View), and the release must be part of THIS
  // update — a reactive after-the-fact release re-renders mid-type and moves the
  // cursor. It's the same rule the inline and image/link paths apply by
  // value-compare; the widget just already knows the field. An unowned field
  // edits normally.
  const onFieldChange = (id, value) => {
    if (linked) {
      updateBlock({ ...withFieldNotPulled(blockData, props.id), [props.id]: value });
    } else {
      props.onChange?.(id, value);
    }
  };

  // TOGGLE: owned ⇄ the author's. Unticking releases the field (its value stays);
  // re-ticking hands it back to the link and re-pulls. Re-ticking has to name the
  // source again, since the field no longer carries one — the block's own record
  // first (another field may still name it), then the declared source.
  const onToggle = () => {
    if (linked) {
      updateBlock(withFieldNotPulled(blockData, props.id));
    } else {
      const linkField =
        sourceFieldFor(props.id, blockData) || getSourceField(blockConfig);
      if (!linkField) return;
      let next = withFieldPulled(blockData, props.id, linkField);
      if (targetValue !== undefined) next = { ...next, [props.id]: targetValue };
      updateBlock(next);
    }
  };

  // Restore the original field def; reset `widget` (else resolveWidget recurses
  // into this wrapper) and intercept onChange for the edit→custom flip.
  const baseProps = {
    ...rest,
    ...(baseWidget || {}),
    widget: baseWidget?.widget,
    onChange: onFieldChange,
  };
  const BaseWidget = resolveWidget(baseProps);

  // Icon-only toggle: a checkbox + 🔗, the meaning carried by the hover tooltip.
  // Ticked = linked (pulls from the linked content); untick to customise.
  const hint = intl.formatMessage(messages.linkedHint);
  // Offer the toggle only for a supported (internal) target — an external URL
  // can't be pulled from, so the field is just a normal editable field.
  const showToggle = targetSupported;

  // The toggle sits at the top-right of the field row (the end of the input line),
  // not on a line of its own — a single click-to-toggle icon (no checkbox), using
  // Volto's own link / unlink icons: linked = tracking the target, unlinked =
  // custom. Meaning in the tooltip; `aria-pressed` exposes the state to AT/tests.
  return (
    <div style={{ position: 'relative' }} className="copy-from-target-field">
      <BaseWidget {...baseProps} />
      {showToggle ? (
        <button
          type="button"
          className="copy-from-target-toggle copy-from-target-linked"
          aria-pressed={linked}
          onClick={onToggle}
          title={hint}
          aria-label={hint}
          style={{
            position: 'absolute',
            top: '0',
            right: '0',
            border: 'none',
            background: 'none',
            padding: '2px',
            cursor: 'pointer',
            lineHeight: 0,
          }}
        >
          <Icon
            name={linked ? linkSVG : unlinkSVG}
            size="18px"
            color={linked ? '#684cc9' : '#999'}
          />
        </button>
      ) : null}
    </div>
  );
};

export default CopyFromTargetField;
