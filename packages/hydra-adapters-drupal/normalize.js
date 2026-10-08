/**
 * JSON:API normalisation.
 *
 * A JSON:API document splits an entity across `data` (its own attributes plus
 * relationship *pointers*) and a flat `included` array holding the pointed-at
 * entities. Nothing is nested: a node's author is a `{type, id}` reference
 * that must be looked up. Getting this wrong is the single likeliest way for
 * a Drupal adapter to be subtly incorrect, which is why it lives in one pure
 * function with its own tests rather than being scattered through dispatch().
 */

/** Index `included` by "type:id" so lookups are O(1) rather than a scan per field. */
export function indexIncluded(payload) {
  const index = new Map();
  for (const entry of payload?.included ?? []) {
    index.set(`${entry.type}:${entry.id}`, entry);
  }
  return index;
}

/**
 * Resolve one relationship to the included entities it points at.
 * Returns an array even for to-one relationships, so callers do not branch.
 */
export function resolveRelationship(relationship, index) {
  const data = relationship?.data;
  if (!data) return [];
  const refs = Array.isArray(data) ? data : [data];
  // The id is ALWAYS present in JSON:API — `included` only supplies the
  // entity body. Returning nothing when a reference was not included would
  // discard information the response really does carry, and callers that
  // only need the id (walking a menu tree, say) would see an empty tree.
  return refs.map((ref) => {
    const entity = index.get(`${ref.type}:${ref.id}`);
    return entity ? { ...entity, id: ref.id, type: ref.type } : { id: ref.id, type: ref.type };
  });
}

/**
 * Flatten one JSON:API resource into plain attributes plus resolved
 * relationships, so adapter code never walks `included` by hand.
 */
export function flatten(resource, index) {
  if (!resource) return null;
  const relationships = {};
  for (const [name, rel] of Object.entries(resource.relationships ?? {})) {
    const resolved = resolveRelationship(rel, index);
    const single = !Array.isArray(rel?.data);
    relationships[name] = single ? (resolved[0] ?? null) : resolved;
  }
  return {
    id: resource.id,
    type: resource.type,
    attributes: resource.attributes ?? {},
    relationships,
  };
}

/** Flatten a whole collection or single-resource response. */
export function flattenPayload(payload) {
  const index = indexIncluded(payload);
  const data = payload?.data;
  if (!data) return null;
  return Array.isArray(data)
    ? data.map((entry) => flatten(entry, index))
    : flatten(data, index);
}

/**
 * Drupal's path alias, which is the document's real URL.
 *
 * `path.alias` is empty when no alias was generated, in which case the node is
 * only reachable at /node/<nid>. Callers get that rather than a fabricated
 * pretty path, because inventing one produces a URL that 404s.
 */
export function aliasOf(flattened) {
  const alias = flattened?.attributes?.path?.alias;
  if (alias) return alias;
  const nid = flattened?.attributes?.drupal_internal__nid;
  return nid ? `/node/${nid}` : null;
}
