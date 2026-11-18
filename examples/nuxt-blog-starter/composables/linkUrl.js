/**
 * The address a link field holds. A link field stores one shape, a list of
 * links, `[{ '@id': url }]`, for a page on the site and an outside address
 * alike; unset or empty is no link. Anything else is refused, not guessed at.
 */
export default function linkUrl(value) {
  if (value == null || (Array.isArray(value) && value.length === 0)) return '';
  if (!Array.isArray(value) || typeof value[0]?.['@id'] !== 'string') {
    throw new Error(`a link is stored as [{"@id": url}], got ${JSON.stringify(value)}`);
  }
  return value[0]['@id'];
}
