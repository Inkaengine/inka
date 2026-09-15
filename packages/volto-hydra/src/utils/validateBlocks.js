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
 * @returns {{ blocksErrors: Object }} blockId → { fieldName: [messages] }
 */
export function validateBlocksAgainstSchemas(
  formData,
  { blocksConfig, intl, formatMessage },
) {
  const blocksErrors = {};
  if (!formData || !blocksConfig) return { blocksErrors };

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

    const errors = FormValidation.validateFieldsPerFieldset({
      schema,
      formData: blockData,
      formatMessage,
    });
    if (Object.keys(errors).length > 0) {
      blocksErrors[blockId] = errors;
    }
  }

  return { blocksErrors };
}
