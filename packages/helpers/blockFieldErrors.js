/**
 * One block's field errors, as the editor's save finds them.
 *
 * The save (volto-hydra utils/validateBlocks.js) and the offline content check
 * (@inka/content-validator) both call this, each with Volto's
 * `validateFieldsPerFieldset`: the editor's own, and the check's bundled copy
 * of it (scripts/build-volto-validation.mjs). So what a block is checked
 * against, and what it is handed, is one piece of code — the check refuses
 * what the save refuses (validateBlocks.parity.test.js).
 *
 * No imports: the content check loads this in a bare Node.
 */

/**
 * The field types a fieldRules `error` is surfaced on. Volto picks a
 * validator by the field's type, so the rule's validator is registered for each.
 */
export const RULE_ERROR_FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object'];

/**
 * Surface a field rule's `error` as a form error.
 *
 * `evaluateFieldRule` puts the message on the field DEFINITION when the rule
 * matches; this is what turns that into the things an author sees — the widget
 * red, the form's error summary, and a blocked save — all of which are Volto's
 * own, keyed on the field. Nothing here decides anything: the rule already did.
 */
export const hydraRuleErrorValidator = ({ field }) => field?.hydraRuleError || null;

/** Register the rule validator in a Volto config (the editor's, or the check's). */
export function registerRuleErrorValidators(config) {
  for (const fieldType of RULE_ERROR_FIELD_TYPES) {
    config.registerUtility({
      name: `hydraRuleError-${fieldType}`,
      type: 'validator',
      dependencies: { fieldType },
      method: hydraRuleErrorValidator,
    });
  }
}

/**
 * Drop fields set to an empty string, so they read as NOT SET.
 *
 * Volto's checkFieldErrors skips a field only when it is `undefined` or `null`:
 *
 *     fieldData === undefined || fieldData === null ? null : criterion.method(...)
 *
 * So an empty string reaches the format validators — and an empty string is
 * not a valid url, nor a valid email. An image block whose image was never set,
 * or was CLEARED (which is how the field becomes ''), therefore reports "Input
 * must be valid url", and no value the author can type will satisfy it short of
 * a real url. Clearing the field is the very thing that triggers the error,
 * which is why it cannot be cleared away. This refused a save on a production
 * page, on a block the author could not reach.
 *
 * "Not set" and "set to nonsense" are different, and only the second is an
 * error. Required-ness is unaffected: validateRequiredFields walks the schema's
 * `required` list and treats a missing field exactly as it treats '', so a
 * field that genuinely must be filled still reports — pinned by tests.
 *
 * Scoped to blocks. The same shape sits under Volto's content-field
 * validation, where an empty url or email content field behaves the same way;
 * fixing that is a core change.
 */
export function withUnsetFieldsOmitted(blockData) {
  const out = {};
  for (const [key, value] of Object.entries(blockData)) {
    if (value === '') continue;
    out[key] = value;
  }
  return out;
}

/**
 * @param {Object} args
 * @param {Object} args.schema - the block's EFFECTIVE schema (its enhancer applied)
 * @param {Object} args.blockData - the block as stored
 * @param {Function} args.validateFieldsPerFieldset - Volto's FormValidation.validateFieldsPerFieldset
 * @param {Function} args.formatMessage - intl.formatMessage
 * @returns {Object} fieldName → [messages]; empty when the block may be saved
 */
export function blockFieldErrors({ schema, blockData, validateFieldsPerFieldset, formatMessage }) {
  const errors = validateFieldsPerFieldset({
    schema,
    formData: withUnsetFieldsOmitted(blockData),
    formatMessage,
  });
  // A rule's error on a REGION. Volto runs a field's validators only when
  // `formData[field]` holds a value, and a blocks_layout region's children are
  // not there — they are in `blocks_layout[region]` — so a rule counting them
  // ("a set of at least two") had its message on the field and nothing read
  // it: the content validator reported it, the editor saved anyway. Only where
  // Volto skipped the field, so a valued field is not told twice.
  for (const [fieldName, field] of Object.entries(schema.properties || {})) {
    if (field?.hydraRuleError && blockData[fieldName] == null && !errors[fieldName]) {
      errors[fieldName] = [field.hydraRuleError];
    }
  }
  return errors;
}
