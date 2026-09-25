/**
 * ReadOnlyForm — renders a Volto schema's fields as static, read-only values
 * (label + text) instead of editable widgets.
 *
 * Used wherever the sidebar shows a form that must NOT be editable — the locked
 * template settings, and a read-only (fixed/readonly) template block's own
 * settings. This is deliberately NOT a per-widget "view mode": Volto's Field only
 * supports hidden vs. normal, and most widgets only support `disabled` (a greyed
 * input). Rather than shadow every widget, this ONE component formats a value by
 * looking at its field schema (type / widget / choices) and renders it as text —
 * covering the common field types, with a plain-text fallback for anything else
 * so a value is never rendered as an editable control.
 *
 * The `.field-wrapper-<id>` / `.field` class names mirror Volto's FormFieldWrapper
 * so styling and existing selectors keep working.
 */
import React from 'react';
import PropTypes from 'prop-types';
import { slateNodesText } from '@volto-hydra/helpers';

const EMPTY = '—';

/**
 * Format a single field's value as a read-only string, using its schema to pick
 * the right representation (choice label, yes/no, linked title, slate text, …).
 */
export function formatReadOnlyValue(fieldSchema = {}, value) {
  if (value === null || value === undefined || value === '') return EMPTY;

  // choices/select → the human label for the stored value, not the raw value
  if (Array.isArray(fieldSchema.choices)) {
    const match = fieldSchema.choices.find(([v]) => v === value);
    if (match) return match[1] ?? String(value);
  }

  // boolean → Yes / No
  if (fieldSchema.type === 'boolean' || typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  // object_browser (link / folder / image) → the linked item's title or @id
  if (fieldSchema.widget === 'object_browser') {
    const items = Array.isArray(value) ? value : [value];
    const labels = items
      .map((it) => (typeof it === 'string' ? it : it?.title || it?.['@id'] || ''))
      .filter(Boolean);
    return labels.length ? labels.join(', ') : EMPTY;
  }

  if (Array.isArray(value)) {
    // Slate value (array of nodes) → its plain text
    if (
      value.length &&
      typeof value[0] === 'object' &&
      value[0] !== null &&
      ('children' in value[0] || 'type' in value[0])
    ) {
      return slateNodesText(value) || EMPTY;
    }
    // A plain list of scalars/objects
    const parts = value
      .map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : String(v)))
      .filter((s) => s !== '');
    return parts.length ? parts.join(', ') : EMPTY;
  }

  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Collect the field ids from a schema's fieldsets, skipping container fields. */
function collectFieldIds(schema) {
  const ids = [];
  for (const fieldset of schema.fieldsets || []) {
    for (const id of fieldset.fields || []) {
      const def = schema.properties?.[id];
      if (!def) continue;
      if (def.widget === 'blocksid_list' || def.widget === 'object_list') continue;
      ids.push(id);
    }
  }
  return ids;
}

/**
 * ONE field, as label + text.
 *
 * Both callers are the same idea at different scale: a whole form that may be
 * read but not changed (a locked template, a compared language), and a single
 * field in an otherwise editable form that has its value from somewhere else
 * (a language-independent field on a translation). The shadowed Form renders
 * this for a field whose schema says `readOnly`, the same flag a locked block
 * carries.
 */
export function ReadOnlyField({ id, schema = {}, value }) {
  const languageIndependent =
    schema.multilingual_options?.language_independent;
  return (
    <div
      className={[
        `field-wrapper-${id}`,
        'field',
        'readonly-field',
        // Same name Volto uses, so its icon/label styling still applies — but
        // here the field is genuinely not editable, not faded with
        // `pointer-events: none`.
        languageIndependent ? 'language-independent-field' : null,
      ]
        .filter(Boolean)
        .join(' ')}
      // Compact: label + value on ONE line (no help/description text in read-only).
      style={{ display: 'flex', gap: '8px', alignItems: 'baseline', padding: '4px 0', margin: 0 }}
    >
      <label
        className="readonly-field-label"
        style={{ fontSize: '0.85em', color: '#878f93', flexShrink: 0 }}
      >
        {schema.title || id}
      </label>
      <div
        className="readonly-field-value"
        style={{ flex: 1, textAlign: 'right', wordBreak: 'break-word' }}
      >
        {formatReadOnlyValue(schema, value)}
      </div>
    </div>
  );
}

ReadOnlyField.propTypes = {
  id: PropTypes.string.isRequired,
  schema: PropTypes.object,
  value: PropTypes.any,
};

export function ReadOnlyForm({ schema, formData, title }) {
  if (!schema) return null;
  const fieldIds = collectFieldIds(schema);
  return (
    <div className="readonly-form">
      {(title || schema.title) && (
        <h2 className="readonly-form-title">{title || schema.title}</h2>
      )}
      {fieldIds.map((id) => (
        <ReadOnlyField
          key={id}
          id={id}
          schema={schema.properties[id]}
          value={formData?.[id]}
        />
      ))}
    </div>
  );
}

ReadOnlyForm.propTypes = {
  schema: PropTypes.object,
  formData: PropTypes.object,
  title: PropTypes.string,
};

export default ReadOnlyForm;
