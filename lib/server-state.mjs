/**
 * Page fields that are NOT carried: server state, or derived from the tree.
 *
 * This is a denylist on purpose. It began as an allowlist of authored fields,
 * which silently dropped everything nobody had thought to enumerate: a Link's
 * `remoteUrl` -- its entire target -- and every Event's start, end, location
 * and contact details. An allowlist loses data quietly for each new content
 * type; a denylist keeps it and only drops what is known to be noise.
 */
export const SERVER_STATE = new Set([
  '@id', 'created', 'modified', 'workflow_history', 'lock', 'version',
  'working_copy', 'working_copy_of', 'next_item', 'previous_item',
  'changeActor', 'versioning_enabled', 'type_title', 'items', 'items_total',
  '@components', 'exportimport.constrains', 'exportimport.conversation',
  'exportimport.versions',
  // derived from tree position by whatever reads the tree
  'parent', 'getObjPositionInParent',
  // carried by the body, not the frontmatter
  'blocks', 'blocks_layout', 'plaintext',
]);
