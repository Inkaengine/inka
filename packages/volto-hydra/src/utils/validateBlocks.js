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

import { getChildFields } from '@volto-hydra/helpers';
import {
  blockFieldErrors,
  unstorableLinkFields,
} from '@volto-hydra/helpers/blockFieldErrors.js';

import { buildBlockPathMap, buildIdFieldMap, getBlockById } from './blockPath';
import { resolveEffectiveBlockSchema } from './blockSync';

// The page itself is validated against the PAGE schema by the form; it is in the
// path map as the root, and has no block schema of its own.
const PAGE_BLOCK = '_page';

/** What the author is told about a link the CMS can't store. */
export const UNSTORABLE_LINK_MESSAGE =
  "This link can't be saved: the editor holds it in a form the site can't store. Set the link again, or clear it.";

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
export function validateBlocksAgainstSchemas(
  formData,
  { blocksConfig, intl, formatMessage },
) {
  const blocksErrors = {};
  const fieldTitles = {};
  if (!formData || !blocksConfig)
    return { blocksErrors, fieldTitles, blockPathMap: {} };

  const blockPathMap = buildBlockPathMap(formData, blocksConfig, intl);
  const idFieldMap = buildIdFieldMap(blocksConfig, intl);

  for (const blockId of Object.keys(blockPathMap || {})) {
    if (blockId === PAGE_BLOCK) continue;

    const blockData = getBlockById(formData, blockPathMap, blockId);
    if (!blockData) continue;

    // A link the CMS can't store refuses the save here, on EVERY block —
    // readOnly or not, with a schema here or not — because the server refuses
    // it on every block: Plone's deserializer calls `.startswith` on each `@id`
    // in a block, and anything but a string ends the whole save with a 500 that
    // names no block ("'dict' object has no attribute 'startswith'").
    const badLinks = unstorableLinkFields(
      blockData,
      getChildFields(blockData, idFieldMap, { allObjectLists: true }),
    );

    const schema = resolveEffectiveBlockSchema(
      blockId,
      formData,
      blockPathMap,
      blocksConfig,
      intl,
    );
    const linkErrors = Object.fromEntries(
      badLinks.map((field) => [field, [UNSTORABLE_LINK_MESSAGE]]),
    );
    const report = (errors) => {
      if (Object.keys(errors).length === 0) return;
      blocksErrors[blockId] = errors;
      fieldTitles[blockId] = Object.fromEntries(
        Object.keys(errors).map((field) => [field, schema?.properties?.[field]?.title || field]),
      );
    };
    if (!schema?.properties) {
      report(linkErrors);
      continue;
    }

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
    if (blockData.readOnly === true) {
      report(linkErrors);
      continue;
    }

    // The same step the offline content check runs (@volto-hydra/helpers/blockFieldErrors.js):
    // Volto's validators, with cleared ('') fields read as unset, and a rule's
    // error on a region.
    const errors = blockFieldErrors({
      schema,
      blockData,
      validateFieldsPerFieldset: FormValidation.validateFieldsPerFieldset,
      formatMessage,
    });
    report({ ...errors, ...linkErrors });
  }

  return { blocksErrors, fieldTitles, blockPathMap };
}
