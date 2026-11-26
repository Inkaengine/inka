import { cloneBlocksForTranslation, sourceFingerprint } from '@volto-hydra/helpers';
import { buildIdFieldMap, getBlockTypeSchema } from './blockPath';

/**
 * The original's blocks, copied for a translator to work on: the page's
 * blocks field and its layout, every block under a new id.
 *
 * Through the container API, so a container's CHILDREN are copied under new
 * ids too. Volto's own loop renames only what blocks_layout lists, which
 * leaves every nested block sharing its id with the block it was copied from;
 * and a uid that names a block on two pages breaks selection, inline editing
 * and the bridge, all of which address blocks by uid. Each copy keeps
 * `@canonical`, the id it came from, and a fingerprint of what it was made
 * FROM, so the editor can later say which blocks the original has moved on
 * from. A type with no schema records nothing rather than a fingerprint over
 * fields we cannot tell apart.
 *
 * Needs the frontend's block definitions, so it runs in the editor once the
 * frontend has sent them, never on the Add form (Add.jsx).
 *
 * @returns {{ blocks: object, items: string[] }}
 */
export function copyTranslationBlocks(original, blocksConfig, intl, uuid) {
  const copied = cloneBlocksForTranslation(
    original.blocks || {},
    original.blocks_layout?.items || [],
    uuid,
    buildIdFieldMap(blocksConfig, intl),
    (sourceBlock, id, type) => {
      const schema = getBlockTypeSchema(type, intl, blocksConfig);
      return schema ? sourceFingerprint(sourceBlock, schema) : null;
    },
  );
  // Volto's copy also stamps each block's own `block` key with its uid.
  for (const [uid, block] of Object.entries(copied.blocks)) {
    block.block = uid;
  }
  return { blocks: copied.blocks, items: copied.layout };
}
