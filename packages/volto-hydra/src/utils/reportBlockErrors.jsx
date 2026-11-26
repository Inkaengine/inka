/**
 * Report blocks that refuse a save: one toast naming every block at fault, each
 * a link that opens it, and a jump to the first.
 *
 * The page save and a template's lock both use it, so a refusal looks and works
 * the same wherever it comes from.
 *
 * The link matters more than the wording: the block at fault is often one the
 * author cannot find — inside a template container, or scrolled out of view —
 * so "where is it" is the actual question to answer. Naming every block saves
 * discovering a second one only on the next try.
 */
import React from 'react';
import { toast } from 'react-toastify';
import Toast from '@plone/volto/components/manage/Toast/Toast';

import { getBlockById } from './blockPath';

/**
 * @param {Object} options
 * @param {Object} options.blocksErrors - blockId → { field: [messages] } for a
 *   block's own fields, or { _layout: { title, message } } for a template rule
 * @param {Object} options.formData - the data the block ids are found in
 * @param {Object} options.blockPathMap - its path map
 * @param {Object} options.blocksConfig - config.blocks.blocksConfig, for names
 * @param {Object} [options.fieldTitles] - blockId → { field: title }, since a
 *   region in error is not drawn as a widget
 * @param {Function} options.goToBlock - selects a block and shows its settings
 * @param {string} [options.title]
 */
export function reportBlockErrors({
  blocksErrors,
  formData,
  blockPathMap,
  blocksConfig,
  fieldTitles = {},
  goToBlock,
  title = "Can't save yet",
}) {
  const offenders = Object.keys(blocksErrors).map((blockId) => {
    const blockType = getBlockById(formData, blockPathMap, blockId)?.['@type'];
    const reasons = Object.entries(blocksErrors[blockId]).flatMap(
      ([field, err]) => {
        if (Array.isArray(err)) {
          const label = fieldTitles[blockId]?.[field] || field;
          return [`${label}: ${err.join(', ')}`];
        }
        return [err?.message || err?.title].filter(Boolean);
      },
    );
    return {
      blockId,
      name: blocksConfig?.[blockType]?.title || blockType,
      reasons,
    };
  });

  toast.error(
    <Toast
      error
      title={title}
      content={
        <div className="block-save-errors">
          {offenders.map(({ blockId, name, reasons }) => (
            <div key={blockId} className="block-save-error">
              <button
                type="button"
                className="block-save-error-link"
                onClick={() => {
                  goToBlock(blockId);
                  toast.dismiss();
                }}
              >
                {name ? `Open the ${name} block` : 'Open the block'}
              </button>
              {reasons.length > 0 && (
                <div className="block-save-error-why">{reasons.join('; ')}</div>
              )}
            </div>
          ))}
        </div>
      }
    />,
  );

  // Still jump to the first one, so the fix stays one click away even if the
  // toast is dismissed before it is read.
  goToBlock(offenders[0].blockId);
}
