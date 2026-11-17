/**
 * The serializer's source, to run in a page:
 * `new Function(serializerSource({ rewrite }) + "; return serialize;")()`.
 * `rewrite`: the source of `function (el, t, a, inner)` returning `{ t, a, inner }`, or null.
 */
export function serializerSource(options: { rewrite: string | null }): string;
