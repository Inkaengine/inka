/**
 * Validate every block on the page against its EFFECTIVE schema.
 *
 * Volto's own Form does this on submit, and hydra's Form — which replaces
 * BlocksForm with the canvas — lost it: the shadow kept the machinery that
 * REPORTS block errors (blocksErrors, the jump to the offending block, the
 * sidebar tab) and had only one thing producing them, template placeholder
 * contiguity. So a block's `required`, `maxLength`, `pattern` — every validator
 * Volto has — went unenforced at save time, silently.
 *
 * It is not a port of core's loop, because core's would be wrong here. Core
 * walks `blocks_layout.items`, which is the TOP level: a text block inside a
 * column inside a grid is never visited. Hydra's blocks nest, so this walks the
 * blockPathMap — every block wherever it lives — and resolves each one's
 * schema through resolveEffectiveBlockSchema, which applies the block's
 * schemaEnhancer (including recipe objects that arrived from the frontend over
 * postMessage, and the dynamic `required` a `when` rule leaves behind).
 */
import { FormValidation } from '@plone/volto/helpers';

import { buildBlockPathMap, getBlockById } from './blockPath';
import { resolveEffectiveBlockSchema } from './blockSync';

// The page itself is validated against the PAGE schema by the form; it is in the
// path map as the root, and has no block schema of its own.
const PAGE_BLOCK = '_page';

/**
 * @param {Object} formData - the whole page's form data
 * @param {Object} options
 * @param {Object} options.blocksConfig - config.blocks.blocksConfig
 * @param {Object} options.intl - react-intl object (for schema resolution)
 * @param {Function} options.formatMessage - intl.formatMessage
 * @returns {{ blocksErrors: Object, fieldTitles: Object }}
 *   blocksErrors: blockId → { fieldName: [messages] };
 *   fieldTitles: blockId → { fieldName: title } for each field in error, so a
 *   refused save can name it (a region is not drawn as a widget).
 *   blockPathMap: the map already built here, so a caller reporting the errors
 *   can look the offending blocks up — their type, to name them — without
 *   building a second one, and without reaching into formData.blocks, which
 *   misses every nested block.
 */
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
 * Scoped to blocks, the walk this module owns. The same shape sits under
 * Volto's content-field validation, where an empty url or email content field
 * behaves the same way; fixing that is a core change.
 */
function withUnsetFieldsOmitted(blockData) {
  const out = {};
  for (const [key, value] of Object.entries(blockData)) {
    if (value === '') continue;
    out[key] = value;
  }
  return out;
}

export function validateBlocksAgainstSchemas(
  formData,
  { blocksConfig, intl, formatMessage },
) {
  const blocksErrors = {};
  const fieldTitles = {};
  if (!formData || !blocksConfig)
    return { blocksErrors, fieldTitles, blockPathMap: {} };

  const blockPathMap = buildBlockPathMap(formData, blocksConfig, intl);

  for (const blockId of Object.keys(blockPathMap || {})) {
    if (blockId === PAGE_BLOCK) continue;

    const schema = resolveEffectiveBlockSchema(
      blockId,
      formData,
      blockPathMap,
      blocksConfig,
      intl,
    );
    if (!schema?.properties) continue;

    const blockData = getBlockById(formData, blockPathMap, blockId);
    if (!blockData) continue;

    // A template-owned block is readOnly: the author is shown static values
    // rather than widgets and cannot change a single field on it. Validating it
    // lets one bad value in one template refuse the save on EVERY page using
    // that template, naming a field the author has no way to reach — which is
    // exactly what happened to 43 case studies when a `widget: 'url'` field
    // held the site-relative "/case-studies" that Volto's URL validator
    // rejects. A page that merely uses a template must stay saveable.
    //
    // The value still gets validated where it can be fixed: editing the
    // template itself, whose own blocks are deliberately not readOnly (see
    // inheritFixed in blockPath.js — inheriting it would freeze inline editing
    // of a template page).
    //
    // `fixed` alone is NOT enough to skip. A fixed-but-editable block is the
    // page's own: the merge keeps all of its fields, so its values are the
    // author's to correct and must still be enforced.
    if (blockData.readOnly === true) continue;

    const errors = FormValidation.validateFieldsPerFieldset({
      schema,
      formData: withUnsetFieldsOmitted(blockData),
      formatMessage,
    });
    // A rule's error on a REGION. Volto runs a field's validators only when
    // `formData[field]` holds a value, and a blocks_layout region's children
    // are not there — they are in `blocks_layout[region]` — so a rule counting
    // them ("a set of at least two") had its message on the field and nothing
    // read it: the content validator reported it, the editor saved anyway.
    // Only where Volto skipped the field, so a valued field is not told twice.
    for (const [fieldName, field] of Object.entries(schema.properties)) {
      if (field?.hydraRuleError && blockData[fieldName] == null && !errors[fieldName]) {
        errors[fieldName] = [field.hydraRuleError];
      }
    }
    if (Object.keys(errors).length > 0) {
      blocksErrors[blockId] = errors;
      fieldTitles[blockId] = Object.fromEntries(
        Object.keys(errors).map((field) => [field, schema.properties[field]?.title || field]),
      );
    }
  }

  return { blocksErrors, fieldTitles, blockPathMap };
}
