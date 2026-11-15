/**
 * The blocks Inka itself provides. Every other block a site uses is its
 * frontend's to declare (its blocks config, sent at initBridge).
 *
 * `slate`: the rich text every region's text is written in. Its schema (the
 * `value` field the bridge and the text editor work on) is Inka's, so a
 * frontend adds rules to it but never declares it.
 */
export const INKA_BLOCK_TYPES = ['slate'];
