/**
 * Core / behaviour block types the frontend renders that shared-block-schemas.js
 * (the CUSTOM config) does not list. Together they are the complete registry a
 * content object's `@type` is checked against — `sharedBlocksConfig` alone flags
 * these (e.g. `title`, `description`) as unknown, which is a false positive.
 *
 * Reproduced here because the authoritative definitions live in Volto core and in
 * metadata/dexterity behaviours, not in this repo's custom config. The keys (type
 * names) are what the type check needs. `blockSchema.properties` is left minimal
 * on purpose — fill it from Volto core only if/when field-level drift checks are
 * added, so we don't assert a field shape we haven't verified against source.
 */
export const coreBlocksConfig = {
  // Volto core content blocks
  title: { blockSchema: { properties: {} } },
  description: { blockSchema: { properties: {} } },
  leadimage: { blockSchema: { properties: {} } },
  // metadata / behaviour blocks (dexterity content-type metadata)
  dateField: { blockSchema: { properties: {} } },
  eventMetadata: { blockSchema: { properties: {} } },
  socialLinks: { blockSchema: { properties: {} } },
};

/** The complete block registry: core/behaviour blocks + the custom config. */
export function allBlocksConfig(sharedBlocksConfig) {
  return { ...coreBlocksConfig, ...sharedBlocksConfig };
}
